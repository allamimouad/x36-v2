import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { MenuItem } from 'primeng/api';
import { ContextMenu } from 'primeng/contextmenu';
import { DialogService } from 'primeng/dynamicdialog';
import { Subject } from 'rxjs';
import { PopupService } from 'ibportal-web-ui-commons';
import { isFolder, type FileSystemNode } from './models/file-system-node.model';
import { ProjectDocuments } from './project-documents';
import { FileSystemApi } from './services/file-system/file-system-api';
import { MOCK_CONFIG } from './services/mock/mock-config.token';
import {
    DEFAULT_FILE_MANAGER_CONFIG, FILE_MANAGER_CONFIG
} from './tokens/file-manager-config.token';
import { NavigationStore } from './stores/navigation.store';
import { ProjectOverviewService } from '../../services/project-overview.service';

/**
 * Work queued by a menu action must not go out once the component is gone — navigating
 * away mid-batch would otherwise keep mutating the project behind a screen the user has
 * left. The drag queue has always been covered (`drag-drop.service.batch.spec.ts`); this
 * is the container's own guard, which was previously only verified by inspection.
 *
 * Concurrency is pinned to 1 so a two-item batch leaves the second waiting, which is the
 * only window where the guard can be observed at all.
 */
describe('ProjectDocuments batch lifetime', () => {
    let fixture: ComponentFixture<ProjectDocuments>;
    let navigation: InstanceType<typeof NavigationStore>;
    let api: FileSystemApi;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ProjectDocuments],
            providers: [provideRouter([]), provideNoopAnimations(), DialogService,
                ProjectOverviewService,
                { provide: FILE_MANAGER_CONFIG, useValue: {
                    ...DEFAULT_FILE_MANAGER_CONFIG, bulkOpConcurrency: 1
                } },
                { provide: MOCK_CONFIG, useValue: {
                    minLatencyMs: 0, maxLatencyMs: 0, errorRate: 0, enableErrors: false
                } }
            ]
        }).compileComponents();
        fixture = TestBed.createComponent(ProjectDocuments);
        fixture.componentRef.setInput('id', 'project');
        navigation = fixture.debugElement.injector.get(NavigationStore);
        api = fixture.debugElement.injector.get(FileSystemApi);
        // The component initializes twice on startup; see docs/TODO.md item 8.
        for (let round = 0; round < 3; round++) {
            await render();
            await flushTimers();
        }
        await render();
    });

    it('does not delete a queued item after the component is destroyed', async () => {
        const responses: Subject<undefined>[] = [];
        const remove = spyOn(api, 'delete').and.callFake(() => {
            const response = new Subject<undefined>();
            responses.push(response);

            return response;
        });
        const chosen = selectTwoRows();
        const show = spyOn(TestBed.inject(PopupService), 'showPopup');

        invoke(menuFor(chosen[0]), isFolder(chosen[0]) ? 'Delete Folder' : 'Delete File');
        const props = show.calls.mostRecent().args[2] as { onAccept: () => void };
        props.onAccept();
        await flushTimers();

        // One in flight, one waiting behind it.
        expect(remove).toHaveBeenCalledTimes(1);

        fixture.destroy();
        responses[0].next(undefined);
        responses[0].complete();
        await flushTimers();

        // The waiting item never went out. A request already sent cannot be recalled —
        // the store's connection revision discards its result instead.
        expect(remove).toHaveBeenCalledTimes(1);
    });

    async function flushTimers(): Promise<void> {
        for (let step = 0; step < 10; step++) {
            await new Promise((resolve) => { setTimeout(resolve, 0); });
        }
    }

    async function render(): Promise<void> {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
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
        if (navigation.selectedIds().size !== 2) { throw new Error('Expected two selected'); }

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

    function host(): HTMLElement {
        return fixture.nativeElement as HTMLElement;
    }
});
