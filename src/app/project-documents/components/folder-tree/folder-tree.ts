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
import type { FolderNode } from '../../models/file-system-node.model';
import type {
    ItemRenameRequest,
    NodeContextMenuRequest
} from '../../models/context-menu-request.model';
import {
    FileSystemIcon
} from '../../shared/file-system-icon/file-system-icon';

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
    public readonly renamingId = input<string | null>(null);
    public readonly renameError = input<string | null>(null);

    public readonly nodeSelected = output<string>();
    public readonly nodeExpanded = output<string>();
    public readonly nodeCollapsed = output<string>();
    public readonly contextMenuRequested = output<NodeContextMenuRequest>();
    public readonly renameSubmitted = output<ItemRenameRequest>();
    public readonly renameCancelled = output();
    public readonly renameEdited = output();

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

    private submitInlineRename(node: TreeNode<FolderNode>): void {
        if (!node.data) { return; }
        this.renameSubmitted.emit({ node: node.data, name: this.inlineRenameValue() });
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
