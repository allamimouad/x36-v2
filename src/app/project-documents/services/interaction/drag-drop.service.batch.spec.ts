import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { MessageService } from 'primeng/api';
import { INTERNAL_DRAG_TYPE } from '../../models/drag-state.model';
import {
    type FileSystemNode, type FolderNode, isFolder
} from '../../models/file-system-node.model';
import {
    DEFAULT_FILE_MANAGER_CONFIG, FILE_MANAGER_CONFIG
} from '../../tokens/file-manager-config.token';
import { FileSystemApi } from '../file-system/file-system-api';
import { MockFileSystemApi } from '../mock/mock-file-system-api';
import { MOCK_CONFIG } from '../mock/mock-config.token';
import { FileSystemReader } from '../../stores/file-system-reader';
import { FileSystemStore } from '../../stores/file-system.store';
import { NavigationStore } from '../../stores/navigation.store';
import { ClipboardService } from './clipboard.service';
import { DragDropService } from './drag-drop.service';
import { NotificationService } from './notification.service';

/**
 * A selection larger than `bulkOpConcurrency` leaves items waiting in the queue. Those
 * must not be issued once the gesture no longer belongs to the loaded project.
 * Concurrency is pinned to 1 so two items are enough to create the window.
 */
describe('DragDropService queued batch items', () => {
    let service: DragDropService;
    let store: InstanceType<typeof FileSystemStore>;
    let api: FileSystemApi;
    let first: FolderNode;
    let second: FolderNode;
    let destination: FolderNode;

    beforeEach(async () => {
        TestBed.configureTestingModule({ providers: [
            DragDropService, FileSystemStore, NavigationStore, ClipboardService,
            NotificationService, MessageService,
            { provide: FileSystemReader, useExisting: FileSystemStore },
            { provide: FileSystemApi, useClass: MockFileSystemApi },
            { provide: FILE_MANAGER_CONFIG, useValue: {
                ...DEFAULT_FILE_MANAGER_CONFIG, bulkOpConcurrency: 1
            } },
            { provide: MOCK_CONFIG, useValue: {
                minLatencyMs: 0, maxLatencyMs: 0, enableErrors: false, errorRate: 0
            } }
        ] });
        service = TestBed.inject(DragDropService);
        store = TestBed.inject(FileSystemStore);
        api = TestBed.inject(FileSystemApi);
        const roots = await store.initialize('project');
        if (roots.MARKETING.status !== 'loaded') { throw new Error('Missing root'); }
        destination = roots.MARKETING.root;
        const siblings = store.entities().filter((node): node is FolderNode =>
            isFolder(node) && node.parentId !== null && node.listKey === 'EXECUTION'
            && !node.isRecycleBin);
        if (siblings.length < 2) { throw new Error('Expected two source folders'); }
        [first, second] = siblings;
        TestBed.inject(NavigationStore)
            .initialize({ currentFolderId: destination.id, expandedRootIds: [] });
        TestBed.tick();
    });

    function dragStart(): void {
        service.startDrag({
            event: new DragEvent('dragstart', {
                dataTransfer: new DataTransfer(), cancelable: true
            }),
            node: first,
            selectedIds: new Set([first.id, second.id])
        });
    }

    function dropEvent(): DragEvent {
        const transfer = new DataTransfer();
        transfer.setData(INTERNAL_DRAG_TYPE, service.state()?.token ?? '');

        return new DragEvent('drop', { dataTransfer: transfer, cancelable: true });
    }

    /** Hand out a controllable response per `move` call. */
    function stubbedMoves(): { responses: Subject<FileSystemNode>[]; spy: jasmine.Spy } {
        const responses: Subject<FileSystemNode>[] = [];
        const spy = spyOn(api, 'move').and.callFake(() => {
            const response = new Subject<FileSystemNode>();
            responses.push(response);

            return response;
        });

        return { responses, spy };
    }

    it('does not issue a queued item after the project is reinitialized', async () => {
        const { responses, spy } = stubbedMoves();
        dragStart();
        const dropped = service.drop(dropEvent(), destination.id);
        expect(spy).toHaveBeenCalledTimes(1);

        await store.initialize('project');
        responses[0].next({ ...first, parentId: destination.id });
        responses[0].complete();
        await dropped;

        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('does not issue a queued item after the component is destroyed', async () => {
        const { responses, spy } = stubbedMoves();
        dragStart();
        const dropped = service.drop(dropEvent(), destination.id);
        expect(spy).toHaveBeenCalledTimes(1);

        TestBed.resetTestingModule();
        responses[0].next({ ...first, parentId: destination.id });
        responses[0].complete();
        await dropped;

        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('issues every item while the project is unchanged', async () => {
        const { responses, spy } = stubbedMoves();
        dragStart();
        const dropped = service.drop(dropEvent(), destination.id);

        responses[0].next({ ...first, parentId: destination.id });
        responses[0].complete();
        // Step microtasks until the freed slot takes the next item, rather than guessing
        // how many the store's own awaits consume.
        for (let step = 0; step < 50 && responses.length < 2; step++) {
            await Promise.resolve();
        }
        expect(spy).toHaveBeenCalledTimes(2);
        responses[1].next({ ...second, parentId: destination.id });
        responses[1].complete();
        await dropped;

        expect(store.entityMap()[second.id].parentId).toBe(destination.id);
    });
});
