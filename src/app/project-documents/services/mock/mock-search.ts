import type { DocumentSearchResult } from '../../models/document-search-result.model';
import { FileSystemError } from '../../models/file-system-error.model';
import type { FileSystemNode, FolderNode } from '../../models/file-system-node.model';

export function searchMockNodes(
    nodes: ReadonlyMap<string, FileSystemNode>,
    listRootPath: string,
    scope: FolderNode,
    query: string
): DocumentSearchResult[] {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (normalizedQuery.length < 3) {
        throw new FileSystemError('unknown', 'Search requires at least three characters');
    }
    const results: DocumentSearchResult[] = [];
    for (const node of nodes.values()) {
        if (node.listKey !== scope.listKey || node.id === scope.id) { continue; }
        if (!node.path.startsWith(`${scope.path}/`)) { continue; }
        if (!node.name.toLocaleLowerCase().includes(normalizedQuery)) { continue; }
        const relativePath = node.path.slice(listRootPath.length).replace(/^\//, '');
        results.push(toSearchResult(node, relativePath));
    }

    return results.sort((a, b) =>
        a.name.localeCompare(b.name) || a.path.localeCompare(b.path)
    );
}

function toSearchResult(node: FileSystemNode, relativePath: string): DocumentSearchResult {
    const separator = relativePath.lastIndexOf('/');

    return {
        ...node,
        listRelativePath: relativePath,
        parentListRelativePath: separator < 0 ? '' : relativePath.slice(0, separator)
    };
}
