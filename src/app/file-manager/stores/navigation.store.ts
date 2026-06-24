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
  /** Set when Back/Forward lands on a history id that is no longer cached. */
  navigationError: string | null;
}

const initialState: NavigationState = {
  currentFolderId: null,
  history: [],
  currentHistoryIndex: -1,
  expandedTreeIds: new Set<string>(),
  selectedIds: new Set<string>(),
  focusedId: null,
  renamingId: null,
  navigationError: null,
};

export const NAVIGATION_UNAVAILABLE = 'This folder is no longer available from this location.';

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
     *
     * `_`-prefixed: a private local closure (internal helper), NOT an NgRx private
     * store member — it is not returned from `withMethods`.
     */
    const _loadChildrenUnlessAlreadyLoading = (id: string): void => {
      if (fsReader.folderIdsWithLoadingChildren().includes(id)) return;
      void fsReader.loadChildren(id);
    };

    const navigateTo = (id: string): void => {
      if (store.currentFolderId() === id) {
        // Re-navigating to the current id: if it's a tombstone (no longer cached),
        // keep it unavailable — don't clear the message or attempt a load.
        if (!fsReader.entityMap()[id]) {
          patchState(store, { navigationError: NAVIGATION_UNAVAILABLE });
          return;
        }
        if (store.navigationError()) patchState(store, { navigationError: null });
        _loadChildrenUnlessAlreadyLoading(id);
        return;
      }
      const idx = store.currentHistoryIndex();
      const truncated = store.history().slice(0, idx + 1);
      const newHistory = [...truncated, id];
      patchState(store, {
        currentFolderId: id,
        history: newHistory,
        currentHistoryIndex: newHistory.length - 1,
        navigationError: null,
      });
      _loadChildrenUnlessAlreadyLoading(id);
    };

    /**
     * Move the history cursor to (newIdx, newId). If the target id is no longer
     * cached (its subtree was removed by a move), do not hit the backend — set the
     * unavailable tombstone state instead. Otherwise clear it and load normally.
     */
    const _goToHistory = (newIdx: number, newId: string): void => {
      patchState(store, { currentHistoryIndex: newIdx, currentFolderId: newId });
      if (fsReader.entityMap()[newId]) {
        patchState(store, { navigationError: null });
        _loadChildrenUnlessAlreadyLoading(newId);
      } else {
        patchState(store, { navigationError: NAVIGATION_UNAVAILABLE });
      }
    };

    const initialize = (rootId: string): void => {
      patchState(store, {
        currentFolderId: rootId,
        history: [rootId],
        currentHistoryIndex: 0,
        expandedTreeIds: new Set([rootId]),
        navigationError: null,
      });
    };

    const back = (): void => {
      const idx = store.currentHistoryIndex();
      if (idx <= 0) return;
      const newIdx = idx - 1;
      const newId = store.history()[newIdx];
      if (!newId) return;
      _goToHistory(newIdx, newId);
    };

    const forward = (): void => {
      const idx = store.currentHistoryIndex();
      const hist = store.history();
      if (idx < 0 || idx >= hist.length - 1) return;
      const newIdx = idx + 1;
      const newId = hist[newIdx];
      if (!newId) return;
      _goToHistory(newIdx, newId);
    };

    const up = (): void => {
      const parent = store.parentId();
      if (parent === null) return;
      navigateTo(parent);
    };

    const refresh = (): void => {
      const id = store.currentFolderId();
      if (!id) return;
      // On a tombstone (unavailable history entry / id no longer cached) there is
      // nothing to refresh — don't attempt a load.
      if (store.navigationError() || !fsReader.entityMap()[id]) return;
      if (fsReader.folderIdsWithLoadingChildren().includes(id)) return;
      fsReader.invalidate(id);
      void fsReader.loadChildren(id);
    };

    /**
     * Drop references to ids that were removed from the cache (e.g. a moved subtree),
     * so expansion/selection/focus/rename state can't point at deleted nodes.
     */
    const pruneReferences = (ids: Iterable<string>): void => {
      const removed = new Set(ids);
      if (removed.size === 0) return;
      const focusedId = store.focusedId();
      const renamingId = store.renamingId();
      patchState(store, {
        expandedTreeIds: new Set([...store.expandedTreeIds()].filter((x) => !removed.has(x))),
        selectedIds: new Set([...store.selectedIds()].filter((x) => !removed.has(x))),
        focusedId: focusedId !== null && removed.has(focusedId) ? null : focusedId,
        renamingId: renamingId !== null && removed.has(renamingId) ? null : renamingId,
      });
    };

    const expand = (id: string): void => {
      const set = store.expandedTreeIds();
      if (!set.has(id)) {
        const next = new Set(set);
        next.add(id);
        patchState(store, { expandedTreeIds: next });
      }
      _loadChildrenUnlessAlreadyLoading(id);
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
      pruneReferences,
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
