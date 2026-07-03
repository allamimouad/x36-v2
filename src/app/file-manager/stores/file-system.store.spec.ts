import { TestBed } from '@angular/core/testing';
import { throwError } from 'rxjs';
import { isFolder, type FolderNode } from '../models/file-system-node.model';
import { FileSystemError } from '../models/file-system-error.model';
import { FileSystemApi } from '../services/file-system-api';
import { MockFileSystemApi } from '../services/mock/mock-file-system-api';
import { MOCK_CONFIG } from '../services/mock/mock-config.token';
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
                        unavailableFolderPaths: ['execution/Unavailable on open']
                    }
                }
            ]
        });
        api = TestBed.inject(FileSystemApi) as MockFileSystemApi;
        store = TestBed.inject(FileSystemStore);
    });

    it('initializes both list roots and their direct children in parallel', async () => {
        const listDocumentRoot = spyOn(api, 'listDocumentRoot').and.callThrough();

        const roots = await store.initialize('project-123');

        expect(listDocumentRoot).toHaveBeenCalledTimes(2);
        expect(listDocumentRoot).toHaveBeenCalledWith('project-123', 'execution');
        expect(listDocumentRoot).toHaveBeenCalledWith('project-123', 'marketing');
        expect(store.projectId()).toBe('project-123');
        expect(store.rootIdByList().execution).toBe(roots.execution.id);
        expect(store.rootIdByList().marketing).toBe(roots.marketing.id);
        expect(store.folderIdsWithLoadedChildren()).toContain(roots.execution.id);
        expect(store.folderIdsWithLoadedChildren()).toContain(roots.marketing.id);
        expect(
            store.entities().filter((node) => node.parentId === roots.execution.id).length
        ).toBe(4);
    });

    it('loads nested content by parent id using the initialized project', async () => {
        await store.initialize('project-123');
        const contracts = store
            .entities()
            .find((node) => isFolder(node) && node.path === '/execution/Contracts');
        if (!contracts) { throw new Error('Expected Contracts folder'); }
        const listDocuments = spyOn(api, 'listDocuments').and.callThrough();

        await store.loadChildren(contracts.id);

        expect(listDocuments).toHaveBeenCalledOnceWith('project-123', contracts.id);
    });

    it('records an error when a configured unavailable folder is opened', async () => {
        await store.initialize('project-123');
        const unavailable = store
            .entities()
            .find((node) => isFolder(node) && node.path === '/execution/Unavailable on open');
        if (!unavailable) { throw new Error('Expected unavailable folder'); }

        await store.loadChildren(unavailable.id);

        expect(store.errorByParentId()[unavailable.id]).toContain(
            'Folder is no longer available'
        );
        expect(store.folderIdsWithLoadingChildren()).not.toContain(unavailable.id);
    });

    it('passes the initialized project id to mutation operations', async () => {
        const roots = await store.initialize('project-123');
        const createFolder = spyOn(api, 'createFolder').and.callThrough();

        await store.createFolder(roots.execution.id, 'New folder');

        expect(createFolder).toHaveBeenCalledOnceWith('project-123', roots.execution, 'New folder');
    });

    it('leaves the store unchanged when a write fails', async () => {
        const { execution: root } = await store.initialize('project-123');
        const countBefore = store.entities().length;
        const itemCountBefore = (store.entityMap()[root.id] as FolderNode).itemCount;
        spyOn(api, 'createFolder').and.returnValue(
            throwError(() => new FileSystemError('network', 'simulated failure'))
        );

        await expectAsync(store.createFolder(root.id, 'New folder')).toBeRejected();

        expect(store.entities().length).toBe(countBefore);
        expect((store.entityMap()[root.id] as FolderNode).itemCount).toBe(itemCountBefore);
    });

    it('move replaces the cached subtree with the returned node and removed ids', async () => {
        const { execution: root } = await store.initialize('project-123');
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

    it('loadPathListing resolves a typed path and returns canonical casing', async () => {
        await store.initialize('project-123');

        const { folder, canonicalPath } = await store.loadPathListing(
            'execution',
            'contracts/VENDORS'
        );

        expect(canonicalPath).toBe('Contracts/Vendors');
        expect(folder.path).toBe('/execution/Contracts/Vendors');
        expect(store.entityMap()[folder.id]).toBeTruthy();
        expect(store.folderIdsWithLoadedChildren()).toContain(folder.id);
        expect(store.entities().some((node) => node.parentId === folder.id)).toBe(true);
        expect(store.isResolvingPath()).toBeFalse();
    });

    it('loadPathListing with an empty path returns the list root', async () => {
        const roots = await store.initialize('project-123');

        const { folder, canonicalPath } = await store.loadPathListing('marketing', '');

        expect(canonicalPath).toBe('');
        expect(folder.id).toBe(roots.marketing.id);
    });

    it('loadPathListing rejects an unknown path and clears the resolving flag', async () => {
        await store.initialize('project-123');

        await expectAsync(store.loadPathListing('execution', 'Nope/Missing')).toBeRejected();
        expect(store.isResolvingPath()).toBeFalse();
    });
});
