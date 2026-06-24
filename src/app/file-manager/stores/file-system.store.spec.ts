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
});
