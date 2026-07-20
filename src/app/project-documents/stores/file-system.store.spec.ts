import { TestBed } from '@angular/core/testing';
import { delay, throwError } from 'rxjs';
import type {
    DocumentListRoots,
    DocumentListRootStatus
} from '../models/document-list.model';
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
        const executionRoot = requireRoot(roots.execution, 'execution');
        const marketingRoot = requireRoot(roots.marketing, 'marketing');

        expect(listDocumentRoot).toHaveBeenCalledTimes(2);
        expect(listDocumentRoot).toHaveBeenCalledWith('project-123', 'execution');
        expect(listDocumentRoot).toHaveBeenCalledWith('project-123', 'marketing');
        expect(store.projectId()).toBe('project-123');
        expect(store.rootIdByList().execution).toBe(executionRoot.id);
        expect(store.rootIdByList().marketing).toBe(marketingRoot.id);
        expect(store.folderIdsWithLoadedChildren()).toContain(executionRoot.id);
        expect(store.folderIdsWithLoadedChildren()).toContain(marketingRoot.id);
        expect(
            store.entities().filter((node) => node.parentId === executionRoot.id).length
        ).toBe(4);
    });

    it('connectProject applies only the latest project on a mid-flight switch', async () => {
        const originalListDocumentRoot = api.listDocumentRoot.bind(api);
        spyOn(api, 'listDocumentRoot').and.callFake((projectId, listKey) =>
            projectId === 'slow-project'
                ? originalListDocumentRoot(projectId, listKey).pipe(delay(150))
                : originalListDocumentRoot(projectId, listKey)
        );

        store.connectProject('slow-project');
        store.connectProject('project-123');
        const roots = await waitForInitializedRoots(store);

        expect(store.projectId()).toBe('project-123');
        expect(roots.marketing.status).toBe('loaded');
        expect(store.isInitializing()).toBeFalse();

        // Give the cancelled slow-project load time to have completed had it survived:
        // its result must never be applied over the newer project's.
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(store.projectId()).toBe('project-123');
        expect(store.initializedRoots()).toBe(roots);
    });

    it('initializes the available root when the other document list is not found', async () => {
        const originalListDocumentRoot = api.listDocumentRoot.bind(api);
        spyOn(api, 'listDocumentRoot').and.callFake((projectId, listKey) =>
            listKey === 'execution'
                ? throwError(() => new FileSystemError('not-found', 'Execution list not found'))
                : originalListDocumentRoot(projectId, listKey)
        );

        const roots = await store.initialize('project-123');

        expect(roots.execution.status).toBe('not-found');
        const marketingRoot = requireRoot(roots.marketing, 'marketing');
        expect(store.projectId()).toBe('project-123');
        expect(store.rootIdByList().execution).toBeNull();
        expect(store.rootIdByList().marketing).toBe(marketingRoot.id);
        expect(store.folderIdsWithLoadedChildren()).toEqual([marketingRoot.id]);
        expect(store.entities()).toContain(marketingRoot);
        expect(store.entities().some((node) => node.path.startsWith('/execution'))).toBeFalse();
    });

    it(
        'initializes the available root when the other document list has a transient error',
        async () => {
            const originalListDocumentRoot = api.listDocumentRoot.bind(api);
            spyOn(api, 'listDocumentRoot').and.callFake((projectId, listKey) =>
                listKey === 'execution'
                    ? throwError(() => new FileSystemError('network', 'Network unavailable'))
                    : originalListDocumentRoot(projectId, listKey)
            );

            const roots = await store.initialize('project-123');

            expect(roots.execution.status).toBe('error');
            if (roots.execution.status !== 'error') { throw new Error('Expected execution error'); }
            expect(roots.execution.error.code).toBe('network');
            const marketingRoot = requireRoot(roots.marketing, 'marketing');
            expect(store.projectId()).toBe('project-123');
            expect(store.rootIdByList().execution).toBeNull();
            expect(store.rootIdByList().marketing).toBe(marketingRoot.id);
            expect(store.folderIdsWithLoadedChildren()).toEqual([marketingRoot.id]);
            expect(store.entities()).toContain(marketingRoot);
            expect(store.entities().some((node) => node.path.startsWith('/execution'))).toBeFalse();
        }
    );

    it(
        'keeps the initialized project and empty cache when both document lists are not found',
        async () => {
            spyOn(api, 'listDocumentRoot').and.returnValue(
                throwError(() => new FileSystemError('not-found', 'List not found'))
            );

            const roots = await store.initialize('project-123');

            expect(roots.execution.status).toBe('not-found');
            expect(roots.marketing.status).toBe('not-found');
            expect(store.projectId()).toBe('project-123');
            expect(store.rootIdByList()).toEqual({ execution: null, marketing: null });
            expect(store.folderIdsWithLoadedChildren()).toEqual([]);
            expect(store.entities()).toEqual([]);
        }
    );

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

        expect(store.errorByParentId()[unavailable.id]?.code).toBe('not-found');
        expect(store.folderIdsWithLoadingChildren()).not.toContain(unavailable.id);
    });

    it('keeps a typed transient error while retaining an already-loaded listing', async () => {
        const roots = await store.initialize('project-123');
        const executionRoot = requireRoot(roots.execution, 'execution');
        spyOn(api, 'listDocuments').and.returnValue(
            throwError(() => new FileSystemError('network', 'Technical transport details'))
        );

        await store.loadChildren(executionRoot.id);

        expect(store.errorByParentId()[executionRoot.id]?.code).toBe('network');
        expect(store.folderIdsWithLoadedChildren()).toContain(executionRoot.id);
        expect(store.entities().some((node) => node.parentId === executionRoot.id)).toBeTrue();
    });

    it('passes the initialized project id to mutation operations', async () => {
        const roots = await store.initialize('project-123');
        const executionRoot = requireRoot(roots.execution, 'execution');
        const createFolder = spyOn(api, 'createFolder').and.callThrough();

        await store.createFolder(executionRoot.id, 'New folder');

        expect(createFolder).toHaveBeenCalledOnceWith(
            'project-123',
            executionRoot,
            'New folder'
        );
    });

    it('keeps the canonical unique folder name returned by the backend', async () => {
        const roots = await store.initialize('project-123');
        const executionRoot = requireRoot(roots.execution, 'execution');

        const first = await store.createFolder(executionRoot.id, 'New folder');
        const second = await store.createFolder(executionRoot.id, 'New folder');
        const third = await store.createFolder(executionRoot.id, 'New folder');

        expect(first.name).toBe('New folder');
        expect(second.name).toBe('New folder (1)');
        expect(third.name).toBe('New folder (2)');
        expect(store.entityMap()[second.id]?.name).toBe('New folder (1)');
    });

    it('leaves the store unchanged when a write fails', async () => {
        const { execution: root } = await store.initialize('project-123');
        const executionRoot = requireRoot(root, 'execution');
        const countBefore = store.entities().length;
        const itemCountBefore = (store.entityMap()[executionRoot.id] as FolderNode).itemCount;
        spyOn(api, 'createFolder').and.returnValue(
            throwError(() => new FileSystemError('network', 'simulated failure'))
        );

        await expectAsync(store.createFolder(executionRoot.id, 'New folder')).toBeRejected();

        expect(store.entities().length).toBe(countBefore);
        expect((store.entityMap()[executionRoot.id] as FolderNode).itemCount).toBe(
            itemCountBefore
        );
    });

    it('move replaces the cached subtree with the returned node and removed ids', async () => {
        const { execution: root } = await store.initialize('project-123');
        const executionRoot = requireRoot(root, 'execution');
        const tops = store
            .entities()
            .filter(
                (node): node is FolderNode => isFolder(node) && node.parentId === executionRoot.id
            );
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
        const marketingRoot = requireRoot(roots.marketing, 'marketing');

        const { folder, canonicalPath } = await store.loadPathListing('marketing', '');

        expect(canonicalPath).toBe('');
        expect(folder.id).toBe(marketingRoot.id);
    });

    it('loadPathListing rejects an unknown path and clears the resolving flag', async () => {
        await store.initialize('project-123');

        await expectAsync(store.loadPathListing('execution', 'Nope/Missing')).toBeRejected();
        expect(store.isResolvingPath()).toBeFalse();
    });
});

async function waitForInitializedRoots(
    store: InstanceType<typeof FileSystemStore>
): Promise<DocumentListRoots> {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
        const roots = store.initializedRoots();
        if (roots) { return roots; }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('initializedRoots was not set within 2s');
}

function requireRoot(root: DocumentListRootStatus, listName: string): FolderNode {
    if (root.status !== 'loaded') { throw new Error(`Expected ${listName} root`); }

    return root.root;
}
