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

    public canDropOn(targetId: string, operation: DragEffect): boolean {
        const session = this.state();
        if (!session || !this.isCurrentSession(session)) { return false; }
        const entities = this.fileSystem.entityMap();
        const source = entities[session.sourceId];
        const target = entities[targetId];

        return source !== undefined && target !== undefined && isFolder(target) &&
            canDropItem(source, target, operation, this.policy());
    }

    public async drop(event: DragEvent, targetId: string | null): Promise<void> {
        event.preventDefault();
        event.stopPropagation();
        const session = this.verifiedDrop(event, targetId);
        const operation = event.ctrlKey ? 'copy' : 'move';
        const roots = this.sessionRoots;
        this.endDrag();
        if (!session || targetId === null) { return; }
        this.pending.set(true);
        this.busyIds.set(new Set([session.sourceId, targetId]));
        try {
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
            this.canDropOn(targetId, operation) ? session : null;
    }

    private policy(): DragPolicy {
        const context = this.context()();
        const entities = this.fileSystem.entityMap();
        const failedIds = Object.entries(this.fileSystem.errorByParentId())
            .filter(([, error]) => error !== undefined).map(([id]) => id);

        return {
            ...context,
            blocked: this.destroyed || context.blocked || this.pending() ||
                this.fileSystem.isInitializing() ||
                this.fileSystem.initializedRoots() === null,
            entities,
            recycleBins: Object.values(entities).filter((node): node is FolderNode =>
                isFolder(node) && node.isRecycleBin),
            readonlyLists: this.navigation.readonlyAccessByListKey(),
            unavailableIds: new Set([
                ...failedIds,
                ...this.fileSystem.folderIdsWithLoadingChildren()
            ])
        };
    }

    private isCurrentSession(session: DragState): boolean {
        return this.isCurrentProject(session.projectId, this.sessionRoots);
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
                this.navigation.expand(targetId);
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
