import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { PrimeTemplate, type TreeNode } from 'primeng/api';
import { Tree, type TreeNodeExpandEvent, type TreeNodeSelectEvent } from 'primeng/tree';
import type { FolderNode } from '../../models/file-system-node.model';
import {
    FileSystemPrimeIconComponent
} from '../../shared/file-system-prime-icon/file-system-prime-icon.component';

@Component({
    selector: 'pr-folder-tree',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [Tree, PrimeTemplate, FileSystemPrimeIconComponent],
    templateUrl: './folder-tree.component.html',
    styleUrl: './folder-tree.component.scss'
})
export class FolderTreeComponent {
    public readonly nodes = input.required<TreeNode<FolderNode>[]>();
    public readonly currentFolderId = input<string | null>(null);
    public readonly folderIdsWithLoadingChildren = input<string[]>([]);

    public readonly nodeSelected = output<string>();
    public readonly nodeExpanded = output<string>();
    public readonly nodeCollapsed = output<string>();

    protected readonly selectedTreeNode = computed<TreeNode<FolderNode> | null>(() => {
        const id = this.currentFolderId();
        if (!id) { return null; }

        return findNodeByKey(this.visibleNodes(), id);
    });

    protected readonly visibleNodes = computed<TreeNode<FolderNode>[]>(() =>
        applyLoading(this.nodes(), this.folderIdsWithLoadingChildren())
    );

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
