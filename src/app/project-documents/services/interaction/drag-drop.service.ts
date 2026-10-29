import {
    computed, DestroyRef, effect, inject, Injectable, signal, untracked
} from '@angular/core';
import type { DocumentListRoots } from '../../models/document-list.model';
import {
    type DragContext, type DragEffect, type DragState, type DragSurface,
    type DragTarget, INTERNAL_DRAG_TYPE, type ItemDragRequest
} from '../../models/drag-state.model';
import {
    type FileSystemNode, type FolderNode, isFolder
} from '../../models/file-system-node.model';
import { FileSystemStore } from '../../stores/file-system.store';
import { NavigationStore } from '../../stores/navigation.store';
import { ClipboardService } from './clipboard.service';
import { NotificationService } from './notification.service';
import { containsNode, topMostNodes } from '../../utils/node-containment.utils';
import { ConcurrencyQueue } from '../upload/concurrency-queue';
import { FILE_MANAGER_CONFIG } from '../../tokens/file-manager-config.token';
import { canDropItem, canStartDrag, type DragPolicy } from './drag-drop-policy';

/**
 * Narrowings applied when a check must look past state the caller already owns:
 * an in-flight children load it is about to await, or its own claimed request.
 */
interface PolicyOptions {
    ignoreLoadingChildren?: boolean;
    ignoreOwnRequest?: boolean;
}

/** What one item's move/copy produced, so a partial batch can be reported honestly. */
interface ItemOutcome {
    node: FileSystemNode;
    /** Cache ids the move removed; empty for a copy. */
    removed: string[];
    error?: unknown;
    /** Set when the project changed before this item left the queue, so it never ran. */
    abandoned?: boolean;
}

@Injectable()
export class DragDropService {
    public readonly state = signal<DragState | null>(null);
    public readonly target = signal<DragTarget | null>(null);
    public readonly busyIds = signal<ReadonlySet<string>>(new Set());
    public readonly pending = signal(false);
    /** Ids currently being dragged, for source highlighting. */
    public readonly sourceIds = computed<ReadonlySet<string>>(
        () => new Set(this.state()?.sourceIds ?? [])
    );
    public readonly draggableIds = computed(() => {
        const policy = this.policy();

        return new Set(Object.values(policy.entities)
            .filter((node) => canStartDrag(node, policy)).map((node) => node.id));
    });

    private readonly fileSystem = inject(FileSystemStore);
    private readonly navigation = inject(NavigationStore);
    private readonly clipboard = inject(ClipboardService);
    private readonly notifications = inject(NotificationService);
    private readonly config = inject(FILE_MANAGER_CONFIG);
    private readonly context = signal<() => DragContext>(() => ({
        writingIds: new Set(), editingIds: new Set(), blocked: false
    }));
    private sessionRoots: DocumentListRoots | null = null;
    private hoverTimer: ReturnType<typeof setTimeout> | null = null;
    private destroyed = false;

    constructor() {
        effect(() => {
            const roots = this.fileSystem.initializedRoots();
            untracked(() => {
                if (roots !== this.sessionRoots) { this.endDrag(); }
            });
        });
        inject(DestroyRef).onDestroy(() => {
            this.destroyed = true;
            this.endDrag();
        });
    }

    public connect(readContext: () => DragContext): void {
        this.context.set(readContext);
    }

    public handles(event: DragEvent): boolean {
        return this.state() !== null ||
            Array.from(event.dataTransfer?.types ?? []).includes(INTERNAL_DRAG_TYPE);
    }

    public startDrag({ event, node, selectedIds }: ItemDragRequest): void {
        event.stopPropagation();
        const sources = this.dragSet(node, selectedIds);
        const projectId = this.fileSystem.projectId();
        const policy = this.policy();
        // Every item must be draggable, or none is: letting a mixed selection through
        // would move some of what the user grabbed and silently leave the rest.
        if (sources.length === 0 || !projectId || !event.dataTransfer ||
            !sources.every((source) => canStartDrag(source, policy)) ||
            this.isControl(event.target)) {
            event.preventDefault();

            return;
        }
        this.endDrag();
        const token = crypto.randomUUID();
        event.dataTransfer.setData(INTERNAL_DRAG_TYPE, token);
        event.dataTransfer.effectAllowed = 'copyMove';
        this.sessionRoots = this.fileSystem.initializedRoots();
        this.state.set({ token, projectId, sourceIds: sources.map((source) => source.id),
            effect: event.ctrlKey ? 'copy' : 'move' });
    }

    public over(event: DragEvent, targetId: string | null, surface: DragSurface): void {
        if (!this.handles(event)) { return; }
        event.preventDefault();
        event.stopPropagation();
        const operation = event.ctrlKey ? 'copy' : 'move';
        const current = this.state();
        if (current) { this.state.set({ ...current, effect: operation }); }
        const valid = targetId !== null && this.canDropOn(targetId, operation);
        if (event.dataTransfer) { event.dataTransfer.dropEffect = valid ? operation : 'none'; }
        if (!valid || targetId === null) {
            this.clearTarget();

            return;
        }
        this.setTarget(targetId, surface);
    }

    /**
     * Whether the active drag would be accepted on `targetId`. A folder whose children
     * are still loading is treated as a usable target here: the drop awaits that load
     * and re-checks before mutating, so feedback stays steady instead of flickering
     * invalid for the length of a round-trip.
     */
    public canDropOn(targetId: string, operation: DragEffect): boolean {
        const session = this.state();

        return session !== null && this.canSessionDrop(
            session, this.sessionRoots, targetId, operation, { ignoreLoadingChildren: true }
        );
    }

    public async drop(event: DragEvent, targetId: string | null): Promise<void> {
        event.preventDefault();
        event.stopPropagation();
        const session = this.verifiedDrop(event, targetId);
        const operation = event.ctrlKey ? 'copy' : 'move';
        const roots = this.sessionRoots;
        this.endDrag();
        if (!session || targetId === null) { return; }
        // Claim the request before the first await so a repeated drop cannot start a
        // second one, then discount that claim when re-checking below.
        this.pending.set(true);
        this.busyIds.set(new Set([...session.sourceIds, targetId]));
        try {
            // A target expanded mid-drag may still be loading its children. Let that
            // listing land first: it decides the drop, and applying it afterwards would
            // prune the node this drop is about to add. Only wait when such a load is
            // actually in flight, so an ordinary drop still issues its request without
            // yielding first.
            const loads = this.pendingChildrenLoads(session.sourceIds, targetId);
            if (loads.length > 0) {
                await Promise.all(loads);
                if (!this.canSessionDrop(session, roots, targetId, operation,
                    { ignoreOwnRequest: true })) {
                    return;
                }
            }
            await this.perform(session, targetId, operation, roots);
        } catch (error) {
            if (this.isCurrentProject(session.projectId, roots)) {
                this.notifications.error(error);
            }
        } finally {
            this.busyIds.set(new Set());
            this.pending.set(false);
        }
    }

    public leave(event: DragEvent): void {
        const element = event.currentTarget;
        const next = event.relatedTarget;
        if (element instanceof Node && next instanceof Node && element.contains(next)) {
            return;
        }
        this.clearTarget();
    }

    public endDrag(): void {
        this.clearTarget();
        this.state.set(null);
        this.sessionRoots = null;
    }

    private canSessionDrop(
        session: DragState,
        roots: DocumentListRoots | null,
        targetId: string,
        operation: DragEffect,
        options: PolicyOptions = {}
    ): boolean {
        if (!this.isCurrentProject(session.projectId, roots)) { return false; }
        const entities = this.fileSystem.entityMap();
        const target = entities[targetId];
        if (target === undefined || !isFolder(target)) { return false; }
        const sources = session.sourceIds.map((id) => entities[id]);
        if (sources.some((source) => source === undefined)) { return false; }
        const policy = this.policy(options);

        return sources.every((source) => canDropItem(source, target, operation, policy));
    }

    private setTarget(targetId: string, surface: DragSurface): void {
        const previous = this.target();
        if (previous?.id === targetId && previous.surface === surface) { return; }
        this.clearTarget();
        this.target.set({ id: targetId, surface });
        if (surface === 'tree') { this.scheduleExpansion(targetId); }
    }

    private verifiedDrop(event: DragEvent, targetId: string | null): DragState | null {
        const session = this.state();
        const token = event.dataTransfer?.getData(INTERNAL_DRAG_TYPE);
        const operation = event.ctrlKey ? 'copy' : 'move';

        return session && token === session.token && targetId !== null &&
            this.canSessionDrop(session, this.sessionRoots, targetId, operation,
                { ignoreLoadingChildren: true })
            ? session
            : null;
    }

    private policy(options: PolicyOptions = {}): DragPolicy {
        const context = this.context()();
        const entities = this.fileSystem.entityMap();
        const failedIds = Object.entries(this.fileSystem.errorByParentId())
            .filter(([, error]) => error !== undefined).map(([id]) => id);
        const loadingIds = options.ignoreLoadingChildren === true
            ? []
            : this.fileSystem.folderIdsWithLoadingChildren();

        return {
            ...context,
            blocked: this.destroyed || context.blocked ||
                options.ignoreOwnRequest !== true && this.pending() ||
                this.fileSystem.isInitializing() ||
                this.fileSystem.initializedRoots() === null,
            entities,
            recycleBins: Object.values(entities).filter((node): node is FolderNode =>
                isFolder(node) && node.isRecycleBin),
            readonlyLists: this.navigation.readonlyAccessByListKey(),
            unavailableIds: new Set([...failedIds, ...loadingIds])
        };
    }

    private isCurrentProject(projectId: string, roots: DocumentListRoots | null): boolean {
        return !this.destroyed && this.fileSystem.projectId() === projectId &&
            roots !== null && this.fileSystem.initializedRoots() === roots;
    }

    private scheduleExpansion(targetId: string): void {
        if (this.navigation.expandedTreeIds().has(targetId)) { return; }
        this.hoverTimer = setTimeout(() => {
            this.hoverTimer = null;
            const session = this.state();
            if (session && this.canDropOn(targetId, session.effect)) {
                this.navigation.expandWithoutReload(targetId);
            }
        }, 700);
    }

    private clearTarget(): void {
        if (this.hoverTimer !== null) { clearTimeout(this.hoverTimer); }
        this.hoverTimer = null;
        this.target.set(null);
    }

    private isControl(target: EventTarget | null): boolean {
        return target instanceof Element && target.closest('input, button, textarea') !== null;
    }

    /**
     * The in-flight children loads covering the source or the target. Awaiting these
     * lets the drop decide against settled state instead of racing the listing.
     */
    private pendingChildrenLoads(
        sourceIds: readonly string[],
        targetId: string
    ): Promise<void>[] {
        const entities = this.fileSystem.entityMap();
        const nodes = [...sourceIds, targetId]
            .map((id) => entities[id])
            .filter((node): node is FileSystemNode => node !== undefined);

        return this.fileSystem.folderIdsWithLoadingChildren()
            .filter((id) => {
                const loading = entities[id];

                return loading !== undefined &&
                    nodes.some((node) => containsNode(loading, node, entities));
            })
            .map((id) => this.fileSystem.pendingChildrenLoad(id))
            .filter((load): load is Promise<void> => load !== null);
    }

    /**
     * The nodes this gesture carries. Grabbing a row inside the selection drags the
     * whole selection; grabbing one outside it drags that row alone. The set is
     * collapsed to top-most ancestors, and a selection naming something the cache no
     * longer holds drags nothing rather than a silently smaller set.
     */
    private dragSet(
        node: FileSystemNode,
        selectedIds: ReadonlySet<string> | undefined
    ): FileSystemNode[] {
        const entities = this.fileSystem.entityMap();
        const ids = selectedIds !== undefined && selectedIds.has(node.id) && selectedIds.size > 1
            ? [...selectedIds]
            : [node.id];
        const nodes = ids
            .map((id) => entities[id])
            .filter((candidate): candidate is FileSystemNode => candidate !== undefined);
        if (nodes.length !== ids.length) { return []; }

        return topMostNodes(nodes, entities);
    }

    private async perform(
        session: DragState,
        targetId: string,
        operation: DragEffect,
        roots: DocumentListRoots | null
    ): Promise<void> {
        const entities = this.fileSystem.entityMap();
        const sources = session.sourceIds
            .map((id) => entities[id])
            .filter((node): node is FileSystemNode => node !== undefined);
        const view = this.navigation.currentFolder();
        const queue = new ConcurrencyQueue(this.config.bulkOpConcurrency);
        const outcomes = await Promise.all(sources.map(
            (source) => queue.enqueue(
                () => this.performOne(session, roots, source, targetId, operation)
            )
        ));
        if (!this.isCurrentProject(session.projectId, roots)) { return; }
        // Items that never ran are neither moved nor failed, and must not be counted as
        // either: both helpers below read a missing error as success.
        const settled = outcomes.filter((outcome) => outcome.abandoned !== true);
        if (operation === 'move') { this.finishMove(settled, view, targetId); }
        this.report(settled, operation);
    }

    /**
     * One item, with its failure isolated so the rest of the batch still runs.
     *
     * Checked here rather than only after the queue drains: with a selection larger than
     * `bulkOpConcurrency` the overflow waits, and a project change while it waits must
     * stop it going out at all. Requests already sent cannot be recalled — the store's
     * connection revision discards their results instead. `isCurrentProject` also covers
     * this component being destroyed.
     */
    private async performOne(
        session: DragState,
        roots: DocumentListRoots | null,
        node: FileSystemNode,
        targetId: string,
        operation: DragEffect
    ): Promise<ItemOutcome> {
        if (!this.isCurrentProject(session.projectId, roots)) {
            return { node, removed: [], abandoned: true };
        }
        try {
            if (operation === 'copy') {
                await this.fileSystem.copy(node.id, targetId);

                return { node, removed: [] };
            }

            return { node, removed: await this.fileSystem.move(node.id, targetId) };
        } catch (error) {
            return { node, removed: [], error };
        }
    }

    /**
     * Prune what the successful moves removed and, when the viewed folder went with
     * them, open the destination — decided once for the batch rather than per item.
     */
    private finishMove(
        outcomes: ItemOutcome[],
        view: FolderNode | null,
        targetId: string
    ): void {
        const moved = outcomes.filter((outcome) => outcome.error === undefined);
        if (moved.length === 0) { return; }
        const removed = moved.flatMap((outcome) => outcome.removed);
        const currentId = this.navigation.currentFolderId();
        const current = this.navigation.currentFolder() ?? (currentId === view?.id ? view : null);
        const entities = this.fileSystem.entityMap();
        const affected = removed.includes(currentId ?? '') || current !== null &&
            moved.some((outcome) => containsNode(outcome.node, current, entities));
        this.navigation.pruneReferences(removed);
        this.clipboard.pruneReferences(removed);
        if (affected) { this.navigation.navigateTo(targetId); }
    }

    /**
     * One summary for the batch. Successes are already applied and are never rolled
     * back: undoing them would mean issuing deletes that can fail in turn, on items the
     * user can see.
     */
    private report(outcomes: ItemOutcome[], operation: DragEffect): void {
        if (outcomes.length === 0) { return; }
        const verb = operation === 'copy' ? 'copied' : 'moved';
        const failed = outcomes.filter((outcome) => outcome.error !== undefined);
        if (failed.length === outcomes.length) {
            this.notifications.error(failed[0].error);

            return;
        }
        if (failed.length === 0) {
            this.notifications.success(outcomes.length === 1
                ? `${outcomes[0].node.name} was ${verb}.`
                : `${outcomes.length} items were ${verb}.`);

            return;
        }
        const names = failed.map((outcome) => outcome.node.name).join(', ');
        // A partly-failed move leaves the selection split across two folders, so name
        // what stayed rather than only what worked.
        const tail = operation === 'copy'
            ? `${failed.length} failed: ${names}.`
            : `${failed.length} stayed in place: ${names}.`;
        this.notifications.warning(
            `${outcomes.length - failed.length} of ${outcomes.length} items ${verb}. ${tail}`
        );
    }
}
