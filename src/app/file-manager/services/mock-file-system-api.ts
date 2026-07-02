import { Injectable, inject } from '@angular/core';
import { type Observable, map, throwError, timer } from 'rxjs';
import type { DocumentListing, ResolvedDocumentPath } from '../models/document-listing.model';
import type { DocumentListKey } from '../models/document-list.model';
import { FileSystemError } from '../models/file-system-error.model';
import {
    isFolder,
    type FileNode,
    type FileSystemNode,
    type FolderNode
} from '../models/file-system-node.model';
import { MOCK_CONFIG, type MockConfig } from '../tokens/mock-config.token';
import { joinPath } from '../utils/path.utils';
import { validateName } from '../utils/naming.utils';
import { FileSystemApi } from './file-system-api';
import { buildSeed } from './mock-seed';

@Injectable()
export class MockFileSystemApi extends FileSystemApi {
    private readonly config: MockConfig = inject(MOCK_CONFIG);
    private readonly seed = buildSeed();
    private readonly nodes: Map<string, FileSystemNode> = this.seed.nodes;
    private readonly rootIdByList: Record<DocumentListKey, string> = this.seed.rootIdByList;
    /** Stand-in for the signed-in user; stamped as `modifiedBy` on every mutation. */
    private readonly currentUser = 'You';

    public override listDocumentRoot(
        _projectId: string,
        listKey: DocumentListKey
    ): Observable<DocumentListing> {
        return this.read(() => this.listing(this.rootIdByList[listKey]));
    }

    public override listDocuments(
        _projectId: string,
        parentId: string
    ): Observable<DocumentListing> {
        return this.read(() => this.listing(parentId));
    }

    public override resolveDocumentPath(
        _projectId: string,
        listKey: DocumentListKey,
        path: string
    ): Observable<ResolvedDocumentPath> {
        return this.read(() => {
            let folderId = this.rootIdByList[listKey];
            const segments = path
                .split('/')
                .map((segment) => segment.trim())
                .filter((segment) => segment.length > 0);
            const canonicalNames: string[] = [];
            for (const segment of segments) {
                const target = segment.toLocaleLowerCase();
                const child = [...this.nodes.values()].find(
                    (node) =>
                        node.parentId === folderId &&
                        isFolder(node) &&
                        node.name.toLocaleLowerCase() === target
                );
                if (!child) {
                    throw new FileSystemError(
                        'not-found',
                        `Folder not found on path: "${segment}"`
                    );
                }
                folderId = child.id;
                canonicalNames.push(child.name);
            }

            return { canonicalPath: canonicalNames.join('/'), listing: this.listing(folderId) };
        });
    }

    public override createFolder(
        _projectId: string,
        parent: FolderNode,
        name: string
    ): Observable<FolderNode> {
        return this.write(() => {
            const parentNode = this.requireFolder(parent.id);
            this.assertValidName(name);
            this.assertNameAvailable(parentNode.id, name);

            const now = nowIso();
            const folder: FolderNode = {
                kind: 'folder',
                id: crypto.randomUUID(),
                path: joinPath(parentNode.path, name.trim()),
                name: name.trim(),
                parentId: parentNode.id,
                itemCount: 0,
                createdAt: now,
                modifiedAt: now,
                modifiedBy: this.currentUser
            };
            this.nodes.set(folder.id, folder);
            this.touchParentCounts(parentNode.id);

            return clone(folder);
        });
    }

    public override rename(
        _projectId: string,
        node: FileSystemNode,
        newName: string
    ): Observable<FileSystemNode> {
        return this.write(() => {
            const current = this.requireNode(node.id);
            if (current.parentId === null) {
                throw new FileSystemError('invalid-name', 'Root folder cannot be renamed');
            }
            this.assertValidName(newName);
            this.assertNameAvailable(current.parentId, newName, current.id);
            const parent = this.requireFolder(current.parentId);

            return this.repathNode(
                current.id,
                current.parentId,
                joinPath(parent.path, newName.trim()),
                newName.trim()
            );
        });
    }

    public override move(
        _projectId: string,
        node: FileSystemNode,
        newParent: FolderNode
    ): Observable<FileSystemNode> {
        return this.write(() => {
            const current = this.requireNode(node.id);
            const target = this.requireFolder(newParent.id);
            if (current.parentId === null) {
                throw new FileSystemError('invalid-name', 'Root folder cannot be moved');
            }
            if (current.parentId === target.id) { return clone(current); }
            if (isFolder(current) && this.isAncestorOrSelf(current.id, target.id)) {
                throw new FileSystemError(
                    'descendant-move',
                    'Cannot move a folder into itself or a descendant'
                );
            }
            this.assertNameAvailable(target.id, current.name, current.id);
            const oldParentId = current.parentId;
            const moved = this.repathNode(
                current.id,
                target.id,
                joinPath(target.path, current.name),
                current.name
            );
            this.touchParentCounts(oldParentId);
            this.touchParentCounts(target.id);

            return moved;
        });
    }

    public override copy(
        _projectId: string,
        node: FileSystemNode,
        newParent: FolderNode
    ): Observable<FileSystemNode> {
        return this.write(() => {
            const source = this.requireNode(node.id);
            const target = this.requireFolder(newParent.id);
            this.assertNameAvailable(target.id, source.name);
            const copied = this.copyRecursive(source, target.id, target.path, source.name);
            this.touchParentCounts(target.id);

            return clone(copied);
        });
    }

    public override delete(_projectId: string, node: FileSystemNode): Observable<void> {
        return this.write(() => {
            const current = this.requireNode(node.id);
            if (current.parentId === null) {
                throw new FileSystemError('permission-denied', 'Root folder cannot be deleted');
            }
            const parentId = current.parentId;
            const ids = isFolder(current) ? this.collectDescendantIds(current.id) : [current.id];
            for (const nodeId of ids) {
                this.nodes.delete(nodeId);
            }
            this.touchParentCounts(parentId);
        });
    }

    public override upload(
        _projectId: string,
        _parent: FolderNode,
        _file: File,
        _onProgress: (percent: number) => void,
        _signal?: AbortSignal
    ): Observable<FileNode> {
    // TODO: implement with the upload US.
        return notImplemented('upload');
    }

    /** Build a DocumentListing for `parentId`'s direct children. */
    private listing(parentId: string): DocumentListing {
        const parent = this.requireFolder(parentId);
        const folders: FolderNode[] = [];
        const files: FileNode[] = [];
        for (const node of this.nodes.values()) {
            if (node.parentId !== parent.id) { continue; }
            if (isFolder(node)) { folders.push(clone(node)); }
            else { files.push(clone(node)); }
        }
        folders.sort((a, b) => a.name.localeCompare(b.name));
        files.sort((a, b) => a.name.localeCompare(b.name));

        return { currentFolder: clone(parent), folders, files };
    }

    /** Simulated read: emits the factory result after randomized read latency. */
    private read<T>(factory: () => T): Observable<T> {
        return timer(this.latencyMs('read')).pipe(map(factory));
    }

    /**
   * Simulated write: after randomized write latency, runs the configured failure
   * check then the factory. A throw from either surfaces as an Observable error
   * notification — same outcome as the previous `await delay; throw` flow.
   */
    private write<T>(factory: () => T): Observable<T> {
        return timer(this.latencyMs('write')).pipe(
            map(() => {
                this.maybeFail();

                return factory();
            })
        );
    }

    private latencyMs(kind: 'read' | 'write'): number {
        const min = this.config.minLatencyMs;
        const max = kind === 'read' ? this.config.maxLatencyMs : this.config.maxLatencyMs + 200;

        return min + Math.random() * Math.max(0, max - min);
    }

    private maybeFail(): void {
        if (!this.config.enableErrors) { return; }
        if (Math.random() < this.config.errorRate) {
            throw new FileSystemError('network', 'Simulated network error');
        }
    }

    private requireNode(id: string): FileSystemNode {
        const node = this.nodes.get(id);
        if (!node) {
            throw new FileSystemError('not-found', `Node not found: ${id}`);
        }

        return node;
    }

    private requireFolder(id: string): FolderNode {
        const node = this.requireNode(id);
        if (!isFolder(node)) {
            throw new FileSystemError('not-found', `Folder not found: ${id}`);
        }

        return node;
    }

    private assertValidName(name: string): void {
        const result = validateName(name);
        if (!result.valid) {
            throw new FileSystemError('invalid-name', `Invalid name: ${result.reason}`);
        }
    }

    private assertNameAvailable(parentId: string, name: string, exceptId?: string): void {
        const normalized = name.trim().toLocaleLowerCase();
        for (const node of this.nodes.values()) {
            if (node.parentId !== parentId || node.id === exceptId) { continue; }
            if (node.name.toLocaleLowerCase() === normalized) {
                throw new FileSystemError(
                    'name-collision',
                    `An item named "${name.trim()}" already exists`
                );
            }
        }
    }

    private isAncestorOrSelf(ancestorId: string, candidateId: string): boolean {
        let current: string | null = candidateId;
        while (current !== null) {
            if (current === ancestorId) { return true; }
            current = this.requireFolder(current).parentId;
        }

        return false;
    }

    /**
   * Update path/name/parentId on `id` and rewrite the `path` prefix of its descendants.
   * IDs never change — they're stable UUIDs.
   */
    private repathNode(
        id: string,
        newParentId: string,
        newPath: string,
        newName: string
    ): FileSystemNode {
        const node = this.requireNode(id);
        const oldPath = node.path;
        const now = nowIso();
        const subtree = isFolder(node)
            ? this.collectDescendantIds(id).map((nodeId) => this.requireNode(nodeId))
            : [node];

        let updatedRoot: FileSystemNode | null = null;
        for (const current of subtree) {
            const isRoot = current.id === id;
            const updatedPath = isRoot
                ? newPath
                : current.path.replace(`${oldPath}/`, `${newPath}/`);
            const updated: FileSystemNode = isFolder(current)
                ? {
                    ...current,
                    path: updatedPath,
                    name: isRoot ? newName : current.name,
                    parentId: isRoot ? newParentId : current.parentId,
                    modifiedAt: isRoot ? now : current.modifiedAt,
                    modifiedBy: isRoot ? this.currentUser : current.modifiedBy
                }
                : {
                    ...current,
                    path: updatedPath,
                    name: isRoot ? newName : current.name,
                    parentId: isRoot ? newParentId : current.parentId,
                    modifiedAt: isRoot ? now : current.modifiedAt,
                    modifiedBy: isRoot ? this.currentUser : current.modifiedBy
                };
            this.nodes.set(updated.id, updated);
            if (isRoot) { updatedRoot = updated; }
        }

        if (!updatedRoot) {
            throw new FileSystemError('unknown', `Failed to update node: ${id}`);
        }

        return clone(updatedRoot);
    }

    private copyRecursive(
        source: FileSystemNode,
        targetParentId: string,
        targetParentPath: string,
        name: string
    ): FileSystemNode {
        const now = nowIso();
        const targetPath = joinPath(targetParentPath, name);
        this.assertNameAvailable(targetParentId, name);
        const children = isFolder(source)
            ? Array.from(this.nodes.values()).filter((node) => node.parentId === source.id)
            : [];

        if (!isFolder(source)) {
            const file: FileNode = {
                ...source,
                id: crypto.randomUUID(),
                path: targetPath,
                name,
                parentId: targetParentId,
                createdAt: now,
                modifiedAt: now,
                modifiedBy: this.currentUser
            };
            this.nodes.set(file.id, file);

            return file;
        }

        const folder: FolderNode = {
            ...source,
            id: crypto.randomUUID(),
            path: targetPath,
            name,
            parentId: targetParentId,
            createdAt: now,
            modifiedAt: now,
            modifiedBy: this.currentUser
        };
        this.nodes.set(folder.id, folder);

        for (const child of children) {
            this.copyRecursive(child, folder.id, folder.path, child.name);
        }
        this.touchParentCounts(folder.id);

        return folder;
    }

    private collectDescendantIds(folderId: string): string[] {
        const out = [folderId];
        for (const node of Array.from(this.nodes.values())) {
            if (node.parentId !== folderId) { continue; }
            if (isFolder(node)) {
                out.push(...this.collectDescendantIds(node.id));
            } else {
                out.push(node.id);
            }
        }

        return out;
    }

    private touchParentCounts(parentId: string): void {
        const parent = this.nodes.get(parentId);
        if (!parent || !isFolder(parent)) { return; }
        const itemCount = Array.from(this.nodes.values()).filter(
            (node) => node.parentId === parentId
        ).length;
        this.nodes.set(parent.id, {
            ...parent,
            itemCount,
            modifiedAt: nowIso()
        });
    }
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

function nowIso(): string {
    return new Date().toISOString();
}

function notImplemented(method: string): Observable<never> {
    return throwError(
        () => new FileSystemError('unknown', `MockFileSystemApi.${method} is not implemented yet`)
    );
}
