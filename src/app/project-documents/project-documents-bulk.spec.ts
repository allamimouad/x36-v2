import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { MenuItem } from 'primeng/api';
import { ContextMenu } from 'primeng/contextmenu';
import { DialogService } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { PopupService } from 'ibportal-web-ui-commons';
import { FileSystemError } from './models/file-system-error.model';
import { isFolder, type FileSystemNode, type FolderNode } from './models/file-system-node.model';
import { ProjectDocuments } from './project-documents';
import { FileSystemApi } from './services/file-system/file-system-api';
import { MOCK_CONFIG } from './services/mock/mock-config.token';
import { ClipboardService } from './services/interaction/clipboard.service';
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
            providers: [provideRouter([]), provideNoopAnimations(), DialogService,
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

    /** A folder of the current list that is not one of the selected rows. */
    function otherFolder(exclude: FileSystemNode[]): FolderNode {
        const excluded = new Set(exclude.map(({ id }) => id));
        const folder = navigation.currentFolderChildren().folders
            .find((node) => !excluded.has(node.id) && !node.isRecycleBin);
        if (!folder) { throw new Error('Expected another folder'); }

        return folder;
    }

    it('copies every selected row and keeps the clipboard for another paste', async () => {
        const copy = spyOn(api, 'copy').and.callFake((_project, node, target) =>
            of({ ...node, id: `${node.id}-copy`, parentId: target.id }));
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
        const move = spyOn(api, 'move').and.callFake((_project, node, target) =>
            of({ ...node, parentId: target.id }));
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

    it('keeps Rename single-item while a selection is active', () => {
        const [first] = selectTwoRows();
        const items = menuFor(first);
        const label = first.kind === 'folder' ? 'Rename Folder' : 'Rename File';

        expect(items.find((entry) => entry.label === label)?.disabled).toBeTrue();
    });
});
