import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { MessageService } from 'primeng/api';
import { FolderNodeResponseAccessLevelEnum as Access } from '@api/model/folderNodeResponse';
import { INTERNAL_DRAG_TYPE } from '../../models/drag-state.model';
import type { DocumentListing } from '../../models/document-listing.model';
import { FileSystemError } from '../../models/file-system-error.model';
import {
    type FileNode, type FileSystemNode, type FolderNode, isFolder
} from '../../models/file-system-node.model';
import { FileSystemApi } from '../file-system/file-system-api';
import { MockFileSystemApi } from '../mock/mock-file-system-api';
import { MOCK_CONFIG } from '../mock/mock-config.token';
import { FileSystemReader } from '../../stores/file-system-reader';
import { FileSystemStore } from '../../stores/file-system.store';
import { NavigationStore } from '../../stores/navigation.store';
import { DocumentSearchService } from '../search/document-search.service';
import { BulkOperationService } from './bulk-operation.service';
import { ClipboardService } from './clipboard.service';
import { DragDropService } from './drag-drop.service';
import { NotificationService } from './notification.service';
import { DOWNLOAD_DRAG_TYPE } from '../../utils/download-url.utils';

describe('DragDropService native session and mutations', () => {
    let service: DragDropService;
    let store: InstanceType<typeof FileSystemStore>;
    let navigation: InstanceType<typeof NavigationStore>;
    let api: FileSystemApi;
    let clipboard: ClipboardService;
    let notifications: NotificationService;
    let source: FolderNode;
    let destination: FolderNode;
    let data: DataTransfer;

    beforeEach(async () => {
        TestBed.configureTestingModule({ providers: [
            DragDropService, FileSystemStore, NavigationStore, ClipboardService,
            NotificationService, MessageService, DocumentSearchService,
            BulkOperationService,
            { provide: FileSystemReader, useExisting: FileSystemStore },
            { provide: FileSystemApi, useClass: MockFileSystemApi },
            { provide: MOCK_CONFIG, useValue: {
                minLatencyMs: 0, maxLatencyMs: 0, enableErrors: false, errorRate: 0
            } }
        ] });
        service = TestBed.inject(DragDropService);
        store = TestBed.inject(FileSystemStore);
        navigation = TestBed.inject(NavigationStore);
        api = TestBed.inject(FileSystemApi);
        clipboard = TestBed.inject(ClipboardService);
        notifications = TestBed.inject(NotificationService);
        const roots = await store.initialize('project');
        if (roots.MARKETING.status !== 'loaded') { throw new Error('Missing root'); }
        destination = roots.MARKETING.root;
        const folder = store.entities().find((node) => isFolder(node) && node.parentId !== null &&
            node.listKey === 'EXECUTION' && !node.isRecycleBin);
        if (!folder || !isFolder(folder)) { throw new Error('Missing source'); }
        source = folder;
        navigation.initialize({ currentFolderId: destination.id, expandedRootIds: [] });
        TestBed.tick();
        data = new DataTransfer();
        spyOn(notifications, 'success');
        spyOn(notifications, 'error');
    });

    function event(type: string, ctrlKey = false, transfer = data): DragEvent {
        return new DragEvent(type, { dataTransfer: transfer, ctrlKey, cancelable: true });
    }

    function start(node: FileSystemNode = source): void {
        service.startDrag({ event: event('dragstart'), node });
    }

    it('moves pessimistically and keeps the destination view after a normal drop', async () => {
        const move = spyOn(api, 'move').and.callThrough();
        start();
        service.over(event('dragover'), destination.id, 'tree');
        expect(service.target()).toEqual({ id: destination.id, surface: 'tree' });
        const pending = service.drop(event('drop'), destination.id);
        expect(store.entityMap()[source.id].parentId).toBe(source.parentId);
        expect(service.pending()).toBeTrue();
        expect(service.state()).toBeNull();
        await pending;
        expect(move).toHaveBeenCalledOnceWith('project', source, destination);
        expect(store.entityMap()[source.id].parentId).toBe(destination.id);
        expect(navigation.currentFolderId()).toBe(destination.id);
        expect(notifications.success).toHaveBeenCalled();
        expect(service.pending()).toBeFalse();
    });

    it('uses Ctrl at drop time and KeepBoth naming for a same-parent copy', async () => {
        const copy = spyOn(api, 'copy').and.callThrough();
        const parentId = source.parentId;
        if (parentId === null) { throw new Error('Expected parent'); }
        start();
        expect(service.canDropOn(parentId, 'move')).toBeFalse();
        service.over(event('dragover', true), parentId, 'current-folder');
        expect(service.state()?.effect).toBe('copy');
        await service.drop(event('drop', true), parentId);
        expect(copy).toHaveBeenCalled();
        expect(store.entityMap()[source.id]).toEqual(source);
        expect(store.entities().some((node) => node.parentId === parentId &&
            node.name === `${source.name} - Copy`)).toBeTrue();
    });

    it('does not trust arbitrary MIME payloads or another session token', async () => {
        const move = spyOn(api, 'move').and.callThrough();
        data.setData(INTERNAL_DRAG_TYPE, 'foreign');
        expect(service.handles(event('dragover'))).toBeTrue();
        await service.drop(event('drop'), destination.id);
        start();
        const foreign = new DataTransfer();
        foreign.setData(INTERNAL_DRAG_TYPE, 'foreign');
        await service.drop(event('drop', false, foreign), destination.id);
        expect(move).not.toHaveBeenCalled();
        expect(service.state()).toBeNull();
    });

    it('cancels a gesture and rejects its later drop', async () => {
        const move = spyOn(api, 'move').and.callThrough();
        start();
        service.endDrag();
        await service.drop(event('drop'), destination.id);
        expect(move).not.toHaveBeenCalled();
        expect(service.target()).toBeNull();
    });

    it('rechecks destination permissions between hover and drop', async () => {
        const move = spyOn(api, 'move').and.callThrough();
        start();
        service.over(event('dragover'), destination.id, 'tree');
        spyOn(api, 'listDocuments').and.returnValue(of({
            currentFolder: { ...destination, accessLevel: Access.Readonly }, folders: [], files: []
        }));
        await store.loadChildren(destination.id);
        await service.drop(event('drop'), destination.id);
        expect(move).not.toHaveBeenCalled();
        expect(service.target()).toBeNull();
    });

    it('expands only after 700ms without navigating and cancels abandoned hover', fakeAsync(() => {
        const expand = spyOn(navigation, 'expandWithoutReload').and.stub();
        start();
        service.over(event('dragover'), destination.id, 'tree');
        tick(699);
        expect(expand).not.toHaveBeenCalled();
        service.over(event('dragover'), destination.id, 'tree');
        tick(1);
        expect(expand).toHaveBeenCalledOnceWith(destination.id);
        expect(navigation.currentFolderId()).toBe(destination.id);
        service.over(event('dragover'), null, 'tree');
        service.over(event('dragover'), destination.id, 'tree');
        service.leave(event('dragleave'));
        tick(701);
        expect(expand).toHaveBeenCalledTimes(1);
    }));

    it('completes a drop released while the destination children are still loading',
        async () => {
            const move = spyOn(api, 'move').and.callThrough();
            const listing = new Subject<DocumentListing>();
            spyOn(api, 'listDocuments').and.returnValue(listing);
            start();
            service.over(event('dragover'), destination.id, 'tree');
            const load = store.loadChildren(destination.id);
            expect(store.folderIdsWithLoadingChildren()).toContain(destination.id);
            // Feedback must not flicker invalid while the listing is in flight.
            expect(service.canDropOn(destination.id, 'move')).toBeTrue();
            const dropped = service.drop(event('drop'), destination.id);
            expect(move).not.toHaveBeenCalled();
            listing.next({ currentFolder: destination, folders: [], files: [] });
            listing.complete();
            await load;
            await dropped;
            expect(move).toHaveBeenCalledOnceWith('project', source, destination);
            expect(store.entityMap()[source.id].parentId).toBe(destination.id);
            expect(notifications.error).not.toHaveBeenCalled();
        });

    it('expands a hovered folder without refetching a listing it already has',
        fakeAsync(() => {
            const list = spyOn(api, 'listDocuments').and.callThrough();
            expect(store.folderIdsWithLoadedChildren()).toContain(destination.id);
            start();
            service.over(event('dragover'), destination.id, 'tree');
            tick(700);
            expect(navigation.expandedTreeIds().has(destination.id)).toBeTrue();
            expect(list).not.toHaveBeenCalled();
            expect(store.folderIdsWithLoadingChildren()).not.toContain(destination.id);
            expect(service.canDropOn(destination.id, 'move')).toBeTrue();
            service.endDrag();
        }));

    function siblingsOf(node: FileSystemNode, count: number): FolderNode[] {
        const found = store.entities().filter((other): other is FolderNode =>
            isFolder(other) && other.parentId === node.parentId && !other.isRecycleBin);
        if (found.length < count) { throw new Error('Expected more sibling folders'); }

        return found.slice(0, count);
    }

    it('drags a whole selection but collapses it to top-most ancestors', async () => {
        await store.loadChildren(source.id);
        const child = store.entities().find((node) => node.parentId === source.id);
        if (!child) { throw new Error('Expected a child of the source'); }
        const move = spyOn(api, 'move').and.callThrough();

        service.startDrag({
            event: event('dragstart'),
            node: source,
            selectedIds: new Set([source.id, child.id])
        });

        // The descendant is dropped: moving it too would chase a path its parent changed.
        expect(service.state()?.sourceIds).toEqual([source.id]);
        await service.drop(event('drop'), destination.id);
        expect(move).toHaveBeenCalledTimes(1);
    });

    it('refuses the whole gesture when one selected item cannot be dragged', () => {
        const dragstart = event('dragstart');

        // `destination` is a list root, which is never draggable.
        service.startDrag({
            event: dragstart,
            node: source,
            selectedIds: new Set([source.id, destination.id])
        });

        expect(dragstart.defaultPrevented).toBeTrue();
        expect(service.state()).toBeNull();
    });

    it('keeps the items that succeeded and summarises the ones that did not', async () => {
        const warning = spyOn(notifications, 'warning');
        const [first, second] = siblingsOf(source, 2);
        spyOn(api, 'move').and.callFake((_projectId, node, target) =>
            node.id === second.id
                ? throwError(() => new FileSystemError('network', 'Offline'))
                : of<FileSystemNode>({ ...node, parentId: target.id }));

        service.startDrag({
            event: event('dragstart'),
            node: first,
            selectedIds: new Set([first.id, second.id])
        });
        await service.drop(event('drop'), destination.id);

        expect(store.entityMap()[first.id].parentId).toBe(destination.id);
        expect(store.entityMap()[second.id].parentId).toBe(second.parentId);
        expect(warning).toHaveBeenCalled();
        expect(notifications.error).not.toHaveBeenCalled();
    });

    function executionBin(): FolderNode {
        const bin = store.entities().find((node): node is FolderNode =>
            isFolder(node) && node.isRecycleBin && node.listKey === source.listKey);
        if (!bin) { throw new Error('Expected a bin for the source list'); }

        return bin;
    }

    it('deletes every item of a selection dropped on the bin', async () => {
        const remove = spyOn(api, 'delete').and.callThrough();
        const move = spyOn(api, 'move').and.callThrough();
        const [first, second] = siblingsOf(source, 2);

        service.startDrag({
            event: event('dragstart'),
            node: first,
            selectedIds: new Set([first.id, second.id])
        });
        await service.drop(event('drop'), executionBin().id);

        expect(remove).toHaveBeenCalledTimes(2);
        expect(move).not.toHaveBeenCalled();
        expect(store.entityMap()[first.id]).toBeUndefined();
        expect(store.entityMap()[second.id]).toBeUndefined();
        expect(notifications.success).toHaveBeenCalled();
    });

    it('opens the parent, not the bin, when the viewed folder is deleted', async () => {
        await store.loadChildren(source.id);
        navigation.initialize({ currentFolderId: source.id, expandedRootIds: [] });
        clipboard.copy([source]);

        service.startDrag({ event: event('dragstart'), node: source });
        await service.drop(event('drop'), executionBin().id);

        expect(store.entityMap()[source.id]).toBeUndefined();
        expect(navigation.currentFolderId()).toBe(source.parentId);
        expect(clipboard.isEmpty()).toBeTrue();
    });

    it('prunes for what a move removed, and reconciles without pruning for a copy',
        async () => {
            const search = TestBed.inject(DocumentSearchService);
            const prune = spyOn(search, 'pruneReferences');
            const refresh = spyOn(search, 'refresh');

            start();
            await service.drop(event('drop'), destination.id);

            expect(prune).toHaveBeenCalled();
            expect([...prune.calls.mostRecent().args[0]]).toContain(source.id);

            // A copy contributes no ids: pruning its sources would drop the rows of the
            // items it just duplicated. It must still reconcile, because a copy made
            // inside the searched scope is a new match — this is what drag-copy skipped
            // while paste-copy did it.
            prune.calls.reset();
            refresh.calls.reset();
            const sibling = siblingsOf(source, 1)[0];
            service.startDrag({ event: event('dragstart', true), node: sibling });
            await service.drop(event('drop', true), destination.id);

            expect([...prune.calls.mostRecent().args[0]]).toEqual([]);
            expect(refresh).toHaveBeenCalled();
        });

    it('keeps the view where it is after copying the folder being viewed', async () => {
        navigation.initialize({ currentFolderId: source.id, expandedRootIds: [] });
        TestBed.tick();

        service.startDrag({ event: event('dragstart', true), node: source });
        await service.drop(event('drop', true), destination.id);

        // The source survives a copy, so the containment test that follows a move must
        // not run: it would see the viewed folder inside a "carried off" node and open
        // the copy's destination instead.
        expect(navigation.currentFolderId()).toBe(source.id);
    });

    it('moves a dragged node that was never cached', async () => {
        // Read a child straight from the API so the store never sees it — the same
        // position a search result is in.
        const listing = await firstValueFrom(api.listDocuments('project', source));
        const uncached: FileSystemNode | undefined = [...listing.folders, ...listing.files]
            .find((child) => child.accessLevel === undefined);
        if (!uncached) { throw new Error('Expected an unrestricted child of the source'); }
        expect(store.entityMap()[uncached.id]).toBeUndefined();
        const move = spyOn(api, 'move').and.callThrough();

        service.startDrag({ event: event('dragstart'), node: uncached });
        expect(service.state()?.sourceIds).toEqual([uncached.id]);
        await service.drop(event('drop'), destination.id);

        expect(move).toHaveBeenCalled();
        expect(store.entities().some((node) =>
            node.name === uncached.name && node.parentId === destination.id)).toBeTrue();
    });

    describe('dragging a file out of the browser', () => {
        const downloadUrl = 'https://sharepoint.test/_layouts/15/download.aspx?SourceUrl=%2Fa';

        async function uncachedFiles(): Promise<FileNode[]> {
            const listing = await firstValueFrom(api.listDocuments('project', source));
            const files = listing.files
                .filter((child) => child.accessLevel === undefined)
                .slice(0, 2)
                .map((child) => ({ ...child, downloadUrl }));
            if (files.length < 2) { throw new Error('Expected two unrestricted files'); }

            return files;
        }

        it('offers a single file to the desktop alongside the internal payload', async () => {
            const [file] = await uncachedFiles();

            service.startDrag({ event: event('dragstart'), node: file });

            expect(data.getData(INTERNAL_DRAG_TYPE)).not.toBe('');
            expect(data.getData(DOWNLOAD_DRAG_TYPE))
                .toBe(`application/octet-stream:${file.name}:${downloadUrl}`);
        });

        it('keeps a multi-item drag internal', async () => {
            const files = await uncachedFiles();

            service.startDrag({
                event: event('dragstart'), node: files[0],
                selectedIds: new Set(files.map(({ id }) => id)), selectedNodes: files
            });

            expect(service.state()?.sourceIds.length).toBe(2);
            expect(data.getData(DOWNLOAD_DRAG_TYPE)).toBe('');
        });

        it('keeps a folder drag internal', () => {
            start();

            expect(service.state()).not.toBeNull();
            expect(data.getData(DOWNLOAD_DRAG_TYPE)).toBe('');
        });
    });

    it('drags a whole selection of nodes the cache never held', async () => {
        // Two children read straight from the API, so the store never sees either —
        // the position every search result is in.
        const listing = await firstValueFrom(api.listDocuments('project', source));
        const uncached = [...listing.folders, ...listing.files]
            .filter((child) => child.accessLevel === undefined)
            .slice(0, 2);
        if (uncached.length < 2) { throw new Error('Expected two unrestricted children'); }
        for (const node of uncached) {
            expect(store.entityMap()[node.id]).toBeUndefined();
        }
        const move = spyOn(api, 'move').and.callThrough();
        const selectedIds = new Set(uncached.map(({ id }) => id));

        // The ids alone cannot resolve this selection, so the rows travel with them.
        // Without that the whole gesture is refused rather than one item dropped.
        service.startDrag({
            event: event('dragstart'), node: uncached[0], selectedIds, selectedNodes: uncached
        });

        expect([...service.state()?.sourceIds ?? []].sort()).toEqual([...selectedIds].sort());

        await service.drop(event('drop'), destination.id);

        expect(move).toHaveBeenCalledTimes(2);
        // Read before the loop: `destination` is reassigned per test, so a closure built
        // in the loop would be reaching for a variable that moves underneath it.
        const destinationId = destination.id;
        for (const node of uncached) {
            expect(store.entities().some((entity) =>
                entity.name === node.name && entity.parentId === destinationId)).toBeTrue();
        }
    });

    it('refuses a selection naming something neither the cache nor the surface knows',
        async () => {
            const listing = await firstValueFrom(api.listDocuments('project', source));
            const uncached = [...listing.folders, ...listing.files]
                .find((child) => child.accessLevel === undefined);
            if (!uncached) { throw new Error('Expected an unrestricted child'); }
            const move = spyOn(api, 'move').and.callThrough();

            // A stale id is still a refusal: the fallback widens what counts as
            // resolvable, it does not drop the guard.
            service.startDrag({
                event: event('dragstart'),
                node: uncached,
                selectedIds: new Set([uncached.id, 'gone']),
                selectedNodes: [uncached]
            });

            expect(service.state()).toBeNull();

            await service.drop(event('drop'), destination.id);

            expect(move).not.toHaveBeenCalled();
        });

    it('builds the drag policy once for a whole list of candidates', () => {
        // `entityMap` is the policy's most expensive input: it is scanned in full to
        // find the recycle bins. Reading it once per candidate made marking search
        // results draggable cost O(results x cached entities).
        const reads = spyOn(store, 'entityMap').and.callThrough();
        const candidates = [source, ...siblingsOf(source, 2)];

        reads.calls.reset();
        const draggable = service.draggableAmong(candidates);

        expect(draggable.size).toBeGreaterThan(0);
        expect(reads.calls.count()).toBeLessThan(candidates.length);
    });

    it('does not inspect protected payload data during dragover', () => {
        start();
        const read = spyOn(data, 'getData').and.throwError('Protected drag data');
        service.over(event('dragover'), destination.id, 'table');
        expect(read).not.toHaveBeenCalled();
        expect(service.target()?.surface).toBe('table');
        service.endDrag();
    });

    it('allows only one request even if drop and dragstart repeat', async () => {
        const response = new Subject<FileSystemNode>();
        const move = spyOn(api, 'move').and.returnValue(response);
        start();
        const pending = service.drop(event('drop'), destination.id);
        await service.drop(event('drop'), destination.id);
        const denied = event('dragstart');
        service.startDrag({ event: denied, node: source });
        expect(denied.defaultPrevented).toBeTrue();
        response.next({ ...source, parentId: destination.id });
        response.complete();
        await pending;
        expect(move).toHaveBeenCalledTimes(1);
    });

    it('handles changed backend IDs and moves an affected view to destination', async () => {
        await store.loadChildren(source.id);
        navigation.initialize({ currentFolderId: source.id, expandedRootIds: [] });
        navigation.focus(source.id);
        clipboard.copy([source]);
        const response = new Subject<FileSystemNode>();
        spyOn(api, 'move').and.returnValue(response);
        start();
        const pending = service.drop(event('drop'), destination.id);
        response.next({ ...source, id: 'canonical-id', listKey: destination.listKey,
            parentId: destination.id, path: `${destination.path}/${source.name}` });
        response.complete();
        await pending;
        expect(store.entityMap()[source.id]).toBeUndefined();
        expect(store.entityMap()['canonical-id'].parentId).toBe(destination.id);
        expect(clipboard.isEmpty()).toBeTrue();
        expect(navigation.focusedId()).toBeNull();
        expect(navigation.currentFolderId()).toBe(destination.id);
    });

    it('keeps data, references and the current view unchanged when the backend fails', async () => {
        spyOn(api, 'move').and.returnValue(throwError(() =>
            new FileSystemError('network', 'Offline')));
        clipboard.copy([source]);
        const before = store.entities();
        start();
        await service.drop(event('drop'), destination.id);
        expect(store.entities()).toEqual(before);
        expect(clipboard.has(source.id)).toBeTrue();
        expect(navigation.currentFolderId()).toBe(destination.id);
        expect(notifications.error).toHaveBeenCalled();
        expect(service.busyIds().size).toBe(0);
    });

    it('opens the destination when moving an ancestor of a path-resolved view', async () => {
        const resolved = await store.loadPathListing('EXECUTION', 'Contracts/Vendors/2026');
        navigation.openResolvedFolder(resolved.folder.id, {
            listKey: 'EXECUTION', path: resolved.canonicalPath
        });
        clipboard.copy([resolved.folder]);
        start();
        await service.drop(event('drop'), destination.id);
        expect(navigation.currentFolderId()).toBe(destination.id);
        expect(store.entityMap()[resolved.folder.id]).toBeUndefined();
        expect(clipboard.isEmpty()).toBeTrue();
        expect(notifications.success).toHaveBeenCalled();
    });

    it('prunes descendants loaded and opened while a move is pending', async () => {
        const response = new Subject<FileSystemNode>();
        spyOn(api, 'move').and.returnValue(response);
        start();
        const pending = service.drop(event('drop'), destination.id);
        const resolved = await store.loadPathListing('EXECUTION', 'Contracts/Vendors/2026');
        navigation.openResolvedFolder(resolved.folder.id, {
            listKey: 'EXECUTION', path: resolved.canonicalPath
        });
        clipboard.copy([resolved.folder]);
        response.next({ ...source, parentId: destination.id, listKey: destination.listKey });
        response.complete();
        await pending;
        expect(store.entityMap()[resolved.folder.id]).toBeUndefined();
        expect(clipboard.isEmpty()).toBeTrue();
        expect(navigation.currentFolderId()).toBe(destination.id);
    });

    /**
     * Built outside the loops below, because a test body declared inside them closes
     * over the `let`s that `beforeEach` reassigns — safe only because the body runs
     * afterwards, which is the reasoning `no-loop-func` cannot do.
     */
    function ignoresPendingCase(
        operation: 'move' | 'copy',
        projectId: string
    ): () => Promise<void> {
        return async (): Promise<void> => {
            const response = new Subject<FileSystemNode>();
            const mutation = spyOn(api, operation).and.returnValue(response);
            start();
            const pending = service.drop(event('drop', operation === 'copy'), destination.id);
            expect(mutation).toHaveBeenCalledTimes(1);
            await store.initialize(projectId);
            const before = store.entities();
            response.next({ ...source, id: 'stale-result', parentId: destination.id });
            response.complete();
            await pending;
            expect(store.entities()).toEqual(before);
            expect(store.entityMap()['stale-result']).toBeUndefined();
            expect(notifications.success).not.toHaveBeenCalled();
            expect(notifications.error).not.toHaveBeenCalled();
        };
    }

    for (const operation of ['move', 'copy'] as const) {
        for (const projectId of ['project', 'next-project']) {
            it(
                `ignores pending ${operation} after reinitializing ${projectId}`,
                ignoresPendingCase(operation, projectId)
            );
        }
    }
});
