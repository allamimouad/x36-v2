import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import {
  isFolder,
  type FileNode,
  type FileSystemNode,
  type FolderNode,
} from '../models/file-system-node.model';
import { FileSystemReader } from './file-system-reader';

export interface PathSegment {
  id: string;
  name: string;
}

export interface FolderChildren {
  folders: FolderNode[];
  files: FileNode[];
}

interface NavigationState {
  currentFolderId: string | null;
  history: string[];
  currentHistoryIndex: number;
  expandedTreeIds: Set<string>;
  selectedIds: Set<string>;
  focusedId: string | null;
  renamingId: string | null;
}

const initialState: NavigationState = {
  currentFolderId: null,
  history: [],
  currentHistoryIndex: -1,
  expandedTreeIds: new Set<string>(),
  selectedIds: new Set<string>(),
  focusedId: null,
  renamingId: null,
};

export const NavigationStore = signalStore(
  withState(initialState),
  withComputed((store) => {
    const fsReader = inject(FileSystemReader);
    const entityMap = fsReader.entityMap;
    const entities = fsReader.entities;

    const currentFolder = computed<FolderNode | null>(() => {
      const id = store.currentFolderId();
      if (!id) return null;
      const node: FileSystemNode | undefined = entityMap()[id];
      return node && isFolder(node) ? node : null;
    });

    const parentId = computed<string | null>(() => currentFolder()?.parentId ?? null);

    const pathSegments = computed<PathSegment[]>(() => {
      const id = store.currentFolderId();
      if (!id) return [];
      const segs: PathSegment[] = [];
      const map = entityMap();
      let n: FileSystemNode | undefined = map[id];
      while (n) {
        if (!isFolder(n)) break;
        segs.unshift({ id: n.id, name: n.name });
        if (n.parentId === null) break;
        n = map[n.parentId];
      }
      return segs;
    });

    const currentFolderChildren = computed<FolderChildren>(() => {
      const id = store.currentFolderId();
      if (!id) return { folders: [], files: [] };
      const all = entities();
      const folders: FolderNode[] = [];
      const files: FileNode[] = [];
      for (const n of all) {
        if (n.parentId !== id) continue;
        if (isFolder(n)) folders.push(n);
        else files.push(n);
      }
      folders.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));
      return { folders, files };
    });

    const canGoBack = computed(() => store.currentHistoryIndex() > 0);
    const canGoForward = computed(
      () =>
        store.currentHistoryIndex() >= 0 &&
        store.currentHistoryIndex() < store.history().length - 1,
    );
    const canGoUp = computed(() => parentId() !== null);

    return {
      currentFolder,
      parentId,
      pathSegments,
      currentFolderChildren,
      canGoBack,
      canGoForward,
      canGoUp,
    };
  }),
  withMethods((store) => {
    const fsReader = inject(FileSystemReader);

    /**
     * Kick off loadChildren(id) unless the same folder is already loading.
     * Fire-and-forget — errors land in fileSystemStore's per-folder error map.
     */
    const loadChildrenUnlessAlreadyLoading = (id: string): void => {
      if (fsReader.folderIdsWithLoadingChildren().includes(id)) return;
      void fsReader.loadChildren(id);
    };

    const navigateTo = (id: string): void => {
      if (store.currentFolderId() === id) {
        loadChildrenUnlessAlreadyLoading(id);
        return;
      }
      const idx = store.currentHistoryIndex();
      const truncated = store.history().slice(0, idx + 1);
      const newHistory = [...truncated, id];
      patchState(store, {
        currentFolderId: id,
        history: newHistory,
        currentHistoryIndex: newHistory.length - 1,
      });
      loadChildrenUnlessAlreadyLoading(id);
    };

    const initialize = (rootId: string): void => {
      patchState(store, {
        currentFolderId: rootId,
        history: [rootId],
        currentHistoryIndex: 0,
        expandedTreeIds: new Set([rootId]),
      });
    };

    const back = (): void => {
      const idx = store.currentHistoryIndex();
      if (idx <= 0) return;
      const newIdx = idx - 1;
      const newId = store.history()[newIdx];
      if (!newId) return;
      patchState(store, {
        currentHistoryIndex: newIdx,
        currentFolderId: newId,
      });
      loadChildrenUnlessAlreadyLoading(newId);
    };

    const forward = (): void => {
      const idx = store.currentHistoryIndex();
      const hist = store.history();
      if (idx < 0 || idx >= hist.length - 1) return;
      const newIdx = idx + 1;
      const newId = hist[newIdx];
      if (!newId) return;
      patchState(store, {
        currentHistoryIndex: newIdx,
        currentFolderId: newId,
      });
      loadChildrenUnlessAlreadyLoading(newId);
    };

    const up = (): void => {
      const parent = store.parentId();
      if (parent === null) return;
      navigateTo(parent);
    };

    const refresh = (): void => {
      const id = store.currentFolderId();
      if (!id) return;
      if (fsReader.folderIdsWithLoadingChildren().includes(id)) return;
      fsReader.invalidate(id);
      void fsReader.loadChildren(id);
    };

    const expand = (id: string): void => {
      const set = store.expandedTreeIds();
      if (!set.has(id)) {
        const next = new Set(set);
        next.add(id);
        patchState(store, { expandedTreeIds: next });
      }
      loadChildrenUnlessAlreadyLoading(id);
    };

    const collapse = (id: string): void => {
      const set = store.expandedTreeIds();
      if (!set.has(id)) return;
      const next = new Set(set);
      next.delete(id);
      patchState(store, { expandedTreeIds: next });
    };

    const setExpanded = (ids: Iterable<string>): void => {
      patchState(store, { expandedTreeIds: new Set(ids) });
    };

    const startRename = (id: string): void => {
      patchState(store, { focusedId: id, renamingId: id });
    };

    const endRename = (): void => {
      patchState(store, { renamingId: null });
    };

    return {
      navigateTo,
      initialize,
      back,
      forward,
      up,
      refresh,
      expand,
      collapse,
      setExpanded,
      // Phase 3 stubs (kept here so containers can reference them already)
      select(_id: string, _mode: 'single' | 'toggle' | 'range'): void {
        /* Phase 3 */
      },
      selectRange(_id: string): void {
        /* Phase 3 */
      },
      clearSelection(): void {
        /* Phase 3 */
      },
      startRename,
      endRename,
    };
  }),
);

export type NavigationStoreInstance = InstanceType<typeof NavigationStore>;
