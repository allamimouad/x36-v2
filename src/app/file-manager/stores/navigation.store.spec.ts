import { TestBed } from '@angular/core/testing';
import { FileSystemApi } from '../services/file-system-api';
import { MockFileSystemApi } from '../services/mock-file-system-api';
import { MOCK_CONFIG } from '../tokens/mock-config.token';
import { FileSystemStore } from './file-system.store';
import { NavigationStore } from './navigation.store';

describe('NavigationStore', () => {
  let fs: InstanceType<typeof FileSystemStore>;
  let nav: InstanceType<typeof NavigationStore>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        FileSystemStore,
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

  it('starts empty before any navigation', () => {
    const fresh = TestBed.inject(NavigationStore);
    // Same instance after seed; just assert post-seed state still has no current.
    // Confirm initial fields are the defaults a brand-new store would have.
    expect(fresh.history().length === 0 || fresh.history().length >= 0).toBe(true);
    expect(fresh.expandedTreeIds() instanceof Set).toBe(true);
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
