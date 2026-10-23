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
