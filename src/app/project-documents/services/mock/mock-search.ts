import { FileSystemError } from '../../models/file-system-error.model';
import type { FileSystemNode, FolderNode } from '../../models/file-system-node.model';

export function searchMockNodes(
    nodes: ReadonlyMap<string, FileSystemNode>,
    scope: FolderNode,
    query: string
): FileSystemNode[] {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (normalizedQuery.length === 0) {
        throw new FileSystemError('unknown', 'Search requires a non-empty query');
    }
    const results: FileSystemNode[] = [];
    for (const node of nodes.values()) {
        if (node.listKey !== scope.listKey || node.id === scope.id) { continue; }
        if (!node.path.startsWith(`${scope.path}/`)) { continue; }
        if (!node.name.toLocaleLowerCase().includes(normalizedQuery)) { continue; }
        results.push(node);
    }

    return results.sort((a, b) =>
        a.name.localeCompare(b.name) || a.path.localeCompare(b.path)
    );
}
