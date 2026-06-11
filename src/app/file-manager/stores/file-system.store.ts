import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import {
  removeEntities,
  removeEntity,
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
import { joinPath } from '../utils/path.utils';

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
    const markLoading = (folderId: string): void => {
      const ids = store.folderIdsWithLoadingChildren();
      if (ids.includes(folderId)) return;
      patchState(store, { folderIdsWithLoadingChildren: [...ids, folderId] });
    };
    const unmarkLoading = (folderId: string): void => {
      patchState(store, {
        folderIdsWithLoadingChildren: store
          .folderIdsWithLoadingChildren()
          .filter((id) => id !== folderId),
      });
    };
    const setError = (parentId: string, error: string | undefined): void => {
      patchState(store, {
        errorByParentId: { ...store.errorByParentId(), [parentId]: error },
      });
    };
    const markLoaded = (parentId: string): void => {
      const loaded = store.folderIdsWithLoadedChildren();
      if (loaded.includes(parentId)) return;
      patchState(store, { folderIdsWithLoadedChildren: [...loaded, parentId] });
    };
    const unmarkLoaded = (...parentIds: Array<string | null | undefined>): void => {
      const ids = new Set(parentIds.filter((id): id is string => typeof id === 'string'));
      if (ids.size === 0) return;
      patchState(store, {
        folderIdsWithLoadedChildren: store
          .folderIdsWithLoadedChildren()
          .filter((id) => !ids.has(id)),
      });
    };

    const requireProjectId = (): string => {
      const projectId = store.projectId();
      if (!projectId) {
        throw new FileSystemError('unknown', 'FileSystemStore has not been initialized');
      }
      return projectId;
    };

    const initialize = async (projectId: string): Promise<FolderNode> => {
      const { currentFolder, folders, files } = await api.listDocuments(projectId);
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
      markLoading(parentId);
      setError(parentId, undefined);
      try {
        const parent = store.entityMap()[parentId];
        if (!parent || !isFolder(parent)) {
          throw new FileSystemError('not-found', `Folder not found in cache: ${parentId}`);
        }
        const { currentFolder, folders, files } = await api.listDocuments(
          requireProjectId(),
          parent.id,
        );
        const nodes: FileSystemNode[] = [currentFolder, ...folders, ...files];
        const incomingIds = new Set(nodes.map((node) => node.id));
        const staleIds = store
          .entities()
          .filter((node) => node.parentId === parentId && !incomingIds.has(node.id))
          .flatMap((node) => cachedSubtreeIds(node.id));
        if (staleIds.length > 0) {
          patchState(store, removeEntities(staleIds));
        }
        patchState(store, setEntities(nodes));
        markLoaded(parentId);
      } catch (e) {
        setError(parentId, errorMessage(e));
      } finally {
        unmarkLoading(parentId);
      }
    };

    const invalidate = (parentId: string): void => {
      patchState(store, {
        folderIdsWithLoadedChildren: store
          .folderIdsWithLoadedChildren()
          .filter((id) => id !== parentId),
      });
      setError(parentId, undefined);
    };

    const cachedSubtreeIds = (id: string): string[] => {
      const out = [id];
      for (const node of store.entities()) {
        if (node.parentId !== id) continue;
        if (isFolder(node)) {
          out.push(...cachedSubtreeIds(node.id));
        } else {
          out.push(node.id);
        }
      }
      return out;
    };

    const cachedSubtree = (id: string): FileSystemNode[] => {
      const map = store.entityMap();
      return cachedSubtreeIds(id)
        .map((nodeId) => map[nodeId])
        .filter((node): node is FileSystemNode => node !== undefined);
    };

    const adjustParentCount = (parentId: string | null, delta: number): void => {
      if (!parentId) return;
      const parent = store.entityMap()[parentId];
      if (!parent || !isFolder(parent)) return;
      patchState(
        store,
        setEntity<FileSystemNode>({
          ...parent,
          itemCount: Math.max(0, parent.itemCount + delta),
          modifiedAt: new Date().toISOString(),
        }),
      );
    };

    /**
     * Compute the new cached subtree after a rename or move. IDs are stable —
     * only path, plus name/parentId/modifiedAt on the root, change.
     */
    const updateCachedSubtreePaths = (
      id: string,
      newParentId: string,
      newPath: string,
      newName: string,
    ): FileSystemNode[] => {
      const nodes = cachedSubtree(id);
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
      const now = new Date().toISOString();
      const temp: FolderNode = {
        kind: 'folder',
        id: `temp-${crypto.randomUUID()}`,
        path: joinPath(parent.path, trimmed),
        name: trimmed,
        parentId,
        itemCount: 0,
        createdAt: now,
        modifiedAt: now,
      };
      patchState(store, setEntity<FileSystemNode>(temp));
      adjustParentCount(parentId, 1);
      try {
        const created = await api.createFolder(requireProjectId(), parent, trimmed);
        patchState(store, removeEntity(temp.id), setEntity<FileSystemNode>(created));
        return created;
      } catch (e) {
        patchState(store, removeEntity(temp.id));
        adjustParentCount(parentId, -1);
        throw e;
      }
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
      const snapshot = cachedSubtree(id);
      const updated = updateCachedSubtreePaths(
        id,
        node.parentId,
        joinPath(parent.path, newName),
        newName,
      );
      patchState(store, setEntities(updated));
      try {
        const renamed = await api.rename(requireProjectId(), node, newName);
        patchState(store, setEntity<FileSystemNode>(renamed));
        unmarkLoaded(id);
        return renamed;
      } catch (e) {
        patchState(store, setEntities(snapshot));
        throw e;
      }
    };

    const deleteNodes = async (ids: string | string[]): Promise<void> => {
      const id = onlySingleId(ids, 'delete');
      const snapshot = cachedSubtree(id);
      const node = snapshot.find((candidate) => candidate.id === id);
      if (!node) throw new FileSystemError('not-found', `Node not found in cache: ${id}`);
      const removedIds = snapshot.map((candidate) => candidate.id);
      patchState(store, removeEntities(removedIds));
      adjustParentCount(node.parentId, -1);
      try {
        await api.delete(requireProjectId(), node);
        unmarkLoaded(id);
      } catch (e) {
        patchState(store, setEntities(snapshot));
        adjustParentCount(node.parentId, 1);
        throw e;
      }
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
      if (isFolder(node) && cachedSubtreeIds(id).includes(targetParentId)) {
        throw new FileSystemError(
          'descendant-move',
          'Cannot move a folder into itself or a descendant',
        );
      }
      const oldParentId = node.parentId;
      const snapshot = cachedSubtree(id);
      const updated = updateCachedSubtreePaths(
        id,
        targetParentId,
        joinPath(targetParent.path, node.name),
        node.name,
      );
      patchState(store, setEntities(updated));
      adjustParentCount(oldParentId, -1);
      adjustParentCount(targetParentId, 1);
      try {
        const moved = await api.move(requireProjectId(), node, targetParent);
        patchState(store, setEntity<FileSystemNode>(moved));
        unmarkLoaded(id, oldParentId, targetParentId);
      } catch (e) {
        patchState(store, setEntities(snapshot));
        adjustParentCount(oldParentId, 1);
        adjustParentCount(targetParentId, -1);
        throw e;
      }
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
      const copied = await api.copy(requireProjectId(), source, targetParent);
      patchState(store, setEntity<FileSystemNode>(copied));
      adjustParentCount(targetParentId, 1);
      unmarkLoaded(targetParentId);
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
