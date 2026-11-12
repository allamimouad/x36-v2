import type { TreeNode } from 'primeng/api';
import type { DocumentListKey } from '../models/document-list.model';
import { isFolder, type FileSystemNode, type FolderNode } from '../models/file-system-node.model';

/**
 * A snapshot of everything one tree section is built from. The caller reads the signals
 * so the reactivity stays where it belongs; this module only shapes the result.
 */
export interface TreeSectionContext {
    listKey: DocumentListKey;
    root: FolderNode;
    nodes: readonly FileSystemNode[];
    expandedIds: ReadonlySet<string>;
    loadedIds: ReadonlySet<string>;
}

/** Alphabetical, except the recycle bin which always sorts last. */
export function sortFoldersByAlphabeticalAndRecycleBin(a: FolderNode, b: FolderNode): number {
    if (a.isRecycleBin && !b.isRecycleBin) {
        return 1;
    }
    if (!a.isRecycleBin && b.isRecycleBin) {
        return -1;
    }

    return a.name.localeCompare(b.name);
}

/**
 * Builds one list's tree. A folder is a leaf once its children are known to be empty,
 * and the recycle bin is always a leaf: its contents are a flat listing shown in the
 * table, never expanded in the tree.
 */
export function buildTreeSection(context: TreeSectionContext): TreeNode<FolderNode>[] {
    const childrenOf = (folder: FolderNode): FolderNode[] => context.nodes
        .filter((node): node is FolderNode => isFolder(node) && node.parentId === folder.id)
        .sort(sortFoldersByAlphabeticalAndRecycleBin);

    const buildNode = (folder: FolderNode, isRoot: boolean): TreeNode<FolderNode> => {
        const childFolders = childrenOf(folder);
        const isLoaded = context.loadedIds.has(folder.id);

        return {
            key: folder.id,
            // Section header already carries the full label; the root node shows
            // the short name.
            label: isRoot ? rootLabel(context.listKey) : folder.name,
            data: folder,
            leaf: isLoaded && childFolders.length === 0 || folder.isRecycleBin,
            expanded: context.expandedIds.has(folder.id),
            children: isLoaded && !folder.isRecycleBin
                ? childFolders.map((child) => buildNode(child, false))
                : []
        };
    };

    return [buildNode(context.root, true)];
}

function rootLabel(listKey: DocumentListKey): string {
    return `${listKey[0]}${listKey.slice(1).toLowerCase()}`;
}
