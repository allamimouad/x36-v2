import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import type { FileSystemNode, FolderNode } from '../models/file-system-node.model';
import { isFolder } from '../models/file-system-node.model';
import { FileSystemApi } from '../services/file-system/file-system-api';
import { MockFileSystemApi } from '../services/mock/mock-file-system-api';
import { MOCK_CONFIG } from '../services/mock/mock-config.token';
import { FileSystemStore } from './file-system.store';

/**
 * Mutations must not act on a connection that replaced theirs, and must prune
 * everything the server removed — including what arrived while they were in flight.
 */
describe('FileSystemStore mutation connection safety', () => {
    let api: MockFileSystemApi;
    let store: InstanceType<typeof FileSystemStore>;

    beforeEach(async () => {
        TestBed.configureTestingModule({
            providers: [
                FileSystemStore,
                { provide: FileSystemApi, useClass: MockFileSystemApi },
                { provide: MOCK_CONFIG, useValue: {
                    errorRate: 0, minLatencyMs: 0, maxLatencyMs: 0, enableErrors: false
                } }
            ]
        });
        api = TestBed.inject(FileSystemApi) as MockFileSystemApi;
        store = TestBed.inject(FileSystemStore);
        await store.initialize('project-123');
    });

    function contracts(): FolderNode {
        const folder = store.entities().find((node): node is FolderNode =>
            isFolder(node) && node.path === '/execution/Contracts');
        if (!folder) { throw new Error('Expected Contracts folder'); }

        return folder;
    }

    async function expectCancelled(pending: Promise<unknown>): Promise<void> {
        await expectAsync(pending).toBeRejectedWithError(/cancelled|changed/i);
    }

    it('discards a delete that outlived its connection', async () => {
        const response = new Subject<undefined>();
        spyOn(api, 'delete').and.returnValue(response);
        const folder = contracts();
        const pending = store.delete(folder.id);

        await store.initialize('project-123');
        response.next(undefined);
        response.complete();
        await expectCancelled(pending);

        // The refreshed cache came from the server; the late response must not edit it.
        expect(store.entityMap()[folder.id]).toBeDefined();
    });

    it('discards a folder creation that outlived its connection', async () => {
        const response = new Subject<FolderNode>();
        spyOn(api, 'createFolder').and.returnValue(response);
        const parent = contracts();
        const pending = store.createFolder(parent.id, 'Late folder');

        await store.initialize('project-123');
        response.next({ ...parent, id: 'late-folder', name: 'Late folder' });
        response.complete();
        await expectCancelled(pending);

        expect(store.entityMap()['late-folder']).toBeUndefined();
    });

    it('discards a rename that outlived its connection', async () => {
        const response = new Subject<FileSystemNode>();
        spyOn(api, 'rename').and.returnValue(response);
        const folder = contracts();
        const pending = store.rename(folder, 'Renamed');

        await store.initialize('project-123');
        response.next({ ...folder, name: 'Renamed' });
        response.complete();
        await expectCancelled(pending);

        expect(store.entityMap()[folder.id].name).toBe(folder.name);
    });

    it('removes descendants that were resolved while the delete was pending', async () => {
        const response = new Subject<undefined>();
        spyOn(api, 'delete').and.returnValue(response);
        const folder = contracts();
        const pending = store.delete(folder.id);

        // Resolved mid-flight, and without its intermediate parents: only the path
        // fallback relates it back to the folder being deleted.
        const resolved = await store.loadPathListing('EXECUTION', 'Contracts/Vendors/2026');
        expect(store.entityMap()[resolved.folder.id]).toBeDefined();
        response.next(undefined);
        response.complete();
        const removed = await pending;

        expect(removed).toContain(resolved.folder.id);
        expect(store.entityMap()[resolved.folder.id]).toBeUndefined();
        expect(store.entityMap()[folder.id]).toBeUndefined();
    });
});
