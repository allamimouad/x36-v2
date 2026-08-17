import { TestBed } from '@angular/core/testing';
import { delay, firstValueFrom, map, throwError } from 'rxjs';
import type {
    DocumentListRoots,
    DocumentListRootStatus
} from '../models/document-list.model';
import { isFolder, type FolderNode } from '../models/file-system-node.model';
import { FileSystemError } from '../models/file-system-error.model';
import { FileSystemApi } from '../services/file-system/file-system-api';
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
        const executionRoot = requireRoot(roots.EXECUTION, 'execution');
        const marketingRoot = requireRoot(roots.MARKETING, 'marketing');

        expect(listDocumentRoot).toHaveBeenCalledTimes(2);
        expect(listDocumentRoot).toHaveBeenCalledWith('project-123', 'EXECUTION');
        expect(listDocumentRoot).toHaveBeenCalledWith('project-123', 'MARKETING');
        expect(store.projectId()).toBe('project-123');
        expect(store.initializedRoots()).toBe(roots);
        expect(executionRoot.listKey).toBe('EXECUTION');
        expect(marketingRoot.listKey).toBe('MARKETING');
        expect(store.folderIdsWithLoadedChildren()).toContain(executionRoot.id);
        expect(store.folderIdsWithLoadedChildren()).toContain(marketingRoot.id);
        expect(
            store.entities().filter((node) => node.parentId === executionRoot.id).length
        ).toBe(4);
        expect(
            store.entities()
                .filter((node) => node.parentId === executionRoot.id)
                .every((node) => node.listKey === 'EXECUTION')
        ).toBeTrue();
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
        expect(roots.MARKETING.status).toBe('loaded');
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
            listKey === 'EXECUTION'
                ? throwError(() => new FileSystemError('not-found', 'Execution list not found'))
                : originalListDocumentRoot(projectId, listKey)
        );

        const roots = await store.initialize('project-123');

        expect(roots.EXECUTION.status).toBe('not-found');
        const marketingRoot = requireRoot(roots.MARKETING, 'marketing');
        expect(store.projectId()).toBe('project-123');
        expect(store.folderIdsWithLoadedChildren()).toEqual([marketingRoot.id]);
        expect(store.entities()).toContain(marketingRoot);
        expect(store.entities().some((node) => node.path.startsWith('/execution'))).toBeFalse();
    });

    it(
        'initializes the available root when the other document list has a transient error',
        async () => {
            const originalListDocumentRoot = api.listDocumentRoot.bind(api);
            spyOn(api, 'listDocumentRoot').and.callFake((projectId, listKey) =>
                listKey === 'EXECUTION'
                    ? throwError(() => new FileSystemError('network', 'Network unavailable'))
                    : originalListDocumentRoot(projectId, listKey)
            );

            const roots = await store.initialize('project-123');

            expect(roots.EXECUTION.status).toBe('error');
            if (roots.EXECUTION.status !== 'error') { throw new Error('Expected execution error'); }
            expect(roots.EXECUTION.error.code).toBe('network');
            const marketingRoot = requireRoot(roots.MARKETING, 'marketing');
            expect(store.projectId()).toBe('project-123');
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

            expect(roots.EXECUTION.status).toBe('not-found');
            expect(roots.MARKETING.status).toBe('not-found');
            expect(store.projectId()).toBe('project-123');
            expect(store.initializedRoots()).toBe(roots);
            expect(store.folderIdsWithLoadedChildren()).toEqual([]);
            expect(store.entities()).toEqual([]);
        }
    );

    it('loads nested content using project, list, and parent identity', async () => {
        await store.initialize('project-123');
        const contracts = store
            .entities()
            .find(
                (node): node is FolderNode =>
                    isFolder(node) && node.path === '/execution/Contracts'
            );
        if (!contracts) { throw new Error('Expected Contracts folder'); }
        const listDocuments = spyOn(api, 'listDocuments').and.callThrough();

        await store.loadChildren(contracts.id);

        expect(listDocuments).toHaveBeenCalledOnceWith(
            'project-123',
            contracts
        );
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
        const executionRoot = requireRoot(roots.EXECUTION, 'execution');
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
        const executionRoot = requireRoot(roots.EXECUTION, 'execution');
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
        const executionRoot = requireRoot(roots.EXECUTION, 'execution');

        const first = await store.createFolder(executionRoot.id, 'New folder');
        const second = await store.createFolder(executionRoot.id, 'New folder');
        const third = await store.createFolder(executionRoot.id, 'New folder');

        expect(first.name).toBe('New folder');
        expect(first.listKey).toBe('EXECUTION');
        expect(second.name).toBe('New folder (1)');
        expect(third.name).toBe('New folder (2)');
        expect(store.entityMap()[second.id]?.name).toBe('New folder (1)');
    });

    it('leaves the store unchanged when a write fails', async () => {
        const { EXECUTION: root } = await store.initialize('project-123');
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

    it('clears cached descendant file links when a folder rename changes their paths', async () => {
        await store.initialize('project-123');
        const folder = store
            .entities()
            .find(
                (node): node is FolderNode =>
                    isFolder(node) && node.path === '/execution/Contracts'
            );
        if (!folder) { throw new Error('Expected Contracts folder'); }
        const originalListDocuments = api.listDocuments.bind(api);
        spyOn(api, 'listDocuments').and.callFake((projectId, parent) =>
            originalListDocuments(projectId, parent).pipe(
                map((listing) => ({
                    ...listing,
                    files: listing.files.map((file) => ({
                        ...file,
                        onlineUrl: `https://sharepoint.test${file.path}?web=1`,
                        desktopUrl: `ms-word:ofe|u|https://sharepoint.test${file.path}`,
                        downloadUrl: `https://sharepoint.test/download?path=${file.path}`
                    }))
                }))
            )
        );
        await store.loadChildren(folder.id);
        const descendantFile = store
            .entities()
            .find((node) => !isFolder(node) && node.parentId === folder.id);
        if (!descendantFile || isFolder(descendantFile)) {
            throw new Error('Expected a cached descendant file');
        }

        await store.rename(folder.id, 'Renamed Contracts');

        const repathed = store.entityMap()[descendantFile.id];
        if (!repathed || isFolder(repathed)) { throw new Error('Expected repathed file'); }
        expect(repathed.path).toContain('/execution/Renamed Contracts/');
        expect(repathed.onlineUrl).toBeUndefined();
        expect(repathed.desktopUrl).toBeUndefined();
        expect(repathed.downloadUrl).toBeUndefined();
    });

    it('passes the selected node list context to delete', async () => {
        const roots = await store.initialize('project-123');
        const executionRoot = requireRoot(roots.EXECUTION, 'execution');
        const source = store.entities().find(
            (node) => isFolder(node) && node.parentId === executionRoot.id
        );
        if (!source) { throw new Error('Expected execution source folder'); }
        const deleteNode = spyOn(api, 'delete').and.callThrough();

        await store.delete(source.id);

        expect(source.listKey).toBe('EXECUTION');
        expect(deleteNode).toHaveBeenCalledOnceWith('project-123', source);
    });

    it('mutates a canonical search node without inserting the source into the cache', async () => {
        const roots = await store.initialize('project-123');
        const executionRoot = requireRoot(roots.EXECUTION, 'execution');
        const { results } = await firstValueFrom(
            api.searchDocuments('project-123', executionRoot, 'signed')
        );
        const source = results.find((node) => !isFolder(node));
        if (!source) { throw new Error('Expected an uncached search file'); }
        expect(store.entityMap()[source.id]).toBeUndefined();
        const renameNode = spyOn(api, 'rename').and.callThrough();

        const renamed = await store.rename(source, 'renamed-search-result.pdf');

        expect(renameNode).toHaveBeenCalledOnceWith(
            'project-123',
            source,
            'renamed-search-result.pdf'
        );
        expect(renamed.name).toBe('renamed-search-result.pdf');
        expect(store.entityMap()[source.id]).toBeUndefined();
    });

    it('copies an uncached canonical search node into a cached destination', async () => {
        const roots = await store.initialize('project-123');
        const executionRoot = requireRoot(roots.EXECUTION, 'execution');
        const { results } = await firstValueFrom(
            api.searchDocuments('project-123', executionRoot, 'signed')
        );
        const source = results.find((node) => !isFolder(node));
        if (!source) { throw new Error('Expected an uncached search file'); }
        const copyNode = spyOn(api, 'copy').and.callThrough();

        await store.copy(source, executionRoot);

        expect(copyNode).toHaveBeenCalledOnceWith('project-123', source, executionRoot);
        expect(store.entities().some(
            (node) => node.parentId === executionRoot.id && node.name === source.name
        )).toBeTrue();
    });

    it('move replaces the cached subtree with the returned node and removed ids', async () => {
        const { EXECUTION: root } = await store.initialize('project-123');
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

    it('uses the destination list context when moving across document lists', async () => {
        const roots = await store.initialize('project-123');
        const executionRoot = requireRoot(roots.EXECUTION, 'execution');
        const marketingRoot = requireRoot(roots.MARKETING, 'marketing');
        const source = store.entities().find(
            (node) => isFolder(node) && node.parentId === executionRoot.id
        );
        if (!source) { throw new Error('Expected execution source folder'); }

        await store.move(source.id, marketingRoot.id);

        const moved = store.entityMap()[source.id];
        expect(moved?.parentId).toBe(marketingRoot.id);
        expect(moved?.listKey).toBe('MARKETING');
    });

    it('copies across document lists using the destination context', async () => {
        const roots = await store.initialize('project-123');
        const executionRoot = requireRoot(roots.EXECUTION, 'execution');
        const marketingRoot = requireRoot(roots.MARKETING, 'marketing');
        const source = store.entities().find(
            (node) => isFolder(node) && node.parentId === executionRoot.id
        );
        if (!source) { throw new Error('Expected execution source folder'); }
        const copy = spyOn(api, 'copy').and.callThrough();

        await store.copy(source.id, marketingRoot.id);

        expect(copy).toHaveBeenCalledOnceWith('project-123', source, marketingRoot);
        const copied = store.entities().find(
            (node) => node.id !== source.id &&
                node.parentId === marketingRoot.id &&
                node.name === source.name
        );
        expect(copied?.listKey).toBe('MARKETING');
    });

    it('keeps repeated same-folder copies with File Explorer names', async () => {
        const roots = await store.initialize('project-123');
        const executionRoot = requireRoot(roots.EXECUTION, 'execution');
        const source = store.entities().find(
            (node) => !isFolder(node) && node.parentId === executionRoot.id
        );
        if (!source) { throw new Error('Expected execution source file'); }

        await store.copy(source.id, executionRoot.id);
        await store.copy(source.id, executionRoot.id);

        const copiedNames = store.entities()
            .filter((node) => node.id !== source.id && node.parentId === executionRoot.id)
            .map((node) => node.name);
        const extensionIndex = source.name.lastIndexOf('.');
        const stem = extensionIndex > 0
            ? source.name.slice(0, extensionIndex)
            : source.name;
        const extension = extensionIndex > 0
            ? source.name.slice(extensionIndex)
            : '';
        expect(copiedNames).toContain(`${stem} - Copy${extension}`);
        expect(copiedNames).toContain(`${stem} - Copy (2)${extension}`);
        expect(store.folderIdsWithLoadedChildren()).toContain(executionRoot.id);
    });

    it('returns a copied folder with its real child count', async () => {
        const roots = await store.initialize('project-123');
        const executionRoot = requireRoot(roots.EXECUTION, 'execution');
        const source = store.entities().find(
            (node): node is FolderNode =>
                isFolder(node) &&
                node.parentId === executionRoot.id &&
                node.itemCount > 0
        );
        if (!source) { throw new Error('Expected a non-empty execution folder'); }

        await store.copy(source.id, executionRoot.id);

        const copied = store.entities().find(
            (node) =>
                isFolder(node) &&
                node.id !== source.id &&
                node.parentId === executionRoot.id &&
                node.name.startsWith(`${source.name} - Copy`)
        );
        expect(copied && isFolder(copied) ? copied.itemCount : -1).toBe(source.itemCount);
    });

    it('loadPathListing resolves a typed path and returns canonical casing', async () => {
        await store.initialize('project-123');

        const { folder, canonicalPath } = await store.loadPathListing(
            'EXECUTION',
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
        const marketingRoot = requireRoot(roots.MARKETING, 'marketing');

        const { folder, canonicalPath } = await store.loadPathListing('MARKETING', '');

        expect(canonicalPath).toBe('');
        expect(folder.id).toBe(marketingRoot.id);
    });

    it('loadPathListing rejects an unknown path and clears the resolving flag', async () => {
        await store.initialize('project-123');

        await expectAsync(store.loadPathListing('EXECUTION', 'Nope/Missing')).toBeRejected();
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
