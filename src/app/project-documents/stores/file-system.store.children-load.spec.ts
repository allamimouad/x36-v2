import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import type { DocumentListing } from '../models/document-listing.model';
import { FileSystemError } from '../models/file-system-error.model';
import { isFolder, type FolderNode } from '../models/file-system-node.model';
import { FileSystemApi } from '../services/file-system/file-system-api';
import { MockFileSystemApi } from '../services/mock/mock-file-system-api';
import { MOCK_CONFIG } from '../services/mock/mock-config.token';
import { FileSystemStore } from './file-system.store';

/**
 * Lifecycle of the in-flight children-load map: it dedupes concurrent loads and lets a
 * caller await one, so it must not outlive the connection that issued its requests.
 */
describe('FileSystemStore children-load bookkeeping', () => {
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
                        enableErrors: false
                    }
                }
            ]
        });
        api = TestBed.inject(FileSystemApi) as MockFileSystemApi;
        store = TestBed.inject(FileSystemStore);
    });

    function contractsFolder(): FolderNode {
        const folder = store.entities().find((node): node is FolderNode =>
            isFolder(node) && node.path === '/execution/Contracts');
        if (!folder) { throw new Error('Expected Contracts folder'); }

        return folder;
    }

    it('issues a fresh request after a reinitialization discards a pending load',
        async () => {
            await store.initialize('project-123');
            const contracts = contractsFolder();
            const stalled = new Subject<DocumentListing>();
            const listDocuments = spyOn(api, 'listDocuments').and.returnValue(stalled);
            const stale = store.loadChildren(contracts.id);
            expect(listDocuments).toHaveBeenCalledTimes(1);

            listDocuments.and.callThrough();
            await store.initialize('project-123');
            listDocuments.calls.reset();
            await store.loadChildren(contracts.id);

            expect(listDocuments).toHaveBeenCalledTimes(1);
            stalled.complete();
            await stale;
        });

    it('lets a discarded load settle without evicting the request that replaced it',
        async () => {
            await store.initialize('project-123');
            const contracts = contractsFolder();
            const first = new Subject<DocumentListing>();
            const listDocuments = spyOn(api, 'listDocuments').and.returnValue(first);
            const stale = store.loadChildren(contracts.id);

            listDocuments.and.callThrough();
            await store.initialize('project-123');
            const second = new Subject<DocumentListing>();
            listDocuments.and.returnValue(second);
            const fresh = store.loadChildren(contracts.id);

            first.complete();
            await stale;

            expect(store.pendingChildrenLoad(contracts.id)).not.toBeNull();
            second.complete();
            await fresh;
            expect(store.pendingChildrenLoad(contracts.id)).toBeNull();
        });

    it('retires the loading marker and the pending load in the same step', async () => {
        await store.initialize('project-123');
        const contracts = contractsFolder();
        const listing = new Subject<DocumentListing>();
        spyOn(api, 'listDocuments').and.returnValue(listing);
        const load = store.loadChildren(contracts.id);
        expect(store.folderIdsWithLoadingChildren()).toContain(contracts.id);

        listing.next({ currentFolder: contracts, folders: [], files: [] });
        listing.complete();
        // Step one microtask at a time: the moment the marker clears, the map must
        // already agree, or a caller gated on the marker gets a settled promise.
        for (let step = 0; step < 50 &&
            store.folderIdsWithLoadingChildren().includes(contracts.id); step++) {
            await Promise.resolve();
        }

        expect(store.folderIdsWithLoadingChildren()).not.toContain(contracts.id);
        expect(store.pendingChildrenLoad(contracts.id)).toBeNull();
        await load;
    });
    it('leaves the replacing request\'s loading marker alone when a discarded load settles',
        async () => {
            await store.initialize('project-123');
            const contracts = contractsFolder();
            const first = new Subject<DocumentListing>();
            const listDocuments = spyOn(api, 'listDocuments').and.returnValue(first);
            const stale = store.loadChildren(contracts.id);

            listDocuments.and.callThrough();
            await store.initialize('project-123');
            const second = new Subject<DocumentListing>();
            listDocuments.and.returnValue(second);
            const fresh = store.loadChildren(contracts.id);

            first.complete();
            await stale;

            expect(store.folderIdsWithLoadingChildren()).toContain(contracts.id);
            expect(store.pendingChildrenLoad(contracts.id)).not.toBeNull();
            second.complete();
            await fresh;
            expect(store.folderIdsWithLoadingChildren()).not.toContain(contracts.id);
        });

    it('does not apply a discarded listing to the connection that replaced it', async () => {
        await store.initialize('project-123');
        const contracts = contractsFolder();
        const stalled = new Subject<DocumentListing>();
        spyOn(api, 'listDocuments').and.returnValue(stalled);
        const stale = store.loadChildren(contracts.id);

        await store.initialize('project-123');
        stalled.next({
            currentFolder: contracts,
            folders: [{ ...contracts, id: 'stale-child', parentId: contracts.id,
                path: `${contracts.path}/Stale`, name: 'Stale' }],
            files: []
        });
        stalled.complete();
        await stale;

        expect(store.entityMap()['stale-child']).toBeUndefined();
        expect(store.folderIdsWithLoadedChildren()).not.toContain(contracts.id);
    });

    it('does not record a discarded load\'s failure on the connection that replaced it',
        async () => {
            await store.initialize('project-123');
            const contracts = contractsFolder();
            const stalled = new Subject<DocumentListing>();
            spyOn(api, 'listDocuments').and.returnValue(stalled);
            const stale = store.loadChildren(contracts.id);

            await store.initialize('project-123');
            stalled.error(new FileSystemError('network', 'Offline'));
            await stale;

            expect(store.errorByParentId()[contracts.id]).toBeUndefined();
        });
});
