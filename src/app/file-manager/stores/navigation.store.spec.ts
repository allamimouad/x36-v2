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
    await fs.loadRoot();
    await fs.loadChildren('/');
  });

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
    nav.navigateTo('/');
    expect(nav.currentFolderId()).toBe('/');
    expect(nav.history()).toEqual(['/']);
    expect(nav.historyIndex()).toBe(0);
  });

  it('navigateTo to the same id is a no-op', () => {
    nav.navigateTo('/');
    nav.navigateTo('/');
    expect(nav.history()).toEqual(['/']);
    expect(nav.historyIndex()).toBe(0);
  });

  it('back walks the history backwards and disables at the start', () => {
    nav.navigateTo('/');
    nav.navigateTo('/Documents');
    expect(nav.canGoBack()).toBe(true);
    nav.back();
    expect(nav.currentFolderId()).toBe('/');
    expect(nav.canGoBack()).toBe(false);
  });

  it('forward re-walks after back', () => {
    nav.navigateTo('/');
    nav.navigateTo('/Documents');
    nav.back();
    expect(nav.canGoForward()).toBe(true);
    nav.forward();
    expect(nav.currentFolderId()).toBe('/Documents');
    expect(nav.canGoForward()).toBe(false);
  });

  it('navigateTo after back truncates the forward stack', () => {
    nav.navigateTo('/');
    nav.navigateTo('/Documents');
    nav.back();
    nav.navigateTo('/Shared');
    expect(nav.history()).toEqual(['/', '/Shared']);
    expect(nav.canGoForward()).toBe(false);
  });

  it('up navigates to the parent folder', () => {
    nav.navigateTo('/Documents');
    expect(nav.canGoUp()).toBe(true);
    nav.up();
    expect(nav.currentFolderId()).toBe('/');
    expect(nav.canGoUp()).toBe(false);
  });

  it('expand and collapse toggle the expandedTreeIds set', () => {
    expect(nav.expandedTreeIds().has('/')).toBe(false);
    nav.expand('/');
    expect(nav.expandedTreeIds().has('/')).toBe(true);
    nav.collapse('/');
    expect(nav.expandedTreeIds().has('/')).toBe(false);
  });

  it('exposes pathSegments derived from FileSystemStore entities', () => {
    nav.navigateTo('/Documents');
    const segs = nav.pathSegments();
    expect(segs.map((s) => s.id)).toEqual(['/', '/Documents']);
  });

  it('exposes currentFolderChildren split into folders and files', () => {
    nav.navigateTo('/');
    const { folders, files } = nav.currentFolderChildren();
    expect(folders.length).toBe(3);
    expect(files.length).toBe(0);
    expect(folders.map((f) => f.name)).toEqual(['Archive', 'Documents', 'Shared']);
  });
});
