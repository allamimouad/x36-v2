import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { MessageService } from 'primeng/api';
import { FolderNodeResponseAccessLevelEnum as Access } from '@api/model/folderNodeResponse';
import { INTERNAL_DRAG_TYPE } from '../../models/drag-state.model';
import type { DocumentListing } from '../../models/document-listing.model';
import { FileSystemError } from '../../models/file-system-error.model';
import {
    type FileSystemNode, type FolderNode, isFolder
} from '../../models/file-system-node.model';
import { FileSystemApi } from '../file-system/file-system-api';
import { MockFileSystemApi } from '../mock/mock-file-system-api';
import { MOCK_CONFIG } from '../mock/mock-config.token';
import { FileSystemReader } from '../../stores/file-system-reader';
import { FileSystemStore } from '../../stores/file-system.store';
import { NavigationStore } from '../../stores/navigation.store';
import { ClipboardService } from './clipboard.service';
import { DragDropService } from './drag-drop.service';
import { NotificationService } from './notification.service';

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
            NotificationService, MessageService,
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

    for (const operation of ['move', 'copy'] as const) {
        for (const projectId of ['project', 'next-project']) {
            it(`ignores pending ${operation} after reinitializing ${projectId}`, async () => {
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
            });
        }
    }
});
