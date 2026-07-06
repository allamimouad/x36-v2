import { computed, inject, isDevMode } from '@angular/core';
import { withDevToolsStub, withDevtools, withMapper } from '@angular-architects/ngrx-toolkit';
import {
    patchState,
    signalStore,
    withComputed,
    withMethods,
    withState,
    type EmptyFeatureResult,
    type SignalStoreFeature
} from '@ngrx/signals';
import { DOCUMENT_LIST_KEYS, type DocumentListKey } from '../models/document-list.model';
import {
    isFolder,
    type FileNode,
    type FileSystemNode,
    type FolderNode
} from '../models/file-system-node.model';
import { FileSystemReader } from './file-system-reader';

/**
 * A breadcrumb segment. Either id-based (cached navigation) or path-based (a folder
 * reached/derived from a typed path, whose ancestors may be uncached).
 */
export interface PathSegment {
    label: string;
    id?: string;
    listKey?: DocumentListKey;
    path?: string;
}

/** Context recorded for a folder opened by resolving a typed path. */
export interface ResolvedBreadcrumbContext {
    listKey: DocumentListKey;
    path: string; // canonical, '' = list root
}

export interface NavigationHistoryEntry {
    folderId: string;
    breadcrumb?: ResolvedBreadcrumbContext;
}

export interface FolderChildren {
    folders: FolderNode[];
    files: FileNode[];
}

interface NavigationState {
    currentFolderId: string | null;
    history: NavigationHistoryEntry[];
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
    navigationError: null
};

export const NAVIGATION_UNAVAILABLE = 'This folder is no longer available from this location.';

export const NavigationStore = signalStore(
    withState(initialState),
    navigationDevtoolsFeature(),
    withComputed((store) => {
        const fsReader = inject(FileSystemReader);
        const entityMap = fsReader.entityMap;
        const entities = fsReader.entities;

        const currentFolder = computed<FolderNode | null>(() => {
            const id = store.currentFolderId();
            if (!id) { return null; }
            const node: FileSystemNode | undefined = entityMap()[id];

            return node && isFolder(node) ? node : null;
        });

        const parentId = computed<string | null>(() => currentFolder()?.parentId ?? null);

        /** The resolved-path context of the active history entry, if any. */
        const currentBreadcrumb = computed<ResolvedBreadcrumbContext | null>(() => {
            const idx = store.currentHistoryIndex();
            const entry = idx >= 0 ? store.history()[idx] : undefined;

            return entry?.breadcrumb ?? null;
        });

        const _listKeyOfRoot = (rootId: string): DocumentListKey | null => {
            const roots = fsReader.rootIdByList();

            return DOCUMENT_LIST_KEYS.find((key) => roots[key] === rootId) ?? null;
        };

        const pathSegments = computed<PathSegment[]>(() => {
            const id = store.currentFolderId();
            if (!id) { return []; }
            const ctx = currentBreadcrumb();

            return ctx
                ? buildResolvedSegments(ctx, id)
                : buildCachedSegments(id, entityMap(), _listKeyOfRoot);
        });

        const currentFolderChildren = computed<FolderChildren>(() => {
            const id = store.currentFolderId();
            if (!id) { return { folders: [], files: [] }; }
            const all = entities();
            const folders: FolderNode[] = [];
            const files: FileNode[] = [];
            for (const n of all) {
                if (n.parentId !== id) { continue; }
                if (isFolder(n)) { folders.push(n); }
                else { files.push(n); }
            }
            folders.sort((a, b) => a.name.localeCompare(b.name));
            files.sort((a, b) => a.name.localeCompare(b.name));

            return { folders, files };
        });

        const canGoBack = computed(() => store.currentHistoryIndex() > 0);
        const canGoForward = computed(
            () =>
                store.currentHistoryIndex() >= 0 &&
        store.currentHistoryIndex() < store.history().length - 1
        );
        const canGoUp = computed(() => parentId() !== null);

        return {
            currentFolder,
            parentId,
            currentBreadcrumb,
            pathSegments,
            currentFolderChildren,
            canGoBack,
            canGoForward,
            canGoUp
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
            if (fsReader.folderIdsWithLoadingChildren().includes(id)) { return; }
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
                if (store.navigationError()) { patchState(store, { navigationError: null }); }
                _loadChildrenUnlessAlreadyLoading(id);

                return;
            }
            const idx = store.currentHistoryIndex();
            const truncated = store.history().slice(0, idx + 1);
            const newHistory: NavigationHistoryEntry[] = [...truncated, { folderId: id }];
            patchState(store, {
                currentFolderId: id,
                history: newHistory,
                currentHistoryIndex: newHistory.length - 1,
                navigationError: null
            });
            _loadChildrenUnlessAlreadyLoading(id);
        };

        /**
     * Open a folder reached by resolving a typed path. The listing is already loaded by
     * `FileSystemStore.loadPathListing`, so this records history with breadcrumb context
     * and switches the current folder WITHOUT calling loadChildren.
     */
        const openResolvedFolder = (
            folderId: string,
            breadcrumb: ResolvedBreadcrumbContext
        ): void => {
            const idx = store.currentHistoryIndex();
            const truncated = store.history().slice(0, idx + 1);
            const newHistory: NavigationHistoryEntry[] = [...truncated, { folderId, breadcrumb }];
            patchState(store, {
                currentFolderId: folderId,
                history: newHistory,
                currentHistoryIndex: newHistory.length - 1,
                navigationError: null
            });
        };

        /**
     * Move the history cursor to `entry`. If its folder is no longer cached, set the
     * unavailable tombstone. Otherwise clear it; revalidate only for normal entries —
     * resolved entries already loaded their listing when first opened.
     */
        const _goToHistory = (newIdx: number, entry: NavigationHistoryEntry): void => {
            patchState(store, { currentHistoryIndex: newIdx, currentFolderId: entry.folderId });
            if (!fsReader.entityMap()[entry.folderId]) {
                patchState(store, { navigationError: NAVIGATION_UNAVAILABLE });

                return;
            }
            patchState(store, { navigationError: null });
            if (!entry.breadcrumb) {
                _loadChildrenUnlessAlreadyLoading(entry.folderId);
            }
        };

        const initialize = (args: { currentFolderId: string; expandedRootIds: string[] }): void => {
            patchState(store, {
                currentFolderId: args.currentFolderId,
                history: [{ folderId: args.currentFolderId }],
                currentHistoryIndex: 0,
                expandedTreeIds: new Set(args.expandedRootIds),
                navigationError: null
            });
        };

        const back = (): void => {
            const idx = store.currentHistoryIndex();
            if (idx <= 0) { return; }
            const newIdx = idx - 1;
            const entry = store.history()[newIdx];
            if (!entry) { return; }
            _goToHistory(newIdx, entry);
        };

        const forward = (): void => {
            const idx = store.currentHistoryIndex();
            const hist = store.history();
            if (idx < 0 || idx >= hist.length - 1) { return; }
            const newIdx = idx + 1;
            const entry = hist[newIdx];
            if (!entry) { return; }
            _goToHistory(newIdx, entry);
        };

        const up = (): void => {
            const parent = store.parentId();
            if (parent === null) { return; }
            navigateTo(parent);
        };

        const refresh = (): void => {
            const id = store.currentFolderId();
            if (!id) { return; }
            // On a tombstone (unavailable history entry / id no longer cached) there is
            // nothing to refresh — don't attempt a load.
            if (store.navigationError() || !fsReader.entityMap()[id]) { return; }
            if (fsReader.folderIdsWithLoadingChildren().includes(id)) { return; }
            fsReader.invalidate(id);
            void fsReader.loadChildren(id);
        };

        /**
     * Drop references to ids that were removed from the cache (e.g. a moved subtree),
     * so expansion/selection/focus/rename state can't point at deleted nodes.
     */
        const pruneReferences = (ids: Iterable<string>): void => {
            const removed = new Set(ids);
            if (removed.size === 0) { return; }
            const focusedId = store.focusedId();
            const renamingId = store.renamingId();
            patchState(store, {
                expandedTreeIds: new Set(
                    [...store.expandedTreeIds()].filter((x) => !removed.has(x))
                ),
                selectedIds: new Set([...store.selectedIds()].filter((x) => !removed.has(x))),
                focusedId: focusedId !== null && removed.has(focusedId) ? null : focusedId,
                renamingId: renamingId !== null && removed.has(renamingId) ? null : renamingId
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
            if (!set.has(id)) { return; }
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
            openResolvedFolder,
            initialize,
            back,
            forward,
            up,
            refresh,
            expand,
            collapse,
            setExpanded,
            pruneReferences,
            // TODO: implement with the multi-select US.
            select(_id: string, _mode: 'single' | 'toggle' | 'range'): void {
                /* intentionally empty */
            },
            selectRange(_id: string): void {
                /* intentionally empty */
            },
            clearSelection(): void {
                /* intentionally empty */
            },
            startRename,
            endRename
        };
    })
);

/** Path-based segments from listKey + canonical path (ancestors may be uncached). */
function buildResolvedSegments(ctx: ResolvedBreadcrumbContext, currentId: string): PathSegment[] {
    if (!ctx.path) {
        return [{ label: ctx.listKey, listKey: ctx.listKey, path: '', id: currentId }];
    }
    const segs: PathSegment[] = [{ label: ctx.listKey, listKey: ctx.listKey, path: '' }];
    const names = ctx.path.split('/');
    let prefix = '';
    names.forEach((name, i) => {
        prefix = prefix ? `${prefix}/${name}` : name;
        const isLast = i === names.length - 1;
        segs.push(
            isLast
                ? { label: name, listKey: ctx.listKey, path: prefix, id: currentId }
                : { label: name, listKey: ctx.listKey, path: prefix }
        );
    });

    return segs;
}

/** Cached parent chain (id-based); the root segment's label is its list key. */
function buildCachedSegments(
    currentId: string,
    map: Record<string, FileSystemNode>,
    listKeyOfRoot: (rootId: string) => DocumentListKey | null
): PathSegment[] {
    const segs: PathSegment[] = [];
    let n: FileSystemNode | undefined = map[currentId];
    while (n) {
        if (!isFolder(n)) { break; }
        if (n.parentId === null) {
            const listKey = listKeyOfRoot(n.id);
            const rootSegment: PathSegment = listKey
                ? { label: listKey, id: n.id, listKey, path: '' }
                : { label: n.name, id: n.id };
            segs.unshift(rootSegment);
            break;
        }
        segs.unshift({ label: n.name, id: n.id });
        n = map[n.parentId];
    }

    return segs;
}

function navigationDevtoolsFeature(): SignalStoreFeature<EmptyFeatureResult, EmptyFeatureResult> {
    return isDevMode()
        ? withDevtools(
            'NavigationStore',
            withMapper<NavigationState>((state) => ({
                currentFolderId: state.currentFolderId,
                history: state.history,
                currentHistoryIndex: state.currentHistoryIndex,
                expandedTreeIds: [...state.expandedTreeIds],
                selectedIds: [...state.selectedIds],
                focusedId: state.focusedId,
                renamingId: state.renamingId,
                navigationError: state.navigationError
            }))
        )
        : withDevToolsStub('NavigationStore');
}

export type NavigationStoreInstance = InstanceType<typeof NavigationStore>;
