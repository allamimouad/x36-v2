import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    ElementRef,
    input,
    output,
    signal,
    viewChild
} from '@angular/core';
import { PrimeTemplate, type TreeNode } from 'primeng/api';
import { InputText } from 'primeng/inputtext';
import { Tree, type TreeNodeExpandEvent, type TreeNodeSelectEvent } from 'primeng/tree';
import type { FileSystemNode, FolderNode } from '../../models/file-system-node.model';
import type {
    ItemRenameRequest,
    NodeContextMenuRequest
} from '../../models/context-menu-request.model';
import type { ExternalFolderDropRequest } from '../../models/external-drop-request.model';
import {
    hasInternalDragType, type ItemDragRequest, type ItemDropRequest
} from '../../models/drag-state.model';
import { FileSystemIcon } from '../../shared/file-system-icon/file-system-icon';
import { FolderNodeResponseAccessLevelEnum } from '@api/model/folderNodeResponse';
import type { DocumentListKey } from '../../models/document-list.model';

@Component({
    selector: 'pr-folder-tree',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [Tree, PrimeTemplate, InputText, FileSystemIcon],
    templateUrl: './folder-tree.html',
    styleUrl: './folder-tree.scss'
})
export class FolderTree {
    public readonly nodes = input.required<TreeNode<FolderNode>[]>();
    public readonly currentFolderId = input<string | null>(null);
    public readonly folderIdsWithLoadingChildren = input<string[]>([]);
    public readonly writingIds = input<ReadonlySet<string>>(new Set<string>());
    public readonly externalDropTargetId = input<string | null>(null);
    public readonly draggableIds = input<ReadonlySet<string>>(new Set());
    public readonly internalDragActive = input(false);
    public readonly internalSourceIds = input<ReadonlySet<string>>(new Set<string>());
    public readonly internalDropTargetId = input<string | null>(null);
    public readonly renamingId = input<string | null>(null);
    public readonly renameError = input<string | null>(null);
    public readonly deleteConfirmationId = input<string | null>(null);
    public readonly readonlyAccessByListKey =
        input<ReadonlyMap<DocumentListKey, boolean>>(new Map());

    public readonly nodeSelected = output<string>();
    public readonly nodeExpanded = output<string>();
    public readonly nodeCollapsed = output<string>();
    public readonly contextMenuRequested = output<NodeContextMenuRequest>();
    public readonly renameSubmitted = output<ItemRenameRequest>();
    public readonly renameCancelled = output();
    public readonly renameEdited = output();
    public readonly deleteConfirmed = output<FolderNode>();
    public readonly deleteCancelled = output();
    public readonly externalFolderDragOver = output<ExternalFolderDropRequest>();
    public readonly externalFolderDropped = output<ExternalFolderDropRequest>();
    public readonly dragStarted = output<ItemDragRequest>();
    public readonly dragEnded = output();
    public readonly internalDragOver = output<ItemDropRequest>();
    public readonly internalDropped = output<ItemDropRequest>();
    public readonly internalDragLeft = output<DragEvent>();

    protected readonly selectedTreeNode = computed<TreeNode<FolderNode> | null>(() => {
        const id = this.currentFolderId();
        if (!id) { return null; }

        return findNodeByKey(this.visibleNodes(), id);
    });

    protected readonly visibleNodes = computed<TreeNode<FolderNode>[]>(() =>
        applyLoading(this.nodes(), this.folderIdsWithLoadingChildren())
    );
    protected readonly inlineRenameValue = signal('');
    private readonly inlineRenameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');
    private readonly deleteCancelButton =
        viewChild<ElementRef<HTMLButtonElement>>('deleteCancelButton');

    constructor() {
        effect(() => {
            const renamingId = this.renamingId();
            const node = renamingId ? findNodeByKey(this.visibleNodes(), renamingId) : null;
            if (node?.data) { this.inlineRenameValue.set(node.data.name); }
            const inputElement = this.inlineRenameInput()?.nativeElement;
            if (inputElement) {
                inputElement.focus();
                inputElement.select();
            }
        });
        effect(() => {
            if (!this.deleteConfirmationId()) { return; }
            this.deleteCancelButton()?.nativeElement.focus();
        });
    }

    protected trackNode(_index: number, node: TreeNode<FolderNode>): string | undefined {
        return node.key;
    }

    protected handleExpand(event: TreeNodeExpandEvent): void {
        const key = event.node?.key;
        if (typeof key === 'string') { this.nodeExpanded.emit(key); }
    }

    protected handleCollapse(event: TreeNodeExpandEvent): void {
        const key = event.node?.key;
        if (typeof key === 'string') { this.nodeCollapsed.emit(key); }
    }

    protected handleSelect(event: TreeNodeSelectEvent): void {
        const key = event.node?.key;
        if (typeof key === 'string') { this.nodeSelected.emit(key); }
    }

    protected handleContextMenu(event: MouseEvent, node: TreeNode<FolderNode>): void {
        if (!node.data) { return; }
        event.preventDefault();
        event.stopPropagation();
        this.contextMenuRequested.emit({ event, node: node.data, source: 'tree' });
    }

    protected onInlineRenameInput(event: Event): void {
        this.inlineRenameValue.set((event.target as HTMLInputElement).value);
        this.renameEdited.emit();
    }

    protected onInlineRenameKeydown(
        event: KeyboardEvent,
        node: TreeNode<FolderNode>
    ): void {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.renameCancelled.emit();

            return;
        }
        if (event.key !== 'Enter') { return; }
        event.preventDefault();
        event.stopPropagation();
        this.submitInlineRename(node);
    }

    protected onInlineRenameBlur(node: TreeNode<FolderNode>): void {
        this.submitInlineRename(node);
    }

    protected confirmDelete(event: Event, node: TreeNode<FolderNode>): void {
        event.stopPropagation();
        if (node.data) { this.deleteConfirmed.emit(node.data); }
    }

    protected cancelDelete(event: Event): void {
        event.stopPropagation();
        this.deleteCancelled.emit();
    }

    protected onDeleteButtonKeydown(event: KeyboardEvent): void {
        if (event.key !== 'Escape') { event.stopPropagation(); }
    }

    protected onExternalFolderDragOver(
        event: DragEvent,
        node: TreeNode<FolderNode>
    ): void {
        if (this.isInternalDrag(event)) {
            this.internalDragOver.emit({ event, targetId: node.data?.id ?? null });

            return;
        }
        if (!this.isNodeDroppable(node)) {
            event.preventDefault();

            return;
        }
        if (node.data) {
            this.externalFolderDragOver.emit({ event, target: node.data });
        }
    }

    protected onExternalFolderDrop(
        event: DragEvent,
        node: TreeNode<FolderNode>
    ): void {
        if (this.isInternalDrag(event)) {
            this.internalDropped.emit({ event, targetId: node.data?.id ?? null });

            return;
        }
        if (node.data) {
            this.externalFolderDropped.emit({ event, target: node.data });
        }
    }

    protected onDragStart(event: DragEvent, node: FileSystemNode): void {
        if (!this.draggableIds().has(node.id) || this.renamingId() === node.id ||
            this.deleteConfirmationId() === node.id) {
            event.preventDefault();

            return;
        }
        this.dragStarted.emit({ event, node });
    }

    private isInternalDrag(event: DragEvent): boolean {
        return this.internalDragActive() || hasInternalDragType(event);
    }

    private submitInlineRename(node: TreeNode<FolderNode>): void {
        if (!node.data) { return; }
        this.renameSubmitted.emit({ node: node.data, name: this.inlineRenameValue() });
    }

    private isNodeDroppable(node: TreeNode<FolderNode>): boolean {
        if (node.data?.accessLevel === FolderNodeResponseAccessLevelEnum.Readonly ||
            node.data?.isRecycleBin
        ) {
            return false;
        }
        const listKey = node.data?.listKey;
        if (listKey) {
            const isListReadonly = this.readonlyAccessByListKey().get(listKey);

            return !isListReadonly;
        }

        return false;
    }
}

function applyLoading(
    nodes: TreeNode<FolderNode>[],
    folderIdsWithLoadingChildren: string[]
): TreeNode<FolderNode>[] {
    const loadingIds = new Set(folderIdsWithLoadingChildren);

    return applyLoadingState(nodes, loadingIds);
}

function applyLoadingState(
    nodes: TreeNode<FolderNode>[],
    loadingIds: ReadonlySet<string>
): TreeNode<FolderNode>[] {
    return nodes.map((node) => ({
        ...node,
        loading: typeof node.key === 'string' && loadingIds.has(node.key),
        children: node.children
            ? applyLoadingState(node.children, loadingIds)
            : node.children
    }));
}

function findNodeByKey(
    nodes: TreeNode<FolderNode>[],
    key: string
): TreeNode<FolderNode> | null {
    for (const n of nodes) {
        if (n.key === key) { return n; }
        if (n.children?.length) {
            const found = findNodeByKey(n.children, key);
            if (found) { return found; }
        }
    }

    return null;
}
