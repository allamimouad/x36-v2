import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { setEntities, withEntities } from '@ngrx/signals/entities';
import { FileSystemError } from '../models/file-system-error.model';
import type {
  FileNode,
  FileSystemNode,
  FolderNode,
} from '../models/file-system-node.model';
import { FileSystemApi } from '../services/file-system-api';

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

    return {
      loadRoot,
      loadChildren,
      invalidate,
      createFolder: (_parentId: string, _name: string): Promise<FolderNode> =>
        Promise.reject(phase2('createFolder')),
      rename: (_id: string, _newName: string): Promise<FileSystemNode> =>
        Promise.reject(phase2('rename')),
      delete: (_ids: string | string[]): Promise<void> => Promise.reject(phase2('delete')),
      move: (_ids: string | string[], _targetParentId: string): Promise<void> =>
        Promise.reject(phase2('move')),
      copy: (_ids: string | string[], _targetParentId: string): Promise<void> =>
        Promise.reject(phase2('copy')),
      upload: (_parentId: string, _files: File[]): Promise<void> =>
        Promise.reject(phase2('upload')),
    };
  }),
);

export type FileSystemStoreInstance = InstanceType<typeof FileSystemStore>;

function errorMessage(e: unknown): string {
  if (e instanceof FileSystemError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Unknown error';
}

function phase2(method: string): FileSystemError {
  return new FileSystemError('unknown', `FileSystemStore.${method} is not implemented in Phase 1`);
}

// Re-exports kept for callers that want narrow types.
export type { FileNode, FolderNode };
