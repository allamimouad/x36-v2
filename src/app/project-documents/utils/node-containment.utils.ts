import {
    type FileSystemNode, isFolder
} from '../models/file-system-node.model';

/**
 * Whether `candidatePath` is `ancestorPath` or sits beneath it.
 *
 * Case-insensitive, because SharePoint server-relative URLs are: the same folder can be
 * addressed as `/Contracts` or `/contracts`, and an exact compare would let a
 * differently-cased destination past every guard built on this. Only the comparison is
 * normalized — a stored path is never rewritten, since a guard that edits identity can
 * end up disagreeing with the server about which folder it is talking about.
 *
 * The trailing slash is what keeps `/Contracts2` from reading as a child of
 * `/Contracts`.
 */
export function pathContainsOrEquals(ancestorPath: string, candidatePath: string): boolean {
    const ancestor = ancestorPath.toLowerCase();
    const candidate = candidatePath.toLowerCase();

    return candidate === ancestor || candidate.startsWith(`${ancestor}/`);
}

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

    // Strictly beneath: an equal path would mean the ancestor itself, which the id walk
    // above has already settled.
    return isFolder(ancestor) && candidate.path.toLowerCase()
        .startsWith(`${ancestor.path.toLowerCase()}/`);
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
