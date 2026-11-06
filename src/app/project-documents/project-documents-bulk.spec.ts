import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { MenuItem } from 'primeng/api';
import { ContextMenu } from 'primeng/contextmenu';
import { DialogService } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
import {
    CURRENT_APPLICATION,
    PopupService,
    SUPPORT_EMAIL_ADDRESS,
    TargetApplication
} from './tokens/shared-ui';
import { FileSystemError } from './models/file-system-error.model';
import { isFolder, type FileSystemNode, type FolderNode } from './models/file-system-node.model';
import { ProjectDocuments } from './project-documents';
import { FileSystemApi } from './services/file-system/file-system-api';
import { MOCK_CONFIG } from './services/mock/mock-config.token';
import { ClipboardService } from './services/interaction/clipboard.service';
import { DocumentSearchService } from './services/search/document-search.service';
import { FileSystemStore } from './stores/file-system.store';
import { NavigationStore } from './stores/navigation.store';
import { ProjectOverviewService } from '../../services/project-overview.service';

/** Actions that operate on a whole table selection rather than one row. */
describe('ProjectDocuments bulk actions', () => {
    let fixture: ComponentFixture<ProjectDocuments>;
    let store: InstanceType<typeof FileSystemStore>;
    let navigation: InstanceType<typeof NavigationStore>;
    let api: FileSystemApi;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ProjectDocuments],
            providers: [provideRouter([]), provideNoopAnimations(), DialogService, PopupService,
                { provide: CURRENT_APPLICATION,
                    useValue: TargetApplication.PROJECTS },
                { provide: SUPPORT_EMAIL_ADDRESS,
                    useValue: 'support@example.invalid' },
                provideHttpClient(withInterceptorsFromDi()),
                provideHttpClientTesting(),
                ProjectOverviewService,
                { provide: MOCK_CONFIG, useValue: {
                    minLatencyMs: 0, maxLatencyMs: 0, errorRate: 0, enableErrors: false
                } }
            ]
        }).compileComponents();
        fixture = TestBed.createComponent(ProjectDocuments);
        fixture.componentRef.setInput('id', 'project');
        store = fixture.debugElement.injector.get(FileSystemStore);
        navigation = fixture.debugElement.injector.get(NavigationStore);
        api = fixture.debugElement.injector.get(FileSystemApi);
        await settle();
    });

    /**
     * Render until the project stops re-initializing. The component initializes twice
     * on startup; a second one landing mid-operation makes the store discard it, which
     * is correct behaviour but would make these tests race it.
     */
    async function settle(): Promise<void> {
        for (let round = 0; round < 3; round++) {
            await render();
            await flushTimers();
        }
        await render();
    }

    async function flushTimers(): Promise<void> {
        for (let step = 0; step < 10; step++) {
            await new Promise((resolve) => { setTimeout(resolve, 0); });
        }
    }

    async function render(): Promise<void> {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
    }

    /**
     * Delete one node the way the search surface does — the row is not in the table, so
     * the context menu is not reachable; this drives the same container entry point.
     */
    async function deleteThrough(node: FileSystemNode): Promise<void> {
        const show = spyOn(TestBed.inject(PopupService), 'showPopup');
        const component = fixture.componentInstance as unknown as {
            requestDelete: (target: FileSystemNode, surface: 'table' | 'search') => void;
        };
        component.requestDelete(node, 'search');
        if (show.calls.any()) {
            await acceptPopup(show);

            return;
        }
        // A single item arms the inline buttons instead of a dialog.
        const component2 = fixture.componentInstance as unknown as {
            confirmDelete: (target: FileSystemNode) => void;
        };
        component2.confirmDelete(node);
        await flushTimers();
        await render();
    }

    async function pasteThrough(target: FolderNode): Promise<void> {
        const component = fixture.componentInstance as unknown as {
            pasteInto: (folder: FolderNode) => Promise<void>;
        };
        await component.pasteInto(target);
    }

    function clipboard(): ClipboardService {
        return fixture.debugElement.injector.get(ClipboardService);
    }

    function host(): HTMLElement {
        return fixture.nativeElement as HTMLElement;
    }

    /** Two rows of the current folder, selected with a click then a Ctrl-click. */
    function selectTwoRows(): FileSystemNode[] {
        const rows = navigation.currentFolderChildren();
        const chosen = [...rows.folders, ...rows.files]
            .filter((node) => !isFolder(node) || !node.isRecycleBin)
            .slice(0, 2);
        if (chosen.length < 2) { throw new Error('Expected two rows'); }
        click(chosen[0], {});
        // The table reads the selection back through its input, so it has to see the
        // first click before the second can extend it.
        fixture.detectChanges();
        click(chosen[1], { ctrlKey: true });
        fixture.detectChanges();
        expect(navigation.selectedIds().size).toBe(2);

        return chosen;
    }

    function click(node: FileSystemNode, modifiers: MouseEventInit): void {
        const row = host().querySelector(`[data-testid="pd-row-${node.id}"]`);
        if (!row) { throw new Error(`Missing row: ${node.name}`); }
        row.dispatchEvent(new MouseEvent('click', { bubbles: true, ...modifiers }));
    }

    function menuFor(node: FileSystemNode): MenuItem[] {
        const row = host().querySelector(`[data-testid="pd-row-${node.id}"]`);
        if (!row) { throw new Error(`Missing row: ${node.name}`); }
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        const menu = fixture.debugElement.query(By.directive(ContextMenu))
            .componentInstance as ContextMenu;

        return menu.model ?? [];
    }

    function invoke(items: MenuItem[], label: string): void {
        const item = items.find((entry) => entry.label === label);
        if (!item) { throw new Error(`Missing menu item: ${label}`); }
        expect(item.disabled).toBeFalsy();
        item.command?.({ item });
    }

    /**
     * Accept the confirmation the action opened, then wait for its work. `onAccept` is
     * invoked from here rather than through the component, so the promises it starts
     * are outside the zone and `whenStable` alone does not cover them.
     */
    async function acceptPopup(show: jasmine.Spy): Promise<void> {
        expect(show).toHaveBeenCalled();
        const props = show.calls.mostRecent().args[2] as { onAccept: () => void };
        props.onAccept();
        await flushTimers();
        await render();
    }

    it('confirms once, then deletes every selected row', async () => {
        const show = spyOn(TestBed.inject(PopupService), 'showPopup');
        // Resolved synchronously on purpose: a real async window lets the component's
        // second startup initialization land mid-batch, which the store then discards by
        // design. See the double-initialization finding in docs/TODO.md.
        const remove = spyOn(api, 'delete').and.returnValue(of(undefined));
        const [first, second] = selectTwoRows();

        invoke(menuFor(first), first.kind === 'folder' ? 'Delete Folder' : 'Delete File');
        await acceptPopup(show);

        expect((show.calls.mostRecent().args[2] as { message: string }).message)
            .toContain('2 items');
        expect(remove).toHaveBeenCalledTimes(2);
        expect(store.entityMap()[first.id]).toBeUndefined();
        expect(store.entityMap()[second.id]).toBeUndefined();
    });

    it('keeps the rows that survived a partly failed bulk delete', async () => {
        const show = spyOn(TestBed.inject(PopupService), 'showPopup');
        const [first, second] = selectTwoRows();
        spyOn(api, 'delete').and.callFake((_projectId, node) =>
            node.id === second.id
                ? throwError(() => new FileSystemError('network', 'Offline'))
                : of(undefined));

        invoke(menuFor(first), first.kind === 'folder' ? 'Delete Folder' : 'Delete File');
        await acceptPopup(show);

        expect(store.entityMap()[first.id]).toBeUndefined();
        expect(store.entityMap()[second.id]).toBeDefined();
    });

    /** Any row of the current folder that the given operation does not involve. */
    function uninvolvedRow(exclude: FileSystemNode[]): FileSystemNode {
        const excluded = new Set(exclude.map(({ id }) => id));
        const rows = navigation.currentFolderChildren();
        const row = [...rows.files, ...rows.folders]
            .find((node) => !excluded.has(node.id) && (!isFolder(node) || !node.isRecycleBin));
        if (!row) { throw new Error('Expected an uninvolved row'); }

        return row;
    }

    /** Two sibling hits, neither inside the other, with distinct paths as real ones have. */
    function searchHits(): FolderNode[] {
        const base = otherFolder([]);

        return [
            { ...base, id: 'hit-a', name: 'Hit A', path: `${base.path}/Hit A` },
            { ...base, id: 'hit-b', name: 'Hit B', path: `${base.path}/Hit B` }
        ];
    }

    /** A folder of the current list that is not one of the selected rows. */
    function otherFolder(exclude: FileSystemNode[]): FolderNode {
        const excluded = new Set(exclude.map(({ id }) => id));
        const folder = navigation.currentFolderChildren().folders
            .find((node) => !excluded.has(node.id) && !node.isRecycleBin);
        if (!folder) { throw new Error('Expected another folder'); }

        return folder;
    }

    it('copies every selected row and keeps the clipboard for another paste', async () => {
        const copy = spyOn(api, 'copy').and.callFake((_project, node, into) =>
            of({ ...node, id: `${node.id}-copy`, parentId: into.id }));
        const chosen = selectTwoRows();
        const target = otherFolder(chosen);

        invoke(menuFor(chosen[0]), chosen[0].kind === 'folder' ? 'Copy Folder' : 'Copy File');
        invoke(menuFor(target), 'Paste');
        await flushTimers();
        await render();

        expect(copy).toHaveBeenCalledTimes(2);
        // A copy clipboard survives its paste, so it can be pasted again elsewhere.
        expect(clipboard().isEmpty()).toBeFalse();
    });

    it('moves every cut row and spends the clipboard', async () => {
        const move = spyOn(api, 'move').and.callFake((_project, node, into) =>
            of({ ...node, parentId: into.id }));
        const chosen = selectTwoRows();
        const target = otherFolder(chosen);

        invoke(menuFor(chosen[0]), chosen[0].kind === 'folder' ? 'Cut Folder' : 'Cut File');
        expect(clipboard().mode()).toBe('cut');
        invoke(menuFor(target), 'Paste');
        await flushTimers();
        await render();

        expect(move).toHaveBeenCalledTimes(2);
        // A cut is spent once pasted; the items have already moved.
        expect(clipboard().isEmpty()).toBeTrue();
    });

    it('marks cut rows and leaves copied ones alone', () => {
        const chosen = selectTwoRows();

        invoke(menuFor(chosen[0]), chosen[0].kind === 'folder' ? 'Copy Folder' : 'Copy File');
        fixture.detectChanges();
        expect(host().querySelectorAll('.pd-row-cut').length).toBe(0);

        invoke(menuFor(chosen[0]), chosen[0].kind === 'folder' ? 'Cut Folder' : 'Cut File');
        fixture.detectChanges();
        expect(host().querySelectorAll('.pd-row-cut').length).toBe(2);
    });

    it('refuses a confirmation accepted after the project changed', async () => {
        const show = spyOn(TestBed.inject(PopupService), 'showPopup');
        const remove = spyOn(api, 'delete').and.returnValue(of(undefined));
        const [first] = selectTwoRows();

        invoke(menuFor(first), first.kind === 'folder' ? 'Delete Folder' : 'Delete File');
        // The dialog outlives its project: the guard was taken when it opened.
        await store.initialize('project');
        await acceptPopup(show);

        expect(remove).not.toHaveBeenCalled();
    });

    it('drops a search row for a hit the cache never held', async () => {
        const scope = navigation.currentFolder();
        if (!scope) { throw new Error('Expected a current folder'); }
        const hit = { ...otherFolder([]), id: 'uncached-hit', name: 'Uncached' };
        // First call returns the hit; the reconciling refresh after the delete asks
        // again, and by then the server no longer matches it.
        const searchCalls = spyOn(api, 'searchDocuments').and.returnValue(of([hit]));
        spyOn(api, 'delete').and.returnValue(of(undefined));
        const search = fixture.debugElement.injector.get(DocumentSearchService);
        search.search('project', scope, 'Uncached');
        await flushTimers();
        expect(search.results().length).toBe(1);

        // Nothing is cached under this id, so the cache reports no removal at all.
        searchCalls.and.returnValue(of([]));
        await deleteThrough(hit);

        expect(search.results().length).toBe(0);
        expect(searchCalls).toHaveBeenCalledTimes(2);
    });

    it('deletes a whole selection of search rows the cache never held', async () => {
        const hits = searchHits();
        const searchCalls = spyOn(api, 'searchDocuments').and.returnValue(of(hits));
        const remove = spyOn(api, 'delete').and.returnValue(of(undefined));
        const search = fixture.debugElement.injector.get(DocumentSearchService);
        // Through the history, not the service directly: the selection only resolves
        // from the surface that is showing, and search rows are only selectable while
        // that surface is up.
        navigation.openSearch('Hit');
        await settle();
        for (const hit of hits) {
            expect(store.entityMap()[hit.id]).toBeUndefined();
        }

        // Selected after opening the search, because entering one clears the selection.
        navigation.setSelection(hits.map(({ id }) => id), hits[0].id);
        searchCalls.and.returnValue(of([]));
        const show = spyOn(TestBed.inject(PopupService), 'showPopup');
        (fixture.componentInstance as unknown as {
            requestDelete: (target: FileSystemNode, surface: 'table' | 'search') => void;
        }).requestDelete(hits[0], 'search');
        await acceptPopup(show);

        expect(remove).toHaveBeenCalledTimes(2);
        expect(search.results()).toEqual([]);
    });

    it('acts once on a folder when its own child is selected too', async () => {
        // Only a search can show both: the right-pane table lists one folder's children,
        // so a parent and its child are never rows together there.
        const parent = otherFolder([]);
        const child: FileSystemNode = {
            kind: 'file',
            listKey: parent.listKey,
            id: 'child-hit',
            name: 'report.docx',
            path: `${parent.path}/report.docx`,
            parentId: parent.id,
            createdAt: parent.createdAt,
            modifiedAt: parent.modifiedAt
        };
        const hits: FileSystemNode[] = [parent, child];
        spyOn(api, 'searchDocuments').and.returnValue(of(hits));
        const remove = spyOn(api, 'delete').and.returnValue(of(undefined));
        navigation.openSearch('report');
        await settle();
        navigation.setSelection(hits.map(({ id }) => id), parent.id);

        const show = spyOn(TestBed.inject(PopupService), 'showPopup');
        (fixture.componentInstance as unknown as {
            requestDelete: (target: FileSystemNode, surface: 'table' | 'search') => void;
        }).requestDelete(parent, 'search');

        // Collapsed to the folder alone. Acting on both would delete the child twice —
        // and for a cut it would pull the file out of the folder it travelled with.
        expect(show.calls.mostRecent().args[2])
            .toEqual(jasmine.objectContaining({
                message: `Are you sure you want to delete “${parent.name}”?`
            }));

        await acceptPopup(show);

        expect(remove).toHaveBeenCalledTimes(1);
        expect(remove.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
            id: parent.id
        }));
    });

    it('drops a selected search row the refresh no longer returns', async () => {
        const hits = searchHits();
        const searchCalls = spyOn(api, 'searchDocuments').and.returnValue(of(hits));
        navigation.openSearch('Hit');
        await settle();
        navigation.setSelection(hits.map(({ id }) => id), hits[1].id);
        expect(navigation.selectedIds().size).toBe(2);

        // A re-query drops the second row — renaming it so it stops matching is the
        // easiest way in, but any refresh can. Its id must not stay selected with
        // nothing on screen, or a bulk action would reach it through the cache.
        searchCalls.and.returnValue(of([hits[0]]));
        fixture.debugElement.injector.get(DocumentSearchService).refresh();
        await settle();

        expect([...navigation.selectedIds()]).toEqual([hits[0].id]);
        // The anchor went with it, rather than pointing at a row that is gone.
        expect(navigation.selectionAnchorId()).toBeNull();
    });

    it('keeps the search rows rendered while the reconciling refresh is in flight',
        async () => {
            const scope = navigation.currentFolder();
            if (!scope) { throw new Error('Expected a current folder'); }
            const doomed = { ...otherFolder([]), id: 'hit-doomed', name: 'Doomed' };
            const kept = { ...otherFolder([]), id: 'hit-kept', name: 'Kept' };
            spyOn(api, 'searchDocuments').and.returnValue(of([doomed, kept]));
            spyOn(api, 'delete').and.returnValue(of(undefined));
            // The refresh never lands, so the assertions below see the window the user
            // sees: a slow re-query with rows already on screen.
            const refreshed = new Subject<FileSystemNode[]>();
            navigation.openSearch('Hit');
            await settle();
            expect(host().querySelector(`[data-testid="pd-search-result-${kept.id}"]`))
                .not.toBeNull();

            (api.searchDocuments as jasmine.Spy).and.returnValue(refreshed);
            await deleteThrough(doomed);
            await render();

            // The service preserving its results array is not enough: the view must also
            // not swap the table for its loading state. This is the assertion the
            // service-level test could not make.
            expect(host().querySelector(`[data-testid="pd-search-result-${kept.id}"]`))
                .not.toBeNull();
            expect(host().textContent).toContain('Updating results…');
            expect(host().textContent).not.toContain('Searching…');
            refreshed.complete();
        });

    it('keeps a clipboard copied while a cut-paste was still running', async () => {
        const chosen = selectTwoRows();
        const target = otherFolder(chosen);
        // One subject per call: a single cold Observable would be re-subscribed per
        // item and only the last subscriber reachable, so the paste would never finish.
        const pending: Subject<FileSystemNode>[] = [];
        spyOn(api, 'move').and.callFake(() => {
            const response = new Subject<FileSystemNode>();
            pending.push(response);

            return response;
        });

        invoke(menuFor(chosen[0]), chosen[0].kind === 'folder' ? 'Cut Folder' : 'Cut File');
        void pasteThrough(target);
        await flushTimers();
        // A newer intent arrives mid-paste and must survive the paste finishing. It has
        // to be a row this paste does not touch: the target is locked while writing,
        // and a cut row would legitimately be pruned when it moves.
        const bystander = uninvolvedRow([...chosen, target]);
        invoke(menuFor(bystander),
            bystander.kind === 'folder' ? 'Copy Folder' : 'Copy File');
        expect(pending.length).toBe(2);
        for (const [index, response] of pending.entries()) {
            response.next({ ...chosen[index], parentId: target.id });
            response.complete();
        }
        await flushTimers();
        await render();

        expect(clipboard().isEmpty()).toBeFalse();
        expect(clipboard().mode()).toBe('copy');
    });

    it('opens the paste target when a cut took the viewed folder with it', async () => {
        // A folder with children, so moving it removes a cached descendant.
        let parent: FolderNode | undefined;
        let child: FileSystemNode | undefined;
        for (const candidate of navigation.currentFolderChildren().folders) {
            if (candidate.isRecycleBin) { continue; }
            await store.loadChildren(candidate.id);
            child = store.entities().find((node) => node.parentId === candidate.id);
            if (child) { parent = candidate; break; }
        }
        if (!parent || !child) { throw new Error('Expected a folder with a child'); }
        // Chosen before navigating away: a target inside `parent` would be a descendant
        // paste, which is refused before the move is ever attempted.
        const target = otherFolder([parent]);
        navigation.navigateTo(child.id);
        await render();
        expect(navigation.currentFolderId()).toBe(child.id);
        spyOn(api, 'move').and.callFake((_project, node, folder) =>
            of({ ...node, parentId: folder.id }));

        clipboard().cut([parent]);
        await pasteThrough(target);
        await flushTimers();
        await render();

        // The move re-inserts only the returned folder, so the viewed child is gone and
        // the view has to land somewhere real.
        expect(navigation.currentFolderId()).toBe(target.id);
    });

    it('navigates when the folder opened during a cut-paste is the one removed', async () => {
        let parent: FolderNode | undefined;
        let child: FileSystemNode | undefined;
        for (const candidate of navigation.currentFolderChildren().folders) {
            if (candidate.isRecycleBin) { continue; }
            await store.loadChildren(candidate.id);
            child = store.entities().find((node) => node.parentId === candidate.id);
            if (child) { parent = candidate; break; }
        }
        if (!parent || !child) { throw new Error('Expected a folder with a child'); }
        const target = otherFolder([parent]);
        const pending: Subject<FileSystemNode>[] = [];
        spyOn(api, 'move').and.callFake(() => {
            const response = new Subject<FileSystemNode>();
            pending.push(response);

            return response;
        });

        clipboard().cut([parent]);
        void pasteThrough(target);
        await flushTimers();
        // The view changes *after* the paste began, to a folder the move will remove.
        navigation.navigateTo(child.id);
        await render();
        expect(navigation.currentFolderId()).toBe(child.id);
        pending[0]?.next({ ...parent, parentId: target.id });
        pending[0]?.complete();
        await flushTimers();
        await render();

        expect(navigation.currentFolderId()).toBe(target.id);
    });

    it('leaves a failed cut on the clipboard for a retry', async () => {
        const chosen = selectTwoRows();
        const target = otherFolder(chosen);
        spyOn(api, 'move').and.callFake((_project, node, folder) =>
            node.id === chosen[1].id
                ? throwError(() => new FileSystemError('network', 'Offline'))
                : of({ ...node, parentId: folder.id }));

        invoke(menuFor(chosen[0]), chosen[0].kind === 'folder' ? 'Cut Folder' : 'Cut File');
        await pasteThrough(target);
        await flushTimers();
        await render();

        // Pruning removes only what actually moved, so the failure stays to be retried
        // rather than being cleared along with it.
        expect(clipboard().ids().has(chosen[1].id)).toBeTrue();
        expect(clipboard().ids().has(chosen[0].id)).toBeFalse();
    });

    it('keeps Rename single-item while a selection is active', () => {
        const [first] = selectTwoRows();
        const items = menuFor(first);
        const label = first.kind === 'folder' ? 'Rename Folder' : 'Rename File';

        expect(items.find((entry) => entry.label === label)?.disabled).toBeTrue();
    });
});
