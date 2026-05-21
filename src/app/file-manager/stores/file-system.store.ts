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
  loadingByParentId: Record<string, boolean>;
  errorByParentId: Record<string, string | undefined>;
  loadedParentIds: string[];
  rootId: string | null;
}

const initialState: FileSystemState = {
  loadingByParentId: {},
  errorByParentId: {},
  loadedParentIds: [],
  rootId: null,
};

export const FileSystemStore = signalStore(
  withEntities<FileSystemNode>(),
  withState(initialState),
  withMethods((store, api = inject(FileSystemApi)) => {
    const setLoading = (parentId: string, loading: boolean): void => {
      patchState(store, {
        loadingByParentId: { ...store.loadingByParentId(), [parentId]: loading },
      });
    };
    const setError = (parentId: string, error: string | undefined): void => {
      patchState(store, {
        errorByParentId: { ...store.errorByParentId(), [parentId]: error },
      });
    };
    const markLoaded = (parentId: string): void => {
      const loaded = store.loadedParentIds();
      if (loaded.includes(parentId)) return;
      patchState(store, { loadedParentIds: [...loaded, parentId] });
    };
    const unmarkLoaded = (...parentIds: Array<string | null | undefined>): void => {
      const ids = new Set(parentIds.filter((id): id is string => typeof id === 'string'));
      if (ids.size === 0) return;
      patchState(store, {
        loadedParentIds: store.loadedParentIds().filter((id) => !ids.has(id)),
      });
    };

    const loadRoot = async (): Promise<FolderNode> => {
      const root = await api.getRoot();
      patchState(store, setEntities([root] as FileSystemNode[]), { rootId: root.id });
      return root;
    };

    const loadChildren = async (parentId: string): Promise<void> => {
      setLoading(parentId, true);
      setError(parentId, undefined);
      try {
        const { folders, files } = await api.listChildren(parentId);
        const nodes: FileSystemNode[] = [...folders, ...files];
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
        setLoading(parentId, false);
      }
    };

    const invalidate = (parentId: string): void => {
      patchState(store, {
        loadedParentIds: store.loadedParentIds().filter((id) => id !== parentId),
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

    const repathCachedSubtree = (
      id: string,
      newParentId: string,
      newPath: string,
      newName: string,
    ): { oldIds: string[]; updatedNodes: FileSystemNode[]; updatedRoot: FileSystemNode } => {
      const nodes = cachedSubtree(id);
      const root = nodes.find((node) => node.id === id);
      if (!root) throw new FileSystemError('not-found', `Node not found in cache: ${id}`);
      const oldPath = root.path;
      const updatedNodes = nodes.map((node): FileSystemNode => {
        const isRoot = node.id === id;
        const path = isRoot ? newPath : node.path.replace(`${oldPath}/`, `${newPath}/`);
        const parentId = isRoot ? newParentId : node.parentId?.replace(oldPath, newPath);
        return isFolder(node)
          ? {
              ...node,
              id: path,
              path,
              name: isRoot ? newName : node.name,
              parentId: parentId ?? null,
              modifiedAt: isRoot ? new Date().toISOString() : node.modifiedAt,
            }
          : {
              ...node,
              id: path,
              path,
              name: isRoot ? newName : node.name,
              parentId: parentId ?? newParentId,
              modifiedAt: isRoot ? new Date().toISOString() : node.modifiedAt,
            };
      });
      const updatedRoot = updatedNodes.find((node) => node.path === newPath);
      if (!updatedRoot) throw new FileSystemError('unknown', `Failed to repath node: ${id}`);
      return {
        oldIds: nodes.map((node) => node.id),
        updatedNodes,
        updatedRoot,
      };
    };

    const restoreSnapshot = (removeIds: string[], snapshot: FileSystemNode[]): void => {
      if (removeIds.length > 0) {
        patchState(store, removeEntities(removeIds));
      }
      if (snapshot.length > 0) {
        patchState(store, setEntities(snapshot));
      }
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
        const created = await api.createFolder(parentId, trimmed);
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
      const optimistic = repathCachedSubtree(
        id,
        node.parentId,
        joinPath(parent.path, newName),
        newName,
      );
      const snapshot = cachedSubtree(id);
      patchState(store, removeEntities(optimistic.oldIds), setEntities(optimistic.updatedNodes));
      try {
        const renamed = await api.rename(id, newName);
        patchState(
          store,
          removeEntity(optimistic.updatedRoot.id),
          setEntity<FileSystemNode>(renamed),
        );
        unmarkLoaded(id, optimistic.updatedRoot.id);
        return renamed;
      } catch (e) {
        restoreSnapshot(
          optimistic.updatedNodes.map((updated) => updated.id),
          snapshot,
        );
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
        await api.delete(id);
        unmarkLoaded(id);
      } catch (e) {
        restoreSnapshot([], snapshot);
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
      const snapshot = cachedSubtree(id);
      const optimistic = repathCachedSubtree(
        id,
        targetParentId,
        joinPath(targetParent.path, node.name),
        node.name,
      );
      patchState(store, removeEntities(optimistic.oldIds), setEntities(optimistic.updatedNodes));
      adjustParentCount(node.parentId, -1);
      adjustParentCount(targetParentId, 1);
      try {
        const moved = await api.move(id, targetParentId);
        patchState(
          store,
          removeEntity(optimistic.updatedRoot.id),
          setEntity<FileSystemNode>(moved),
        );
        unmarkLoaded(id, optimistic.updatedRoot.id, node.parentId, targetParentId);
      } catch (e) {
        restoreSnapshot(
          optimistic.updatedNodes.map((updated) => updated.id),
          snapshot,
        );
        adjustParentCount(node.parentId, 1);
        adjustParentCount(targetParentId, -1);
        throw e;
      }
    };

    const copy = async (ids: string | string[], targetParentId: string): Promise<void> => {
      const id = onlySingleId(ids, 'copy');
      const copied = await api.copy(id, targetParentId);
      patchState(store, setEntity<FileSystemNode>(copied));
      adjustParentCount(targetParentId, 1);
      unmarkLoaded(targetParentId);
    };

    return {
      loadRoot,
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
