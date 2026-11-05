import {
    computed, DestroyRef, effect, inject, Injectable, signal, untracked
} from '@angular/core';
import type { DocumentListRoots } from '../../models/document-list.model';
import {
    type DragContext, type DragEffect, type DragState, type DragSurface,
    type DragTarget, type DropIntent, INTERNAL_DRAG_TYPE, type ItemDragRequest
} from '../../models/drag-state.model';
import {
    type FileSystemNode, type FolderNode, isFolder
} from '../../models/file-system-node.model';
import { FileSystemStore } from '../../stores/file-system.store';
import { NavigationStore } from '../../stores/navigation.store';
import { ClipboardService } from './clipboard.service';
import { NotificationService } from './notification.service';
import { containsNode, topMostNodes } from '../../utils/node-containment.utils';
import { type BulkOutcome, BulkOperationService } from './bulk-operation.service';
import { canDropItem, canStartDrag, type DragPolicy } from './drag-drop-policy';

/**
 * Narrowings applied when a check must look past state the caller already owns:
 * an in-flight children load it is about to await, or its own claimed request.
 */
interface PolicyOptions {
    ignoreLoadingChildren?: boolean;
    ignoreOwnRequest?: boolean;
}

const PAST_TENSE: Record<DropIntent, string> = {
    move: 'moved', copy: 'copied', delete: 'deleted'
};

/** How a partial batch describes the items that did not make it. */
const SHORTFALL: Record<DropIntent, string> = {
    move: 'stayed in place', copy: 'failed', delete: 'were not deleted'
};

/**
 * What dropping on `target` will do. A bin means delete — but only on a plain drag:
 * holding Ctrl asks for a copy, which a bin cannot satisfy, so the intent stays `copy`
 * and the policy rejects it rather than quietly deleting instead.
 */
function intentFor(target: FolderNode, dragEffect: DragEffect): DropIntent {
    return dragEffect === 'move' && target.isRecycleBin ? 'delete' : dragEffect;
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
    private readonly bulk = inject(BulkOperationService);
    private readonly notifications = inject(NotificationService);
    private readonly context = signal<() => DragContext>(() => ({
        writingIds: new Set(), editingIds: new Set(), blocked: false
    }));
    private sessionRoots: DocumentListRoots | null = null;
    /**
     * The dragged nodes as they were at dragstart. A search result is not in the cache,
     * so `entityMap` cannot resolve it; this is consulted second.
     */
    private sessionNodes = new Map<string, FileSystemNode>();
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

    /**
     * Which of `nodes` could start a drag. `draggableIds` only enumerates the cache, so
     * nodes that never enter it — every search result — have to be asked about here.
     *
     * Takes the whole list on purpose: `policy()` scans every cached entity, so asking
     * per node made this O(nodes x entities) and rebuilt the policy on each row.
     */
    public draggableAmong(nodes: readonly FileSystemNode[]): ReadonlySet<string> {
        const policy = this.policy();

        return new Set(nodes
            .filter((node) => canStartDrag(node, policy))
            .map(({ id }) => id));
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
        this.sessionNodes = new Map(sources.map((source) => [source.id, source]));
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

    /** Cache first, then the dragstart snapshot for sources that were never cached. */
    private sourceNode(id: string): FileSystemNode | undefined {
        return this.fileSystem.entityMap()[id] ?? this.sessionNodes.get(id);
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
        const sources = session.sourceIds
            .map((id) => this.sourceNode(id))
            .filter((node): node is FileSystemNode => node !== undefined);
        if (sources.length !== session.sourceIds.length) { return false; }
        const policy = this.policy(options);
        const intent = intentFor(target, operation);

        return sources.every((source) => canDropItem(source, target, intent, policy));
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
        if (selectedIds === undefined || !selectedIds.has(node.id) || selectedIds.size <= 1) {
            // The grabbed node need not be cached — a search result never is — so trust
            // what the surface handed us, preferring the cached copy when there is one.
            return [entities[node.id] ?? node];
        }
        const ids = [...selectedIds];
        const nodes = ids
            .map((id) => entities[id])
            .filter((candidate): candidate is FileSystemNode => candidate !== undefined);
        // A selection naming something the cache no longer holds is not safe to act on.
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
            .map((id) => this.sourceNode(id))
            .filter((node): node is FileSystemNode => node !== undefined);
        const target = entities[targetId];
        if (target === undefined || !isFolder(target)) { return; }
        const intent = intentFor(target, operation);
        const view = this.navigation.currentFolder();
        const outcomes = await this.bulk.run({
            items: sources,
            isCurrent: () => this.isCurrentProject(session.projectId, roots),
            run: (node) => this.runOne(node, targetId, intent)
        });
        if (!this.isCurrentProject(session.projectId, roots)) { return; }
        // Items that never ran are neither done nor failed, and must not be counted as
        // either: both helpers below read a missing error as success.
        const settled = outcomes.filter((outcome) => outcome.abandoned !== true);
        this.finishBatch(intent, settled, view, targetId);
        this.bulk.report(settled, PAST_TENSE[intent], SHORTFALL[intent]);
    }

    /** Runs one item. Isolation and the staleness guard belong to the bulk runner. */
    private async runOne(
        node: FileSystemNode,
        targetId: string,
        intent: DropIntent
    ): Promise<string[]> {
        // Pass the node, not its id: a search result is not in the cache, and an
        // id-only call would fail to resolve it. The store prefers its cached copy
        // when there is one.
        if (intent === 'copy') {
            await this.fileSystem.copy(node, targetId);

            return [];
        }

        // A delete ignores the target: the backend routes the item to its own list's
        // bin, which the policy has already matched against.
        return intent === 'delete'
            ? this.fileSystem.delete(node)
            : this.fileSystem.move(node, targetId);
    }

    /**
     * Prune what the successful items removed and, when the viewed folder went with
     * them, open somewhere valid — decided once for the batch rather than per item.
     *
     * A copy comes through here too, removing nothing. It has no rows to prune and no
     * view to follow, but it still needs the search reconciled: a copy made inside the
     * searched scope is a new match, and skipping this is how drag-copy came to behave
     * differently from paste-copy.
     */
    private finishBatch(
        intent: DropIntent,
        outcomes: BulkOutcome[],
        view: FolderNode | null,
        targetId: string
    ): void {
        const done = outcomes.filter((outcome) => outcome.error === undefined);
        if (done.length === 0) { return; }
        // Source ids included for anything that removes: an uncached source — every
        // search hit is one — reports nothing through the cache, so its result row would
        // otherwise survive. A copy must contribute none of this, or it would prune the
        // rows of the very items it just duplicated.
        const removed = intent === 'copy'
            ? []
            : done.flatMap((outcome) => [...outcome.removed, outcome.node.id]);
        const currentId = this.navigation.currentFolderId();
        // A copy never takes the view: its source survives, so `viewWasTaken`'s
        // containment clause would otherwise fire for a view inside a copied folder and
        // navigate away from it for no reason.
        const affected = intent !== 'copy' &&
            this.viewWasTaken(done, removed, view, currentId);
        this.bulk.pruneReferences(removed);
        if (!affected) { return; }
        const destination = intent === 'delete'
            ? this.parentOfRemover(done, currentId)
            : targetId;
        if (destination !== null) { this.navigation.navigateTo(destination); }
    }

    /** Whether the batch carried off the folder currently being viewed. */
    private viewWasTaken(
        done: BulkOutcome[],
        removed: string[],
        view: FolderNode | null,
        currentId: string | null
    ): boolean {
        const current = this.navigation.currentFolder() ?? (currentId === view?.id ? view : null);
        const entities = this.fileSystem.entityMap();

        return removed.includes(currentId ?? '') || current !== null &&
            done.some((outcome) => containsNode(outcome.node, current, entities));
    }

    /**
     * Where to land after a delete took the viewed folder. A bin is not somewhere to
     * open, so fall back to the parent of whichever item removed the view — the same
     * destination the context-menu delete uses.
     */
    private parentOfRemover(done: BulkOutcome[], currentId: string | null): string | null {
        const remover = done.find(
            (outcome) => outcome.removed.includes(currentId ?? '')
        ) ?? done[0];

        return remover.node.parentId;
    }

}
