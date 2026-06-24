import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import {
  removeEntities,
  setEntities,
  setEntity,
  withEntities,
} from '@ngrx/signals/entities';
import { FileSystemError } from '../models/file-system-error.model';
import {
  isFolder,
  type FileNode,
  type FileSystemNode,
  type FolderNode,
} from '../models/file-system-node.model';
import { FileSystemApi } from '../services/file-system-api';

interface FileSystemState {
  projectId: string | null;
  folderIdsWithLoadingChildren: string[];
  errorByParentId: Record<string, string | undefined>;
  folderIdsWithLoadedChildren: string[];
  rootId: string | null;
}

const initialState: FileSystemState = {
  projectId: null,
  folderIdsWithLoadingChildren: [],
  errorByParentId: {},
  folderIdsWithLoadedChildren: [],
  rootId: null,
};

export const FileSystemStore = signalStore(
  withEntities<FileSystemNode>(),
  withState(initialState),
  withMethods((store, api = inject(FileSystemApi)) => {
    // The `_`-prefixed functions below are private local closures (internal helpers),
    // NOT NgRx private store members — they are not returned from `withMethods`.
    const _markLoading = (folderId: string): void => {
      const ids = store.folderIdsWithLoadingChildren();
      if (ids.includes(folderId)) return;
      patchState(store, { folderIdsWithLoadingChildren: [...ids, folderId] });
    };
    const _unmarkLoading = (folderId: string): void => {
      patchState(store, {
        folderIdsWithLoadingChildren: store
          .folderIdsWithLoadingChildren()
          .filter((id) => id !== folderId),
      });
    };
    const _setError = (parentId: string, error: string | undefined): void => {
      patchState(store, {
        errorByParentId: { ...store.errorByParentId(), [parentId]: error },
      });
    };
    const _markLoaded = (parentId: string): void => {
      const loaded = store.folderIdsWithLoadedChildren();
      if (loaded.includes(parentId)) return;
      patchState(store, { folderIdsWithLoadedChildren: [...loaded, parentId] });
    };
    const _unmarkLoaded = (...parentIds: Array<string | null | undefined>): void => {
      const ids = new Set(parentIds.filter((id): id is string => typeof id === 'string'));
      if (ids.size === 0) return;
      patchState(store, {
        folderIdsWithLoadedChildren: store
          .folderIdsWithLoadedChildren()
          .filter((id) => !ids.has(id)),
      });
    };

    const _requireProjectId = (): string => {
      const projectId = store.projectId();
      if (!projectId) {
        throw new FileSystemError('unknown', 'FileSystemStore has not been initialized');
      }
      return projectId;
    };

    const initialize = async (projectId: string): Promise<FolderNode> => {
      const { currentFolder, folders, files } = await firstValueFrom(api.listDocuments(projectId));
      const nodes: FileSystemNode[] = [currentFolder, ...folders, ...files];
      patchState(store, setEntities(nodes), {
        projectId,
        rootId: currentFolder.id,
        folderIdsWithLoadedChildren: [currentFolder.id],
      });
      return currentFolder;
    };

    const loadChildren = async (parentId: string): Promise<void> => {
      if (store.folderIdsWithLoadingChildren().includes(parentId)) return;
      _markLoading(parentId);
      _setError(parentId, undefined);
      try {
        const parent = store.entityMap()[parentId];
        if (!parent || !isFolder(parent)) {
          throw new FileSystemError('not-found', `Folder not found in cache: ${parentId}`);
        }
        const { currentFolder, folders, files } = await firstValueFrom(
          api.listDocuments(_requireProjectId(), parent.id),
        );
        const nodes: FileSystemNode[] = [currentFolder, ...folders, ...files];
        const incomingIds = new Set(nodes.map((node) => node.id));
        const staleIds = store
          .entities()
          .filter((node) => node.parentId === parentId && !incomingIds.has(node.id))
          .flatMap((node) => _cachedSubtreeIds(node.id));
        if (staleIds.length > 0) {
          patchState(store, removeEntities(staleIds));
        }
        patchState(store, setEntities(nodes));
        _markLoaded(parentId);
      } catch (e) {
        _setError(parentId, errorMessage(e));
      } finally {
        _unmarkLoading(parentId);
      }
    };

    const invalidate = (parentId: string): void => {
      patchState(store, {
        folderIdsWithLoadedChildren: store
          .folderIdsWithLoadedChildren()
          .filter((id) => id !== parentId),
      });
      _setError(parentId, undefined);
    };

    const _cachedSubtreeIds = (id: string): string[] => {
      const out = [id];
      for (const node of store.entities()) {
        if (node.parentId !== id) continue;
        if (isFolder(node)) {
          out.push(..._cachedSubtreeIds(node.id));
        } else {
          out.push(node.id);
        }
      }
      return out;
    };

    const _cachedSubtree = (id: string): FileSystemNode[] => {
      const map = store.entityMap();
      return _cachedSubtreeIds(id)
        .map((nodeId) => map[nodeId])
        .filter((node): node is FileSystemNode => node !== undefined);
    };

    // Adjust the cached parent's itemCount by the structural delta of a confirmed
    // write (±1). itemCount is a deterministic consequence of an op the server
    // acknowledged, so it is safe to apply locally. We do NOT touch modifiedAt /
    // modifiedBy here: those are server-owned and we have no truthful value for them
    // (the mutation response carries them only for the affected node, not its parent).
    // Stale parent timestamps self-heal on the next revalidating load.
    const _adjustParentCount = (parentId: string | null, delta: number): void => {
      if (!parentId) return;
      const parent = store.entityMap()[parentId];
      if (!parent || !isFolder(parent)) return;
      patchState(
        store,
        setEntity<FileSystemNode>({
          ...parent,
          itemCount: Math.max(0, parent.itemCount + delta),
        }),
      );
    };

    /**
     * Compute the new cached subtree after a rename or move. IDs are stable —
     * only path, plus name/parentId/modifiedAt on the root, change.
     */
    const _updateCachedSubtreePaths = (
      id: string,
      newParentId: string,
      newPath: string,
      newName: string,
    ): FileSystemNode[] => {
      const nodes = _cachedSubtree(id);
      const root = nodes.find((node) => node.id === id);
      if (!root) throw new FileSystemError('not-found', `Node not found in cache: ${id}`);
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
              modifiedAt: isRoot ? now : node.modifiedAt,
            }
          : {
              ...node,
              path,
              name: isRoot ? newName : node.name,
              parentId: isRoot ? newParentId : node.parentId,
              modifiedAt: isRoot ? now : node.modifiedAt,
            };
      });
    };

    const createFolder = async (parentId: string, name: string): Promise<FolderNode> => {
      const parent = store.entityMap()[parentId];
      if (!parent || !isFolder(parent)) {
        throw new FileSystemError('not-found', `Parent folder not found in cache: ${parentId}`);
      }
      const trimmed = name.trim();
      const created = await firstValueFrom(api.createFolder(_requireProjectId(), parent, trimmed));
      patchState(store, setEntity<FileSystemNode>(created));
      _adjustParentCount(parentId, 1);
      return created;
    };

    const rename = async (id: string, newName: string): Promise<FileSystemNode> => {
      const node = store.entityMap()[id];
      if (!node || node.parentId === null) {
        throw new FileSystemError('not-found', `Node not found in cache: ${id}`);
      }
      const parent = store.entityMap()[node.parentId];
      if (!parent || !isFolder(parent)) {
        throw new FileSystemError(
          'not-found',
          `Parent folder not found in cache: ${node.parentId}`,
        );
      }
      const renamed = await firstValueFrom(api.rename(_requireProjectId(), node, newName));
      const updated = _updateCachedSubtreePaths(id, node.parentId, renamed.path, renamed.name);
      patchState(store, setEntities(updated), setEntity<FileSystemNode>(renamed));
      _unmarkLoaded(id);
      return renamed;
    };

    const deleteNodes = async (ids: string | string[]): Promise<void> => {
      const id = onlySingleId(ids, 'delete');
      const subtree = _cachedSubtree(id);
      const node = subtree.find((candidate) => candidate.id === id);
      if (!node) throw new FileSystemError('not-found', `Node not found in cache: ${id}`);
      await firstValueFrom(api.delete(_requireProjectId(), node));
      patchState(store, removeEntities(subtree.map((candidate) => candidate.id)));
      _adjustParentCount(node.parentId, -1);
      // Clear loaded markers for every removed folder, not just the root — loaded
      // descendant folders would otherwise leave orphaned ids in the loaded set.
      _unmarkLoaded(...subtree.filter(isFolder).map((folder) => folder.id));
    };

    const move = async (ids: string | string[], targetParentId: string): Promise<void> => {
      const id = onlySingleId(ids, 'move');
      const node = store.entityMap()[id];
      const targetParent = store.entityMap()[targetParentId];
      if (!node || node.parentId === null) {
        throw new FileSystemError('not-found', `Node not found in cache: ${id}`);
      }
      if (!targetParent || !isFolder(targetParent)) {
        throw new FileSystemError(
          'not-found',
          `Target folder not found in cache: ${targetParentId}`,
        );
      }
      if (node.parentId === targetParentId) return;
      if (isFolder(node) && _cachedSubtreeIds(id).includes(targetParentId)) {
        throw new FileSystemError(
          'descendant-move',
          'Cannot move a folder into itself or a descendant',
        );
      }
      const oldParentId = node.parentId;
      const moved = await firstValueFrom(api.move(_requireProjectId(), node, targetParent));
      const updated = _updateCachedSubtreePaths(id, targetParentId, moved.path, moved.name);
      patchState(store, setEntities(updated), setEntity<FileSystemNode>(moved));
      _adjustParentCount(oldParentId, -1);
      _adjustParentCount(targetParentId, 1);
      _unmarkLoaded(id, oldParentId, targetParentId);
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
          `Target folder not found in cache: ${targetParentId}`,
        );
      }
      const copied = await firstValueFrom(api.copy(_requireProjectId(), source, targetParent));
      patchState(store, setEntity<FileSystemNode>(copied));
      _adjustParentCount(targetParentId, 1);
      _unmarkLoaded(targetParentId);
    };

    return {
      initialize,
      loadChildren,
      invalidate,
      createFolder,
      rename,
      delete: deleteNodes,
      move,
      copy,
      upload: (_parentId: string, _files: File[]): Promise<void> =>
        Promise.reject(notImplementedInPhase('upload', 5)),
    };
  }),
);

export type FileSystemStoreInstance = InstanceType<typeof FileSystemStore>;

function errorMessage(e: unknown): string {
  if (e instanceof FileSystemError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Unknown error';
}

function onlySingleId(ids: string | string[], method: string): string {
  if (typeof ids === 'string') return ids;
  if (ids.length === 1) return ids[0];
  throw notImplementedInPhase(`${method} bulk operations`, 3);
}

function notImplementedInPhase(method: string, phase: number): FileSystemError {
  return new FileSystemError(
    'unknown',
    `FileSystemStore.${method} is not implemented until Phase ${phase}`,
  );
}

// Re-exports kept for callers that want narrow types.
export type { FileNode, FolderNode };
