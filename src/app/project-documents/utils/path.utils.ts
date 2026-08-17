import type { FolderNode } from '../models/file-system-node.model';

export const ROOT_PATH = '/';

export function joinPath(parentPath: string, name: string): string {
    if (parentPath === ROOT_PATH) { return `/${name}`; }

    return `${parentPath}/${name}`;
}

export function parentOf(path: string): string {
    if (path === ROOT_PATH || !path.includes('/')) { return ROOT_PATH; }
    const idx = path.lastIndexOf('/');
    if (idx <= 0) { return ROOT_PATH; }

    return path.slice(0, idx);
}

/**
 * Convert a canonical node path into the path expected by the list-relative resolver.
 * Both values must come from the same backend path representation.
 */
export function relativePathFromRoot(rootPath: string, nodePath: string): string {
    const normalizedRoot = rootPath.replace(/\/+$/, '') || ROOT_PATH;
    if (nodePath.toLowerCase() === normalizedRoot.toLowerCase()) { return ''; }
    const prefix = normalizedRoot === ROOT_PATH ? ROOT_PATH : `${normalizedRoot}/`;
    if (!nodePath.toLowerCase().startsWith(prefix.toLowerCase())) {
        throw new Error(`Node path is outside its document-list root: ${nodePath}`);
    }

    return nodePath.slice(prefix.length);
}

/** Return the containing folder of a list-relative item path; root is an empty string. */
export function parentOfRelativePath(path: string): string {
    const separator = path.lastIndexOf('/');

    return separator < 0 ? '' : path.slice(0, separator);
}

export function basename(path: string): string {
    if (path === ROOT_PATH) { return ''; }
    const idx = path.lastIndexOf('/');

    return idx < 0 ? path : path.slice(idx + 1);
}

export function isAncestorOrSelf(
    ancestorId: string,
    candidateId: string,
    allFolders: ReadonlyMap<string, FolderNode>
): boolean {
    let current: string | null = candidateId;
    while (current !== null) {
        if (current === ancestorId) { return true; }
        const node = allFolders.get(current);
        if (!node) { return false; }
        current = node.parentId;
    }

    return false;
}
