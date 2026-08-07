import { FileSystemError } from '../../models/file-system-error.model';
import {
    isFolder,
    type FileSystemNode
} from '../../models/file-system-node.model';
import { validateName } from '../../utils/naming.utils';

export function clone<T>(value: T): T {
    return structuredClone(value);
}

export function nowIso(): string {
    return new Date().toISOString();
}

export function normalizeMockPath(path: string): string {
    return path
        .trim()
        .replace(/^\/+|\/+$/g, '')
        .split('/')
        .filter((segment) => segment.length > 0)
        .join('/')
        .toLowerCase();
}

export function fileExplorerCopyName(name: string): string {
    const extensionIndex = name.lastIndexOf('.');
    if (extensionIndex <= 0 || extensionIndex === name.length - 1) {
        return `${name} - Copy`;
    }

    return `${name.slice(0, extensionIndex)} - Copy${name.slice(extensionIndex)}`;
}

export function assertValidName(name: string): void {
    const result = validateName(name);
    if (!result.valid) {
        throw new FileSystemError('invalid-name', `Invalid name: ${result.reason}`);
    }
}

export function assertNameAvailable(
    nodes: ReadonlyMap<string, FileSystemNode>,
    parentId: string,
    name: string,
    exceptId?: string
): void {
    const normalized = name.trim().toLocaleLowerCase();
    for (const node of nodes.values()) {
        if (node.parentId !== parentId || node.id === exceptId) { continue; }
        if (node.name.toLocaleLowerCase() === normalized) {
            throw new FileSystemError(
                'name-collision',
                `An item named "${name.trim()}" already exists`
            );
        }
    }
}

export function collectDescendantIds(
    nodes: ReadonlyMap<string, FileSystemNode>,
    folderId: string
): string[] {
    const result = [folderId];
    for (const node of nodes.values()) {
        if (node.parentId !== folderId) { continue; }
        result.push(
            ...isFolder(node) ? collectDescendantIds(nodes, node.id) : [node.id]
        );
    }

    return result;
}

export function touchParentCounts(
    nodes: Map<string, FileSystemNode>,
    parentId: string
): void {
    const parent = nodes.get(parentId);
    if (!parent || !isFolder(parent)) { return; }
    const itemCount = Array.from(nodes.values()).filter(
        (node) => node.parentId === parentId
    ).length;
    nodes.set(parent.id, {
        ...parent,
        itemCount,
        modifiedAt: nowIso()
    });
}
