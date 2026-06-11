import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { FileSystemNode, FolderNode } from '../models/file-system-node.model';
import { FileSystemApi } from '../services/file-system-api';
import { MockFileSystemApi } from '../services/mock-file-system-api';
import { MOCK_CONFIG } from '../tokens/mock-config.token';
import { FileSystemReader } from './file-system-reader';
import { FileSystemStore } from './file-system.store';
import { NavigationStore } from './navigation.store';

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
            enableErrors: false,
          },
        },
      ],
    });
    fs = TestBed.inject(FileSystemStore);
    nav = TestBed.inject(NavigationStore);
    const root = await fs.initialize('test-project');
    rootId = root.id;
    docsId = byPath('/Documents');
    sharedId = byPath('/Shared');
  });

  function byPath(path: string): string {
    const node = fs.entities().find((n) => n.path === path);
    if (!node) throw new Error(`No entity at path: ${path}`);
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
    expect(nav.history()).toEqual([rootId]);
    expect(nav.currentHistoryIndex()).toBe(0);
  });

  it('initialize sets root navigation state without triggering another load', () => {
    nav.initialize(rootId);

    expect(nav.currentFolderId()).toBe(rootId);
    expect(nav.history()).toEqual([rootId]);
    expect(nav.currentHistoryIndex()).toBe(0);
    expect(nav.expandedTreeIds().has(rootId)).toBe(true);
  });

  it('navigateTo to the same id is a no-op', () => {
    nav.navigateTo(rootId);
    nav.navigateTo(rootId);
    expect(nav.history()).toEqual([rootId]);
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
    expect(nav.history()).toEqual([rootId, sharedId]);
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
    nav.startRename(docsId);
    expect(nav.focusedId()).toBe(docsId);
    expect(nav.renamingId()).toBe(docsId);

    nav.endRename();
    expect(nav.focusedId()).toBe(docsId);
    expect(nav.renamingId()).toBeNull();
  });

  it('exposes pathSegments derived from FileSystemStore entities', () => {
    nav.navigateTo(docsId);
    const segs = nav.pathSegments();
    expect(segs.map((s) => s.name)).toEqual(['', 'Documents']);
    expect(segs.map((s) => s.id)).toEqual([rootId, docsId]);
  });

  it('exposes currentFolderChildren split into folders and files', () => {
    nav.navigateTo(rootId);
    const { folders, files } = nav.currentFolderChildren();
    expect(folders.length).toBe(3);
    expect(files.length).toBe(0);
    expect(folders.map((f) => f.name)).toEqual(['Archive', 'Documents', 'Shared']);
  });
});

const fakeRoot: FolderNode = {
  kind: 'folder',
  id: 'root',
  path: '/',
  name: '',
  parentId: null,
  itemCount: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  modifiedAt: '2026-01-01T00:00:00.000Z',
};

const fakeDocs: FolderNode = {
  kind: 'folder',
  id: 'docs',
  path: '/Documents',
  name: 'Documents',
  parentId: fakeRoot.id,
  itemCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  modifiedAt: '2026-01-01T00:00:00.000Z',
};

const fakeShared: FolderNode = {
  kind: 'folder',
  id: 'shared',
  path: '/Shared',
  name: 'Shared',
  parentId: fakeRoot.id,
  itemCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  modifiedAt: '2026-01-01T00:00:00.000Z',
};

class FakeFileSystemReader extends FileSystemReader {
  readonly nodes: FileSystemNode[] = [fakeRoot, fakeDocs, fakeShared];
  readonly entityMap = signal<Record<string, FileSystemNode>>({
    [fakeRoot.id]: fakeRoot,
    [fakeDocs.id]: fakeDocs,
    [fakeShared.id]: fakeShared,
  });
  readonly entities = signal<FileSystemNode[]>(this.nodes);
  readonly folderIdsWithLoadedChildren = signal<string[]>([]);
  readonly folderIdsWithLoadingChildren = signal<string[]>([]);
  readonly loadChildrenSpy = jasmine.createSpy('loadChildren');
  readonly invalidateSpy = jasmine.createSpy('invalidate');

  loadChildren(parentId: string): Promise<void> {
    this.loadChildrenSpy(parentId);
    return Promise.resolve();
  }

  invalidate(parentId: string): void {
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
        { provide: FileSystemReader, useClass: FakeFileSystemReader },
      ],
    });
    reader = TestBed.inject(FileSystemReader) as FakeFileSystemReader;
    nav = TestBed.inject(NavigationStore);
  });

  it('navigateTo triggers a load for an unloaded folder', () => {
    nav.navigateTo(fakeDocs.id);

    expect(reader.loadChildrenSpy).toHaveBeenCalledOnceWith(fakeDocs.id);
  });

  it('initialize sets root navigation state without triggering a load', () => {
    nav.initialize(fakeRoot.id);

    expect(nav.currentFolderId()).toBe(fakeRoot.id);
    expect(nav.history()).toEqual([fakeRoot.id]);
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
});
