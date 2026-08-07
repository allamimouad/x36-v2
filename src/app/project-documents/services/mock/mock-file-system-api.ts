import { Injectable, inject } from '@angular/core';
import { Observable, map, timer } from 'rxjs';
import type { DocumentListing, ResolvedDocumentPath } from '../../models/document-listing.model';
import type { DocumentListKey } from '../../models/document-list.model';
import { FileSystemError } from '../../models/file-system-error.model';
import {
    isFolder,
    type FileNode,
    type FileSystemNode,
    type FolderNode
} from '../../models/file-system-node.model';
import { joinPath } from '../../utils/path.utils';
import { resolveNameCollision } from '../../utils/naming.utils';
import {
    FILE_MANAGER_CONFIG,
    type FileManagerConfig
} from '../../tokens/file-manager-config.token';
import { FileSystemApi } from '../file-system/file-system-api';
import { MOCK_CONFIG, type MockConfig } from './mock-config.token';
import { buildSeed } from './mock-seed';
import {
    assertNameAvailable,
    assertValidName,
    clone,
    collectDescendantIds,
    fileExplorerCopyName,
    normalizeMockPath,
    nowIso,
    touchParentCounts
} from './mock-node-utils';
import { simulateMockUpload } from './mock-upload';

@Injectable()
export class MockFileSystemApi extends FileSystemApi {
    private readonly config: MockConfig = inject(MOCK_CONFIG);
    private readonly fileManagerConfig: FileManagerConfig = inject(FILE_MANAGER_CONFIG);
    private readonly seed = buildSeed();
    private readonly nodes: Map<string, FileSystemNode> = this.seed.nodes;
    private readonly rootIdByList: Record<DocumentListKey, string> = this.seed.rootIdByList;
    private readonly unavailableFolderPaths = new Set(
        (this.config.unavailableFolderPaths ?? []).map(normalizeMockPath)
    );
    /** Stand-in for the signed-in user; stamped as `modifiedBy` on every mutation. */
    private readonly currentUser = 'You';

    public override listDocumentRoot(
        _projectId: string,
        listKey: DocumentListKey
    ): Observable<DocumentListing> {
        return this.read(() => this.listing(listKey, this.rootIdByList[listKey]));
    }

    public override listDocuments(
        _projectId: string,
        parent: FolderNode
    ): Observable<DocumentListing> {
        return this.read(() => this.listing(parent.listKey, parent.id));
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
                const parentId = folderId;
                const child = [...this.nodes.values()].find(
                    (node) =>
                        node.parentId === parentId &&
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

            return {
                canonicalPath: canonicalNames.join('/'),
                listing: this.listing(listKey, folderId)
            };
        });
    }

    public override createFolder(
        _projectId: string,
        parent: FolderNode,
        name: string
    ): Observable<FolderNode> {
        return this.write(() => {
            const parentNode = this.requireFolder(parent.id);
            assertValidName(name);
            const requestedName = name.trim();
            const canonicalName = resolveNameCollision(
                requestedName,
                [...this.nodes.values()]
                    .filter((node) => node.parentId === parentNode.id)
                    .map((node) => node.name),
                1
            );

            const now = nowIso();
            const folder: FolderNode = {
                kind: 'folder',
                listKey: parentNode.listKey,
                id: crypto.randomUUID(),
                path: joinPath(parentNode.path, canonicalName),
                name: canonicalName,
                parentId: parentNode.id,
                itemCount: 0,
                createdAt: now,
                modifiedAt: now,
                modifiedBy: this.currentUser
            };
            this.nodes.set(folder.id, folder);
            touchParentCounts(this.nodes, parentNode.id);

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
            assertValidName(newName);
            assertNameAvailable(this.nodes, current.parentId, newName, current.id);
            const parent = this.requireFolder(current.parentId);

            return this.repathNode(
                current.id,
                current.parentId,
                joinPath(parent.path, newName.trim()),
                newName.trim(),
                current.listKey
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
            assertNameAvailable(this.nodes, target.id, current.name, current.id);
            const oldParentId = current.parentId;
            const moved = this.repathNode(
                current.id,
                target.id,
                joinPath(target.path, current.name),
                current.name,
                target.listKey
            );
            touchParentCounts(this.nodes, oldParentId);
            touchParentCounts(this.nodes, target.id);

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
            if (isFolder(source) && this.isAncestorOrSelf(source.id, target.id)) {
                throw new FileSystemError(
                    'descendant-move',
                    'Cannot copy a folder into itself or a descendant'
                );
            }
            const existingNames = [...this.nodes.values()]
                .filter((candidate) => candidate.parentId === target.id)
                .map((candidate) => candidate.name);
            const requestedName = source.parentId === target.id
                ? fileExplorerCopyName(source.name)
                : source.name;
            const canonicalName = resolveNameCollision(requestedName, existingNames);
            const copied = this.copyRecursive(
                source,
                target.listKey,
                target.id,
                target.path,
                canonicalName
            );
            touchParentCounts(this.nodes, target.id);

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
            const ids = isFolder(current)
                ? collectDescendantIds(this.nodes, current.id)
                : [current.id];
            for (const nodeId of ids) {
                this.nodes.delete(nodeId);
            }
            touchParentCounts(this.nodes, parentId);
        });
    }

    public override upload(
        _projectId: string,
        parent: FolderNode,
        file: File,
        onProgress: (percent: number) => void,
        signal?: AbortSignal
    ): Observable<FileNode> {
        return simulateMockUpload({
            fileSize: file.size,
            maxUploadSizeBytes: this.fileManagerConfig.maxUploadSizeBytes,
            onProgress,
            signal,
            complete: () => this.completeUpload(parent, file)
        });
    }

    private completeUpload(parent: FolderNode, file: File): FileNode {
        this.maybeFail();
        const parentNode = this.requireFolder(parent.id);
        assertValidName(file.name);
        if (file.size > this.fileManagerConfig.maxUploadSizeBytes) {
            throw new FileSystemError(
                'too-large',
                'File exceeds the configured upload limit'
            );
        }
        assertNameAvailable(this.nodes, parentNode.id, file.name);
        const now = nowIso();
        const created: FileNode = {
            kind: 'file',
            listKey: parentNode.listKey,
            id: crypto.randomUUID(),
            path: joinPath(parentNode.path, file.name),
            name: file.name,
            parentId: parentNode.id,
            sizeBytes: file.size,
            createdAt: now,
            modifiedAt: now,
            modifiedBy: this.currentUser,
            contentType: file.type || undefined
        };
        this.nodes.set(created.id, created);
        touchParentCounts(this.nodes, parentNode.id);

        return clone(created);
    }

    /** Build a DocumentListing for `parentId`'s direct children in `listKey`. */
    private listing(listKey: DocumentListKey, parentId: string): DocumentListing {
        const parent = this.requireFolder(parentId);
        if (parent.listKey !== listKey) {
            throw new FileSystemError('not-found', `Folder not found in ${listKey}: ${parentId}`);
        }
        this.assertFolderAvailable(parent);
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

    private assertFolderAvailable(folder: FolderNode): void {
        if (!this.unavailableFolderPaths.has(normalizeMockPath(folder.path))) { return; }

        throw new FileSystemError(
            'not-found',
            `Folder is no longer available: ${folder.path}`
        );
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

    private isAncestorOrSelf(ancestorId: string, candidateId: string): boolean {
        let current: string | null = candidateId;
        while (current !== null) {
            if (current === ancestorId) { return true; }
            current = this.requireFolder(current).parentId;
        }

        return false;
    }

    /**
   * Update list/path/name/parentId on `id` and its descendants.
   * IDs never change — they're stable UUIDs.
   */
    private repathNode(
        id: string,
        newParentId: string,
        newPath: string,
        newName: string,
        newListKey: DocumentListKey
    ): FileSystemNode {
        const node = this.requireNode(id);
        const oldPath = node.path;
        const now = nowIso();
        const updatedRoot: FileSystemNode = {
            ...node,
            listKey: newListKey,
            path: newPath,
            name: newName,
            parentId: newParentId,
            modifiedAt: now,
            modifiedBy: this.currentUser
        };
        this.nodes.set(updatedRoot.id, updatedRoot);
        if (isFolder(node)) {
            this.repathDescendants(id, oldPath, newPath, newListKey);
        }

        return clone(updatedRoot);
    }

    /** Rewrite list/path context for every descendant; ids, names, and audit fields stay. */
    private repathDescendants(
        folderId: string,
        oldPath: string,
        newPath: string,
        newListKey: DocumentListKey
    ): void {
        const descendantIds = collectDescendantIds(this.nodes, folderId)
            .filter((nodeId) => nodeId !== folderId);
        for (const nodeId of descendantIds) {
            const current = this.requireNode(nodeId);
            const path = current.path.replace(`${oldPath}/`, `${newPath}/`);
            const updated: FileSystemNode = { ...current, listKey: newListKey, path };
            this.nodes.set(nodeId, updated);
        }
    }

    private copyRecursive(
        source: FileSystemNode,
        targetListKey: DocumentListKey,
        targetParentId: string,
        targetParentPath: string,
        name: string
    ): FileSystemNode {
        assertNameAvailable(this.nodes, targetParentId, name);
        const targetPath = joinPath(targetParentPath, name);

        return isFolder(source)
            ? this.copyFolderNode(source, targetListKey, targetParentId, targetPath, name)
            : this.copyFileNode(source, targetListKey, targetParentId, targetPath, name);
    }

    private copyFileNode(
        source: FileNode,
        targetListKey: DocumentListKey,
        targetParentId: string,
        targetPath: string,
        name: string
    ): FileNode {
        const now = nowIso();
        const file: FileNode = {
            ...source,
            listKey: targetListKey,
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

    private copyFolderNode(
        source: FolderNode,
        targetListKey: DocumentListKey,
        targetParentId: string,
        targetPath: string,
        name: string
    ): FolderNode {
        const now = nowIso();
        const children = Array.from(this.nodes.values())
            .filter((node) => node.parentId === source.id);
        const folder: FolderNode = {
            ...source,
            listKey: targetListKey,
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
            this.copyRecursive(child, targetListKey, folder.id, folder.path, child.name);
        }
        touchParentCounts(this.nodes, folder.id);

        return folder;
    }

}
