import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { FileSystemNode, FolderNode } from '../models/file-system-node.model';
import { FileSystemApi } from '../services/file-system-api';
import { MockFileSystemApi } from '../services/mock/mock-file-system-api';
import { MOCK_CONFIG } from '../services/mock/mock-config.token';
import { FileSystemReader } from './file-system-reader';
import { FileSystemStore } from './file-system.store';
import { NAVIGATION_UNAVAILABLE, NavigationStore } from './navigation.store';

describe('NavigationStore', () => {
    let fs: InstanceType<typeof FileSystemStore>;
    let nav: InstanceType<typeof NavigationStore>;
    let rootId: string;
    let docsId: string;
    let sharedId: string;

    beforeEach(async () => {
        TestBed.configureTestingModule({
            providers: [
                FileSystemStore,
                { provide: FileSystemReader, useExisting: FileSystemStore },
                NavigationStore,
                { provide: FileSystemApi, useClass: MockFileSystemApi },
                {
                    provide: MOCK_CONFIG,
                    useValue: {
                        errorRate: 0,
                        minLatencyMs: 0,
                        maxLatencyMs: 0,
                        enableErrors: false
                    }
                }
            ]
        });
        fs = TestBed.inject(FileSystemStore);
        nav = TestBed.inject(NavigationStore);
        const roots = await fs.initialize('test-project');
        if (roots.execution.status !== 'loaded') { throw new Error('Expected execution root'); }
        rootId = roots.execution.root.id;
        docsId = byPath('/execution/Contracts');
        sharedId = byPath('/execution/Schedules');
    });

    function byPath(path: string): string {
        const node = fs.entities().find((n) => n.path === path);
        if (!node) { throw new Error(`No entity at path: ${path}`); }

        return node.id;
    }

    it('starts with empty navigation state before any navigation', () => {
        expect(nav.currentFolderId()).toBeNull();
        expect(nav.history()).toEqual([]);
        expect(nav.currentHistoryIndex()).toBe(-1);
        expect(nav.expandedTreeIds().size).toBe(0);
        expect(nav.selectedIds().size).toBe(0);
        expect(nav.focusedId()).toBeNull();
        expect(nav.renamingId()).toBeNull();
        expect(nav.canGoBack()).toBe(false);
        expect(nav.canGoForward()).toBe(false);
        expect(nav.canGoUp()).toBe(false);
        expect(nav.pathSegments()).toEqual([]);
        expect(nav.currentFolderChildren()).toEqual({ folders: [], files: [] });
    });

    it('navigateTo records history and sets current', () => {
        nav.navigateTo(rootId);
        expect(nav.currentFolderId()).toBe(rootId);
        expect(nav.history()).toEqual([{ folderId: rootId }]);
        expect(nav.currentHistoryIndex()).toBe(0);
    });

    it('initialize sets root navigation state without triggering another load', () => {
        nav.initialize({ currentFolderId: rootId, expandedRootIds: [rootId] });

        expect(nav.currentFolderId()).toBe(rootId);
        expect(nav.history()).toEqual([{ folderId: rootId }]);
        expect(nav.currentHistoryIndex()).toBe(0);
        expect(nav.expandedTreeIds().has(rootId)).toBe(true);
    });

    it('navigateTo to the same id is a no-op', () => {
        nav.navigateTo(rootId);
        nav.navigateTo(rootId);
        expect(nav.history()).toEqual([{ folderId: rootId }]);
        expect(nav.currentHistoryIndex()).toBe(0);
    });

    it('back walks the history backwards and disables at the start', () => {
        nav.navigateTo(rootId);
        nav.navigateTo(docsId);
        expect(nav.canGoBack()).toBe(true);
        nav.back();
        expect(nav.currentFolderId()).toBe(rootId);
        expect(nav.canGoBack()).toBe(false);
    });

    it('forward re-walks after back', () => {
        nav.navigateTo(rootId);
        nav.navigateTo(docsId);
        nav.back();
        expect(nav.canGoForward()).toBe(true);
        nav.forward();
        expect(nav.currentFolderId()).toBe(docsId);
        expect(nav.canGoForward()).toBe(false);
    });

    it('navigateTo after back truncates the forward stack', () => {
        nav.navigateTo(rootId);
        nav.navigateTo(docsId);
        nav.back();
        nav.navigateTo(sharedId);
        expect(nav.history()).toEqual([{ folderId: rootId }, { folderId: sharedId }]);
        expect(nav.canGoForward()).toBe(false);
    });

    it('up navigates to the parent folder', () => {
        nav.navigateTo(docsId);
        expect(nav.canGoUp()).toBe(true);
        nav.up();
        expect(nav.currentFolderId()).toBe(rootId);
        expect(nav.canGoUp()).toBe(false);
    });

    it('expand and collapse toggle the expandedTreeIds set', () => {
        expect(nav.expandedTreeIds().has(rootId)).toBe(false);
        nav.expand(rootId);
        expect(nav.expandedTreeIds().has(rootId)).toBe(true);
        nav.collapse(rootId);
        expect(nav.expandedTreeIds().has(rootId)).toBe(false);
    });

    it('startRename tracks the focused and renaming item, and endRename clears rename mode', () => {
        nav.focus(sharedId);
        expect(nav.focusedId()).toBe(sharedId);

        nav.startRename(docsId);
        expect(nav.focusedId()).toBe(docsId);
        expect(nav.renamingId()).toBe(docsId);

        nav.endRename();
        expect(nav.focusedId()).toBe(docsId);
        expect(nav.renamingId()).toBeNull();
    });

    it('exposes pathSegments derived from FileSystemStore entities (cached: id-based)', () => {
        nav.navigateTo(docsId);
        const segs = nav.pathSegments();
        expect(segs.map((s) => s.label)).toEqual(['execution', 'Contracts']);
        expect(segs.map((s) => s.id)).toEqual([rootId, docsId]);
    });

    it('exposes currentFolderChildren split into folders and files', () => {
        nav.navigateTo(rootId);
        const { folders, files } = nav.currentFolderChildren();
        expect(folders.length).toBe(3);
        expect(files.length).toBe(0);
        expect(folders.map((f) => f.name)).toEqual(['Contracts', 'Schedules', 'Site Reports']);
    });
});

const fakeRoot: FolderNode = {
    kind: 'folder',
    listKey: 'execution',
    id: 'root',
    path: '/',
    name: '',
    parentId: null,
    itemCount: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z'
};

const fakeDocs: FolderNode = {
    kind: 'folder',
    listKey: 'execution',
    id: 'docs',
    path: '/Documents',
    name: 'Documents',
    parentId: fakeRoot.id,
    itemCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z'
};

const fakeShared: FolderNode = {
    kind: 'folder',
    listKey: 'execution',
    id: 'shared',
    path: '/Shared',
    name: 'Shared',
    parentId: fakeRoot.id,
    itemCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z'
};

class FakeFileSystemReader extends FileSystemReader {
    public readonly nodes: FileSystemNode[] = [fakeRoot, fakeDocs, fakeShared];
    public readonly entityMap = signal<Record<string, FileSystemNode>>({
        [fakeRoot.id]: fakeRoot,
        [fakeDocs.id]: fakeDocs,
        [fakeShared.id]: fakeShared
    });
    public readonly entities = signal<FileSystemNode[]>(this.nodes);
    public readonly folderIdsWithLoadedChildren = signal<string[]>([]);
    public readonly folderIdsWithLoadingChildren = signal<string[]>([]);
    public readonly loadChildrenSpy = jasmine.createSpy('loadChildren');
    public readonly invalidateSpy = jasmine.createSpy('invalidate');

    public loadChildren(parentId: string): Promise<void> {
        this.loadChildrenSpy(parentId);

        return Promise.resolve();
    }

    public invalidate(parentId: string): void {
        this.invalidateSpy(parentId);
    }
}

describe('NavigationStore load triggering', () => {
    let reader: FakeFileSystemReader;
    let nav: InstanceType<typeof NavigationStore>;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                NavigationStore,
                { provide: FileSystemReader, useClass: FakeFileSystemReader }
            ]
        });
        reader = TestBed.inject(FileSystemReader) as FakeFileSystemReader;
        nav = TestBed.inject(NavigationStore);
    });

    it('navigateTo triggers a load for an unloaded folder', () => {
        nav.navigateTo(fakeDocs.id);

        expect(reader.loadChildrenSpy).toHaveBeenCalledOnceWith(fakeDocs.id);
    });

    it('initialize sets root navigation state without triggering a load', () => {
        nav.initialize({ currentFolderId: fakeRoot.id, expandedRootIds: [fakeRoot.id] });

        expect(nav.currentFolderId()).toBe(fakeRoot.id);
        expect(nav.history()).toEqual([{ folderId: fakeRoot.id }]);
        expect(nav.expandedTreeIds().has(fakeRoot.id)).toBe(true);
        expect(reader.loadChildrenSpy).not.toHaveBeenCalled();
    });

    it('navigateTo reloads when the target already has cached children', () => {
        reader.folderIdsWithLoadedChildren.set([fakeDocs.id]);

        nav.navigateTo(fakeDocs.id);

        expect(reader.loadChildrenSpy).toHaveBeenCalledOnceWith(fakeDocs.id);
    });

    it('navigateTo skips loading when the target is already loading', () => {
        reader.folderIdsWithLoadingChildren.set([fakeDocs.id]);

        nav.navigateTo(fakeDocs.id);

        expect(reader.loadChildrenSpy).not.toHaveBeenCalled();
    });

    it('back triggers a load for the folder it returns to', () => {
        reader.folderIdsWithLoadedChildren.set([fakeDocs.id, fakeShared.id]);
        nav.navigateTo(fakeRoot.id);
        nav.navigateTo(fakeDocs.id);
        reader.folderIdsWithLoadedChildren.set([fakeDocs.id]);
        reader.loadChildrenSpy.calls.reset();

        nav.back();

        expect(nav.currentFolderId()).toBe(fakeRoot.id);
        expect(reader.loadChildrenSpy).toHaveBeenCalledOnceWith(fakeRoot.id);
    });

    it('forward triggers a load for the folder it reopens', () => {
        reader.folderIdsWithLoadedChildren.set([fakeRoot.id, fakeDocs.id]);
        nav.navigateTo(fakeRoot.id);
        nav.navigateTo(fakeDocs.id);
        nav.back();
        reader.folderIdsWithLoadedChildren.set([fakeRoot.id]);
        reader.loadChildrenSpy.calls.reset();

        nav.forward();

        expect(nav.currentFolderId()).toBe(fakeDocs.id);
        expect(reader.loadChildrenSpy).toHaveBeenCalledOnceWith(fakeDocs.id);
    });

    it('expand triggers a load for the expanded folder', () => {
        nav.expand(fakeDocs.id);

        expect(nav.expandedTreeIds().has(fakeDocs.id)).toBe(true);
        expect(reader.loadChildrenSpy).toHaveBeenCalledOnceWith(fakeDocs.id);
    });

    it('refresh invalidates and reloads the current folder', () => {
        nav.navigateTo(fakeDocs.id);
        reader.loadChildrenSpy.calls.reset();

        nav.refresh();

        expect(reader.invalidateSpy).toHaveBeenCalledOnceWith(fakeDocs.id);
        expect(reader.loadChildrenSpy).toHaveBeenCalledOnceWith(fakeDocs.id);
    });

    it('refresh skips invalidation and reload while the current folder is already loading', () => {
        nav.navigateTo(fakeDocs.id);
        reader.folderIdsWithLoadingChildren.set([fakeDocs.id]);
        reader.loadChildrenSpy.calls.reset();

        nav.refresh();

        expect(reader.invalidateSpy).not.toHaveBeenCalled();
        expect(reader.loadChildrenSpy).not.toHaveBeenCalled();
    });

    /** Remove an id from the fake cache to simulate a moved-away (tombstone) node. */
    function evict(id: string): void {
        const remaining = Object.entries(reader.entityMap())
            .filter(([nodeId]) => nodeId !== id);
        reader.entityMap.set(Object.fromEntries(remaining));
    }

    it('Back/Forward to a removed id shows the unavailable state without loading', () => {
        nav.navigateTo(fakeRoot.id);
        nav.navigateTo(fakeDocs.id);
        evict(fakeDocs.id);
        nav.back(); // to root (still cached)
        reader.loadChildrenSpy.calls.reset();

        nav.forward(); // to docs, now a tombstone

        expect(nav.currentFolderId()).toBe(fakeDocs.id);
        expect(nav.currentHistoryIndex()).toBe(1);
        expect(nav.navigationError()).toBe(NAVIGATION_UNAVAILABLE);
        expect(reader.loadChildrenSpy).not.toHaveBeenCalled();
    });

    it('navigating Back to a valid cached folder clears navigationError and loads', () => {
        nav.navigateTo(fakeRoot.id);
        nav.navigateTo(fakeDocs.id);
        evict(fakeDocs.id);
        nav.back();
        nav.forward(); // tombstone
        expect(nav.navigationError()).toBe(NAVIGATION_UNAVAILABLE);
        reader.loadChildrenSpy.calls.reset();

        nav.back(); // back to root (cached)

        expect(nav.currentFolderId()).toBe(fakeRoot.id);
        expect(nav.navigationError()).toBeNull();
        expect(reader.loadChildrenSpy).toHaveBeenCalledOnceWith(fakeRoot.id);
    });

    it('keeps the unavailable state when navigating to the current tombstone id', () => {
        nav.navigateTo(fakeRoot.id);
        nav.navigateTo(fakeDocs.id);
        evict(fakeDocs.id);
        nav.back();
        nav.forward(); // tombstone: currentFolderId === docs, navigationError set
        expect(nav.navigationError()).toBe(NAVIGATION_UNAVAILABLE);
        reader.loadChildrenSpy.calls.reset();

        nav.navigateTo(fakeDocs.id); // same id, still missing from cache

        expect(nav.navigationError()).toBe(NAVIGATION_UNAVAILABLE);
        expect(reader.loadChildrenSpy).not.toHaveBeenCalled();
    });

    it('refresh on a tombstone does not invalidate or load', () => {
        nav.navigateTo(fakeRoot.id);
        nav.navigateTo(fakeDocs.id);
        evict(fakeDocs.id);
        nav.back();
        nav.forward(); // tombstone
        reader.loadChildrenSpy.calls.reset();
        reader.invalidateSpy.calls.reset();

        nav.refresh();

        expect(reader.invalidateSpy).not.toHaveBeenCalled();
        expect(reader.loadChildrenSpy).not.toHaveBeenCalled();
    });

    it('pruneReferences drops expanded/focused/renaming ids in the removed set', () => {
        nav.expand(fakeDocs.id);
        nav.startRename(fakeDocs.id); // focused + renaming = docs
        expect(nav.expandedTreeIds().has(fakeDocs.id)).toBe(true);
        expect(nav.focusedId()).toBe(fakeDocs.id);
        expect(nav.renamingId()).toBe(fakeDocs.id);

        nav.pruneReferences([fakeDocs.id]);

        expect(nav.expandedTreeIds().has(fakeDocs.id)).toBe(false);
        expect(nav.focusedId()).toBeNull();
        expect(nav.renamingId()).toBeNull();
    });

    it('openResolvedFolder records breadcrumb context and does not call loadChildren', () => {
        nav.navigateTo(fakeRoot.id);
        reader.loadChildrenSpy.calls.reset();

        nav.openResolvedFolder(fakeDocs.id, { listKey: 'execution', path: 'Documents' });

        expect(nav.currentFolderId()).toBe(fakeDocs.id);
        expect(nav.currentBreadcrumb()).toEqual({ listKey: 'execution', path: 'Documents' });
        expect(reader.loadChildrenSpy).not.toHaveBeenCalled();
    });

    it('openResolvedFolder truncates forward history', () => {
        nav.navigateTo(fakeRoot.id);
        nav.navigateTo(fakeDocs.id);
        nav.back(); // forward to docs is now available

        nav.openResolvedFolder(fakeShared.id, { listKey: 'execution', path: 'Shared' });

        expect(nav.canGoForward()).toBe(false);
        expect(nav.history().length).toBe(2);
    });

    it('Back/Forward restores resolved breadcrumb context without reloading it', () => {
        nav.navigateTo(fakeRoot.id);
        nav.openResolvedFolder(fakeDocs.id, { listKey: 'execution', path: 'Documents' });

        nav.back();
        expect(nav.currentFolderId()).toBe(fakeRoot.id);
        expect(nav.currentBreadcrumb()).toBeNull();
        reader.loadChildrenSpy.calls.reset();

        nav.forward();
        expect(nav.currentFolderId()).toBe(fakeDocs.id);
        expect(nav.currentBreadcrumb()).toEqual({ listKey: 'execution', path: 'Documents' });
        expect(reader.loadChildrenSpy).not.toHaveBeenCalled();
    });

    it('pathSegments builds path-based segments for a resolved entry', () => {
        nav.openResolvedFolder(fakeDocs.id, { listKey: 'execution', path: 'Documents' });

        const segs = nav.pathSegments();
        expect(segs.map((s) => s.label)).toEqual(['execution', 'Documents']);
        expect(segs[0].path).toBe('');
        expect(segs[1].path).toBe('Documents');
        expect(segs[1].id).toBe(fakeDocs.id);
    });

    it('builds the full path-based breadcrumb even when ancestors are not cached', () => {
    // Only the target id (fakeDocs) is in the fake cache; 'Contracts'/'2026' are not.
        nav.openResolvedFolder(fakeDocs.id, { listKey: 'execution', path: 'Contracts/2026' });

        const segs = nav.pathSegments();
        expect(segs.map((s) => s.label)).toEqual(['execution', 'Contracts', '2026']);
        expect(segs.map((s) => s.path)).toEqual(['', 'Contracts', 'Contracts/2026']);
        expect(segs[segs.length - 1].id).toBe(fakeDocs.id);
        // Ancestor segments are path-based (no id) so clicking re-resolves them.
        expect(segs[1].id).toBeUndefined();
    });
});
