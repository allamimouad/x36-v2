import {
    type FileSystemNode, isFolder
} from '../models/file-system-node.model';

export function containsNode(
    ancestor: FileSystemNode,
    candidate: FileSystemNode,
    entities: Record<string, FileSystemNode>
): boolean {
    if (ancestor.listKey !== candidate.listKey) { return false; }
    let current: FileSystemNode | undefined = candidate;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
        if (current.id === ancestor.id) { return true; }
        visited.add(current.id);
        current = current.parentId === null ? undefined : entities[current.parentId];
    }

    return isFolder(ancestor) && candidate.path.startsWith(`${ancestor.path}/`);
}

/**
 * The top-most nodes of `nodes`: any node that already has an ancestor in the set is
 * dropped. A multi-item move must not carry both a folder and something inside it —
 * the folder moves first and the descendant's path changes underneath its own queued
 * request, which then fails or acts on the wrong item.
 */
export function topMostNodes(
    nodes: readonly FileSystemNode[],
    entities: Record<string, FileSystemNode>
): FileSystemNode[] {
    return nodes.filter((node) => !nodes.some(
        (other) => other.id !== node.id && containsNode(other, node, entities)
    ));
}
