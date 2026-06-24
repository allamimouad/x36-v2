import { TestBed } from '@angular/core/testing';
import { throwError } from 'rxjs';
import { isFolder, type FolderNode } from '../models/file-system-node.model';
import { FileSystemError } from '../models/file-system-error.model';
import { FileSystemApi } from '../services/file-system-api';
import { MockFileSystemApi } from '../services/mock-file-system-api';
import { MOCK_CONFIG } from '../tokens/mock-config.token';
import { FileSystemStore } from './file-system.store';

describe('FileSystemStore project-scoped API contract', () => {
  let api: MockFileSystemApi;
  let store: InstanceType<typeof FileSystemStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        FileSystemStore,
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
    api = TestBed.inject(FileSystemApi) as MockFileSystemApi;
    store = TestBed.inject(FileSystemStore);
  });

  it('initializes the root and its direct children with one listing request', async () => {
    const listDocuments = spyOn(api, 'listDocuments').and.callThrough();

    const root = await store.initialize('project-123');

    expect(listDocuments).toHaveBeenCalledOnceWith('project-123');
    expect(store.projectId()).toBe('project-123');
    expect(store.rootId()).toBe(root.id);
    expect(store.folderIdsWithLoadedChildren()).toContain(root.id);
    expect(store.entities().filter((node) => node.parentId === root.id).length).toBe(3);
  });

  it('loads nested content using the initialized project and parent ids', async () => {
    await store.initialize('project-123');
    const documents = store
      .entities()
      .find((node) => isFolder(node) && node.path === '/Documents');
    if (!documents) throw new Error('Expected Documents folder');
    const listDocuments = spyOn(api, 'listDocuments').and.callThrough();

    await store.loadChildren(documents.id);

    expect(listDocuments).toHaveBeenCalledOnceWith('project-123', documents.id);
  });

  it('passes the initialized project id to mutation operations', async () => {
    const root = await store.initialize('project-123');
    const createFolder = spyOn(api, 'createFolder').and.callThrough();

    await store.createFolder(root.id, 'New folder');

    expect(createFolder).toHaveBeenCalledOnceWith('project-123', root, 'New folder');
  });

  it('leaves the store unchanged when a write fails (pessimistic, no rollback needed)', async () => {
    const root = await store.initialize('project-123');
    const countBefore = store.entities().length;
    const itemCountBefore = (store.entityMap()[root.id] as FolderNode).itemCount;
    spyOn(api, 'createFolder').and.returnValue(
      throwError(() => new FileSystemError('network', 'simulated failure')),
    );

    await expectAsync(store.createFolder(root.id, 'New folder')).toBeRejected();

    expect(store.entities().length).toBe(countBefore);
    expect((store.entityMap()[root.id] as FolderNode).itemCount).toBe(itemCountBefore);
  });

  it('move replaces the cached subtree with the returned node and returns removed ids', async () => {
    const root = await store.initialize('project-123');
    const tops = store
      .entities()
      .filter((node): node is FolderNode => isFolder(node) && node.parentId === root.id);
    const source = tops[0];
    const target = tops[1];
    await store.loadChildren(source.id);
    const directChildren = store.entities().filter((node) => node.parentId === source.id);
    expect(directChildren.length).toBeGreaterThan(0);

    const removed = await store.move(source.id, target.id);

    // The moved node is present and reparented under the target...
    const moved = store.entityMap()[source.id] as FolderNode;
    expect(moved).toBeTruthy();
    expect(moved.parentId).toBe(target.id);
    // ...its cached descendants are dropped (replace, not repath)...
    expect(store.entities().some((node) => node.parentId === source.id)).toBe(false);
    for (const child of directChildren) {
      expect(store.entityMap()[child.id]).toBeUndefined();
    }
    // ...it is left collapsed/unloaded at the destination...
    expect(store.folderIdsWithLoadedChildren()).not.toContain(source.id);
    // ...and the removed subtree ids (source + its cached descendants) are returned.
    expect(removed).toContain(source.id);
    expect(removed.length).toBe(directChildren.length + 1);
  });
});
