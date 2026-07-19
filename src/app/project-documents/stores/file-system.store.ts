import { inject, isDevMode } from '@angular/core';
import { withDevToolsStub, withDevtools, withMapper } from '@angular-architects/ngrx-toolkit';
import {
    patchState,
    signalStore,
    withMethods,
    withState,
    type EmptyFeatureResult,
    type SignalStoreFeature
} from '@ngrx/signals';
import {
    catchError,
    defer,
    firstValueFrom,
    forkJoin,
    map,
    of,
    pipe,
    switchMap,
    type Observable
} from 'rxjs';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import {
    removeEntities,
    setAllEntities,
    setEntities,
    setEntity,
    withEntities
} from '@ngrx/signals/entities';
import type { DocumentListing } from '../models/document-listing.model';
import type {
    DocumentListRoots,
    DocumentListRootStatus
} from '../models/document-list.model';
import { DOCUMENT_LIST_KEYS, type DocumentListKey } from '../models/document-list.model';
import { FileSystemError } from '../models/file-system-error.model';
import {
    isFolder,
    type FileNode,
    type FileSystemNode,
    type FolderNode
} from '../models/file-system-node.model';
import { FileSystemApi } from '../services/file-system-api';

interface FileSystemState {
    projectId: string | null;
    folderIdsWithLoadingChildren: string[];
    errorByParentId: Record<string, FileSystemError | undefined>;
    folderIdsWithLoadedChildren: string[];
    rootIdByList: Record<DocumentListKey, string | null>;
    /** True while a typed-path / breadcrumb-path resolve is in flight. */
    isResolvingPath: boolean;
    /** True from the start of a project (re-)initialization until its roots are applied. */
    isInitializing: boolean;
    /** Per-list result of the most recent completed initialization; null before the first. */
    initializedRoots: DocumentListRoots | null;
}

type FileSystemDevtoolsState = FileSystemState & {
    entityMap: Record<string, FileSystemNode>;
};

interface RootLoadResult {
    listKey: DocumentListKey;
    listing: DocumentListing | null;
    root: DocumentListRootStatus;
}

const initialState: FileSystemState = {
    projectId: null,
    folderIdsWithLoadingChildren: [],
    errorByParentId: {},
    folderIdsWithLoadedChildren: [],
    rootIdByList: { execution: null, marketing: null },
    isResolvingPath: false,
    isInitializing: false,
    initializedRoots: null
};

export const FileSystemStore = signalStore(
    withEntities<FileSystemNode>(),
    withState(initialState),
    fileSystemDevtoolsFeature(),
    withMethods((store, api = inject(FileSystemApi)) => {
    // The `_`-prefixed functions below are private local closures (internal helpers),
    // NOT NgRx private store members — they are not returned from `withMethods`.
        const _markLoading = (folderId: string): void => {
            const ids = store.folderIdsWithLoadingChildren();
            if (ids.includes(folderId)) { return; }
            patchState(store, { folderIdsWithLoadingChildren: [...ids, folderId] });
        };
        const _unmarkLoading = (folderId: string): void => {
            patchState(store, {
                folderIdsWithLoadingChildren: store
                    .folderIdsWithLoadingChildren()
                    .filter((id) => id !== folderId)
            });
        };
        const _setError = (parentId: string, error: FileSystemError | undefined): void => {
            patchState(store, {
                errorByParentId: { ...store.errorByParentId(), [parentId]: error }
            });
        };
        const _markLoaded = (parentId: string): void => {
            const loaded = store.folderIdsWithLoadedChildren();
            if (loaded.includes(parentId)) { return; }
            patchState(store, { folderIdsWithLoadedChildren: [...loaded, parentId] });
        };
        const _unmarkLoaded = (...parentIds: (string | null | undefined)[]): void => {
            const ids = new Set(parentIds.filter((id): id is string => typeof id === 'string'));
            if (ids.size === 0) { return; }
            patchState(store, {
                folderIdsWithLoadedChildren: store
                    .folderIdsWithLoadedChildren()
                    .filter((id) => !ids.has(id))
            });
        };

        const _requireProjectId = (): string => {
            const projectId = store.projectId();
            if (!projectId) {
                throw new FileSystemError('unknown', 'FileSystemStore has not been initialized');
            }

            return projectId;
        };

        const _loadRoot$ = (
            projectId: string,
            listKey: DocumentListKey
        ): Observable<RootLoadResult> =>
            api.listDocumentRoot(projectId, listKey).pipe(
                map(
                    (listing): RootLoadResult => ({
                        listKey,
                        listing,
                        root: { status: 'loaded', root: listing.currentFolder }
                    })
                ),
                catchError((e) => {
                    const error = toFileSystemError(e);

                    return of<RootLoadResult>(
                        error.code === 'not-found'
                            ? { listKey, listing: null, root: { status: 'not-found' } }
                            : { listKey, listing: null, root: { status: 'error', error } }
                    );
                })
            );

        /** Wipe all project state and mark the given project as the one being loaded. */
        const _beginInitialize = (projectId: string): void => {
            patchState(store, setAllEntities<FileSystemNode>([]), {
                projectId,
                rootIdByList: { execution: null, marketing: null },
                folderIdsWithLoadingChildren: [],
                folderIdsWithLoadedChildren: [],
                errorByParentId: {},
                isResolvingPath: false,
                isInitializing: true
            });
        };

        const _applyInitialize = (loadedRoots: RootLoadResult[]): DocumentListRoots => {
            // forkJoin preserves DOCUMENT_LIST_KEYS order: [execution, marketing].
            const [execution, marketing] = loadedRoots;
            const roots: DocumentListRoots = {
                execution: execution.root,
                marketing: marketing.root
            };
            const nodes = loadedRoots.flatMap(({ listing }): FileSystemNode[] =>
                listing ? [listing.currentFolder, ...listing.folders, ...listing.files] : []
            );
            const rootIdByList = {
                execution: rootIdFromStatus(roots.execution),
                marketing: rootIdFromStatus(roots.marketing)
            };
            patchState(store, setAllEntities(nodes), {
                rootIdByList,
                folderIdsWithLoadedChildren: Object.values(rootIdByList).filter(
                    (id): id is string => id !== null
                ),
                isInitializing: false,
                initializedRoots: roots
            });

            return roots;
        };

        /**
     * One full project initialization as a cold Observable: reset on subscribe, load both
     * roots (per-list errors are captured as statuses, never thrown), apply on completion.
     * Unsubscribing before completion (switchMap on a project change) discards the load
     * without touching the store again.
     */
        const _initialize$ = (projectId: string): Observable<DocumentListRoots> =>
            defer(() => {
                _beginInitialize(projectId);

                return forkJoin(
                    DOCUMENT_LIST_KEYS.map((listKey) => _loadRoot$(projectId, listKey))
                );
            }).pipe(map(_applyInitialize));

        /**
     * Reactive project connection: call once with the `projectId` signal — every change
     * cancels any in-flight initialization (switchMap) and loads the new project. May also
     * be called imperatively with a plain id to force a retry of the same project.
     */
        const connectProject = rxMethod<string>(
            pipe(switchMap((projectId) => _initialize$(projectId)))
        );

        /** Promise facade over one initialization; used by unit tests and imperative callers. */
        const initialize = (projectId: string): Promise<DocumentListRoots> =>
            firstValueFrom(_initialize$(projectId));

        /**
     * Apply a folder listing: prune cached direct children no longer present, upsert the
     * folder + its direct children, and mark the folder loaded. Shared by `loadChildren`
     * and `loadPathListing`.
     */
        const _applyListing = (listing: DocumentListing): void => {
            const nodes: FileSystemNode[] = [
                listing.currentFolder,
                ...listing.folders,
                ...listing.files
            ];
            const incomingIds = new Set(nodes.map((node) => node.id));
            const staleIds = store
                .entities()
                .filter(
                    (node) =>
                        node.parentId === listing.currentFolder.id &&
                        !incomingIds.has(node.id)
                )
                .flatMap((node) => _cachedSubtreeIds(node.id));
            if (staleIds.length > 0) {
                patchState(store, removeEntities(staleIds));
            }
            patchState(store, setEntities(nodes));
            _markLoaded(listing.currentFolder.id);
        };

        const loadChildren = async (parentId: string): Promise<void> => {
            if (store.folderIdsWithLoadingChildren().includes(parentId)) { return; }
            _markLoading(parentId);
            _setError(parentId, undefined);
            try {
                const parent = store.entityMap()[parentId];
                if (!parent || !isFolder(parent)) {
                    throw new FileSystemError(
                        'not-found',
                        `Folder not found in cache: ${parentId}`
                    );
                }
                const listing = await firstValueFrom(
                    api.listDocuments(_requireProjectId(), parent.id)
                );
                _applyListing(listing);
            } catch (e) {
                _setError(parentId, toFileSystemError(e));
            } finally {
                _unmarkLoading(parentId);
            }
        };

        /**
     * Resolve a typed list-relative path to its target and load only that folder's
     * listing (no ancestors). Errors propagate — the caller surfaces them. Returns the
     * target folder and its canonical path.
     */
        const loadPathListing = async (
            listKey: DocumentListKey,
            path: string
        ): Promise<{ folder: FolderNode; canonicalPath: string }> => {
            patchState(store, { isResolvingPath: true });
            try {
                const { canonicalPath, listing } = await firstValueFrom(
                    api.resolveDocumentPath(_requireProjectId(), listKey, path)
                );
                _applyListing(listing);

                return { folder: listing.currentFolder, canonicalPath };
            } finally {
                patchState(store, { isResolvingPath: false });
            }
        };

        const invalidate = (parentId: string): void => {
            patchState(store, {
                folderIdsWithLoadedChildren: store
                    .folderIdsWithLoadedChildren()
                    .filter((id) => id !== parentId)
            });
            _setError(parentId, undefined);
        };

        const _cachedSubtreeIds = (id: string): string[] => {
            const out = [id];
            for (const node of store.entities()) {
                if (node.parentId !== id) { continue; }
                if (isFolder(node)) {
                    out.push(..._cachedSubtreeIds(node.id));
                } else {
                    out.push(node.id);
                }
            }

            return out;
        };

        const _cachedSubtree = (id: string): FileSystemNode[] => {
            const nodeById = store.entityMap();

            return _cachedSubtreeIds(id)
                .map((nodeId) => nodeById[nodeId])
                .filter((node): node is FileSystemNode => node !== undefined);
        };

        // Adjust the cached parent's itemCount by the structural delta of a confirmed
        // write (±1). itemCount is a deterministic consequence of an op the server
        // acknowledged, so it is safe to apply locally. We do NOT touch modifiedAt /
        // modifiedBy here: those are server-owned and we have no truthful value for them
        // (the mutation response carries them only for the affected node, not its parent).
        // Stale parent timestamps self-heal on the next revalidating load.
        const _adjustParentCount = (parentId: string | null, delta: number): void => {
            if (!parentId) { return; }
            const parent = store.entityMap()[parentId];
            if (!parent || !isFolder(parent)) { return; }
            patchState(
                store,
                setEntity<FileSystemNode>({
                    ...parent,
                    itemCount: Math.max(0, parent.itemCount + delta)
                })
            );
        };

        /**
     * Compute the new cached subtree after a rename. IDs are stable — only path, plus
     * name/parentId/modifiedAt on the root, change. (Move no longer uses this; it is
     * replace-on-success — it drops the moved subtree and inserts the returned node.)
     */
        const _updateCachedSubtreePaths = (
            id: string,
            newParentId: string,
            newPath: string,
            newName: string
        ): FileSystemNode[] => {
            const nodes = _cachedSubtree(id);
            const root = nodes.find((node) => node.id === id);
            if (!root) { throw new FileSystemError('not-found', `Node not found in cache: ${id}`); }
            const oldPath = root.path;
            const now = new Date().toISOString();

            return nodes.map((node): FileSystemNode => {
                const isRoot = node.id === id;
                const path = isRoot ? newPath : node.path.replace(`${oldPath}/`, `${newPath}/`);

                return isFolder(node)
                    ? {
                        ...node,
                        path,
                        name: isRoot ? newName : node.name,
                        parentId: isRoot ? newParentId : node.parentId,
                        modifiedAt: isRoot ? now : node.modifiedAt
                    }
                    : {
                        ...node,
                        path,
                        name: isRoot ? newName : node.name,
                        parentId: isRoot ? newParentId : node.parentId,
                        modifiedAt: isRoot ? now : node.modifiedAt
                    };
            });
        };

        const createFolder = async (parentId: string, name: string): Promise<FolderNode> => {
            const parent = store.entityMap()[parentId];
            if (!parent || !isFolder(parent)) {
                throw new FileSystemError(
                    'not-found',
                    `Parent folder not found in cache: ${parentId}`
                );
            }
            const trimmed = name.trim();
            const created = await firstValueFrom(
                api.createFolder(_requireProjectId(), parent, trimmed)
            );
            patchState(store, setEntity<FileSystemNode>(created));
            _adjustParentCount(parentId, 1);

            return created;
        };

        const rename = async (id: string, newName: string): Promise<FileSystemNode> => {
            const node = store.entityMap()[id];
            if (!node) {
                throw new FileSystemError('not-found', `Node not found in cache: ${id}`);
            }
            if (node.parentId === null) {
                throw new FileSystemError('invalid-name', 'Root folder cannot be renamed');
            }
            const parent = store.entityMap()[node.parentId];
            if (!parent || !isFolder(parent)) {
                throw new FileSystemError(
                    'not-found',
                    `Parent folder not found in cache: ${node.parentId}`
                );
            }
            const renamed = await firstValueFrom(api.rename(_requireProjectId(), node, newName));
            const updated = _updateCachedSubtreePaths(
                id,
                node.parentId,
                renamed.path,
                renamed.name
            );
            patchState(store, setEntities(updated), setEntity<FileSystemNode>(renamed));
            _unmarkLoaded(id);

            return renamed;
        };

        const deleteNodes = async (ids: string | string[]): Promise<void> => {
            const id = onlySingleId(ids, 'delete');
            const subtree = _cachedSubtree(id);
            const node = subtree.find((candidate) => candidate.id === id);
            if (!node) { throw new FileSystemError('not-found', `Node not found in cache: ${id}`); }
            await firstValueFrom(api.delete(_requireProjectId(), node));
            patchState(store, removeEntities(subtree.map((candidate) => candidate.id)));
            _adjustParentCount(node.parentId, -1);
            // Clear loaded markers for every removed folder, not just the root — loaded
            // descendant folders would otherwise leave orphaned ids in the loaded set.
            _unmarkLoaded(...subtree.filter(isFolder).map((folder) => folder.id));
        };

        // Clear loaded/loading markers for a removed subtree only (incl. its root, so a
        // moved node shows collapsed/unloaded at the destination). Old/target parents stay
        // loaded — their child lists are correct via the local remove + insert.
        const clearRemovedFolderMarkers = (removedSubtree: FileSystemNode[]): void => {
            const removedFolderIds = removedSubtree.filter(isFolder).map((folder) => folder.id);
            _unmarkLoaded(...removedFolderIds);
            const removedSet = new Set(removedFolderIds);
            patchState(store, {
                folderIdsWithLoadingChildren: store
                    .folderIdsWithLoadingChildren()
                    .filter((fid) => !removedSet.has(fid))
            });
        };

        /**
     * Replace-on-success: drop the moved node's cached subtree and insert only the
     * server-returned `moved` node (collapsed/unloaded), rather than repathing and
     * preserving possibly-stale descendants. Returns the removed subtree ids so a
     * coordinator can prune navigation/clipboard references that pointed into it.
     */
        const move = async (ids: string | string[], targetParentId: string): Promise<string[]> => {
            const id = onlySingleId(ids, 'move');
            const node = store.entityMap()[id];
            const targetParent = store.entityMap()[targetParentId];
            if (!node) {
                throw new FileSystemError('not-found', `Node not found in cache: ${id}`);
            }
            if (node.parentId === null) {
                throw new FileSystemError('invalid-name', 'Root folder cannot be moved');
            }
            if (!targetParent || !isFolder(targetParent)) {
                throw new FileSystemError(
                    'not-found',
                    `Target folder not found in cache: ${targetParentId}`
                );
            }
            if (node.parentId === targetParentId) { return []; }
            if (isFolder(node) && _cachedSubtreeIds(id).includes(targetParentId)) {
                throw new FileSystemError(
                    'descendant-move',
                    'Cannot move a folder into itself or a descendant'
                );
            }
            const oldParentId = node.parentId;
            const removedSubtree = _cachedSubtree(id);
            const removedIds = removedSubtree.map((candidate) => candidate.id);
            const moved = await firstValueFrom(api.move(_requireProjectId(), node, targetParent));
            patchState(store, removeEntities(removedIds), setEntity<FileSystemNode>(moved));
            _adjustParentCount(oldParentId, -1);
            _adjustParentCount(targetParentId, 1);
            clearRemovedFolderMarkers(removedSubtree);

            return removedIds;
        };

        const copy = async (ids: string | string[], targetParentId: string): Promise<void> => {
            const id = onlySingleId(ids, 'copy');
            const source = store.entityMap()[id];
            if (!source) {
                throw new FileSystemError('not-found', `Node not found in cache: ${id}`);
            }
            const targetParent = store.entityMap()[targetParentId];
            if (!targetParent || !isFolder(targetParent)) {
                throw new FileSystemError(
                    'not-found',
                    `Target folder not found in cache: ${targetParentId}`
                );
            }
            const copied = await firstValueFrom(
                api.copy(_requireProjectId(), source, targetParent)
            );
            patchState(store, setEntity<FileSystemNode>(copied));
            _adjustParentCount(targetParentId, 1);
            _unmarkLoaded(targetParentId);
        };

        return {
            connectProject,
            initialize,
            loadChildren,
            loadPathListing,
            invalidate,
            createFolder,
            rename,
            delete: deleteNodes,
            move,
            copy,
            // TODO: implement with the upload US.
            upload: (_parentId: string, _files: File[]): Promise<void> =>
                Promise.reject(notImplemented('upload'))
        };
    })
);

function fileSystemDevtoolsFeature(): SignalStoreFeature<EmptyFeatureResult, EmptyFeatureResult> {
    return isDevMode()
        ? withDevtools(
            'FileSystemStore',
            withMapper<FileSystemDevtoolsState>((state) => {
                const entities = Object.values(state.entityMap).sort((a, b) =>
                    a.path.localeCompare(b.path)
                );

                return {
                    projectId: state.projectId,
                    rootIdByList: state.rootIdByList,
                    entityCount: entities.length,
                    entities,
                    folderIdsWithLoadingChildren: state.folderIdsWithLoadingChildren,
                    folderIdsWithLoadedChildren: state.folderIdsWithLoadedChildren,
                    errorByParentId: compactErrors(state.errorByParentId),
                    isResolvingPath: state.isResolvingPath,
                    isInitializing: state.isInitializing,
                    initializedRoots: state.initializedRoots
                };
            })
        )
        : withDevToolsStub('FileSystemStore');
}

export type FileSystemStoreInstance = InstanceType<typeof FileSystemStore>;

interface DevtoolsFileSystemError {
    code: FileSystemError['code'];
    message: string;
}

function compactErrors(
    errors: Record<string, FileSystemError | undefined>
): Record<string, DevtoolsFileSystemError> {
    return Object.entries(errors).reduce<Record<string, DevtoolsFileSystemError>>(
        (acc, [id, error]) => {
            if (error !== undefined) {
                acc[id] = { code: error.code, message: error.message };
            }

            return acc;
        },
        {}
    );
}

function toFileSystemError(e: unknown): FileSystemError {
    if (e instanceof FileSystemError) { return e; }
    if (e instanceof Error) { return new FileSystemError('unknown', e.message, e); }

    return new FileSystemError('unknown', 'Unknown error', e);
}

function rootIdFromStatus(root: DocumentListRootStatus): string | null {
    return root.status === 'loaded' ? root.root.id : null;
}

function onlySingleId(ids: string | string[], method: string): string {
    if (typeof ids === 'string') { return ids; }
    if (ids.length === 1) { return ids[0]; }
    // TODO: bulk operations arrive with the multi-select US.
    throw notImplemented(`${method} bulk operations`);
}

function notImplemented(method: string): FileSystemError {
    return new FileSystemError('unknown', `FileSystemStore.${method} is not implemented yet`);
}

// Re-exports kept for callers that want narrow types.
export type { FileNode, FolderNode };
