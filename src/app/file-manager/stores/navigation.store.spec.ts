import { TestBed } from '@angular/core/testing';
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
    const root = await fs.loadRoot();
    rootId = root.id;
    await fs.loadChildren(rootId);
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
    expect(nav.historyIndex()).toBe(-1);
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
    expect(nav.historyIndex()).toBe(0);
  });

  it('navigateTo to the same id is a no-op', () => {
    nav.navigateTo(rootId);
    nav.navigateTo(rootId);
    expect(nav.history()).toEqual([rootId]);
    expect(nav.historyIndex()).toBe(0);
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
