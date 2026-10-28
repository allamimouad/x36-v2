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
import { containsNode } from '../../utils/node-containment.utils';
import { canDropItem, canStartDrag, type DragPolicy } from './drag-drop-policy';

/**
 * Narrowings applied when a check must look past state the caller already owns:
 * an in-flight children load it is about to await, or its own claimed request.
 */
interface PolicyOptions {
    ignoreLoadingChildren?: boolean;
    ignoreOwnRequest?: boolean;
}

@Injectable()
export class DragDropService {
    public readonly state = signal<DragState | null>(null);
    public readonly target = signal<DragTarget | null>(null);
    public readonly busyIds = signal<ReadonlySet<string>>(new Set());
    public readonly pending = signal(false);
    public readonly draggableIds = computed(() => {
        const policy = this.policy();

        return new Set(Object.values(policy.entities)
            .filter((node) => canStartDrag(node, policy)).map((node) => node.id));
    });

    private readonly fileSystem = inject(FileSystemStore);
    private readonly navigation = inject(NavigationStore);
    private readonly clipboard = inject(ClipboardService);
    private readonly notifications = inject(NotificationService);
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

    public startDrag({ event, node }: ItemDragRequest): void {
        event.stopPropagation();
        const source = this.fileSystem.entityMap()[node.id];
        const projectId = this.fileSystem.projectId();
        if (!source || !projectId || !event.dataTransfer ||
            !canStartDrag(source, this.policy()) || this.isControl(event.target)) {
            event.preventDefault();

            return;
        }
        this.endDrag();
        const token = crypto.randomUUID();
        event.dataTransfer.setData(INTERNAL_DRAG_TYPE, token);
        event.dataTransfer.effectAllowed = 'copyMove';
        this.sessionRoots = this.fileSystem.initializedRoots();
        this.state.set({ token, projectId, sourceId: source.id,
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
        this.busyIds.set(new Set([session.sourceId, targetId]));
        try {
            // A target expanded mid-drag may still be loading its children. Let that
            // listing land first: it decides the drop, and applying it afterwards would
            // prune the node this drop is about to add. Only wait when such a load is
            // actually in flight, so an ordinary drop still issues its request without
            // yielding first.
            const loads = this.pendingChildrenLoads(session.sourceId, targetId);
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
        const source = entities[session.sourceId];
        const target = entities[targetId];

        return source !== undefined && target !== undefined && isFolder(target) &&
            canDropItem(source, target, operation, this.policy(options));
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
    private pendingChildrenLoads(sourceId: string, targetId: string): Promise<void>[] {
        const entities = this.fileSystem.entityMap();
        const nodes = [entities[sourceId], entities[targetId]]
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

    private async perform(
        session: DragState,
        targetId: string,
        operation: DragEffect,
        roots: DocumentListRoots | null
    ): Promise<void> {
        const source = this.fileSystem.entityMap()[session.sourceId];
        const view = this.navigation.currentFolder();
        if (operation === 'copy') {
            await this.fileSystem.copy(source.id, targetId);
        } else {
            const removed = await this.fileSystem.move(source.id, targetId);
            if (!this.isCurrentProject(session.projectId, roots)) { return; }
            this.finishMove(source, view, removed, targetId);
        }
        if (this.isCurrentProject(session.projectId, roots)) {
            const verb = operation === 'copy' ? 'copied' : 'moved';
            this.notifications.success(`${source.name} was ${verb}.`);
        }
    }

    private finishMove(
        source: FileSystemNode,
        view: FolderNode | null,
        removed: string[],
        targetId: string
    ): void {
        const currentId = this.navigation.currentFolderId();
        const current = this.navigation.currentFolder() ?? (currentId === view?.id ? view : null);
        const affected = removed.includes(currentId ?? '') || current !== null &&
            containsNode(source, current, this.fileSystem.entityMap());
        this.navigation.pruneReferences(removed);
        this.clipboard.pruneReferences(removed);
        if (affected) { this.navigation.navigateTo(targetId); }
    }
}
