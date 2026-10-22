import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
    ActivatedRoute, convertToParamMap, type ParamMap, provideRouter, Router
} from '@angular/router';
import type { MenuItem } from 'primeng/api';
import { ContextMenu } from 'primeng/contextmenu';
import { DialogService } from 'primeng/dynamicdialog';
import { firstValueFrom, throwError } from 'rxjs';
import { PopupService, TRACE_ID_HEADER } from 'ibportal-web-ui-commons';
import { FileTable } from './components/file-table/file-table';
import { FileLaunchService } from './services/interaction/file-launch.service';
import { isFolder, type FolderNode } from './models/file-system-node.model';
import { FileSystemApi } from './services/file-system/file-system-api';
import { MOCK_CONFIG } from './services/mock/mock-config.token';
import { FileSystemStore } from './stores/file-system.store';
import { NavigationStore } from './stores/navigation.store';
import { ProjectDocuments } from './project-documents';

describe('ProjectDocuments access and recycle-bin integration', () => {
    let fixture: ComponentFixture<ProjectDocuments>;
    let store: InstanceType<typeof FileSystemStore>;
    let navigation: InstanceType<typeof NavigationStore>;
    let queryParams: Record<string, string>;

    beforeEach(async () => {
        queryParams = {};
        await TestBed.configureTestingModule({
            imports: [ProjectDocuments],
            providers: [provideRouter([]), provideNoopAnimations(), DialogService,
                { provide: ActivatedRoute, useValue: { snapshot: {
                    get queryParamMap(): ParamMap { return convertToParamMap(queryParams); }
                } } },
                { provide: MOCK_CONFIG, useValue: {
                    minLatencyMs: 0, maxLatencyMs: 0, errorRate: 0, enableErrors: false,
                    protectedFolderPaths: ['execution/Contracts'],
                    readonlyFolderPaths: ['marketing/Press'], readonlyListKeys: ['MARKETING']
                } }
            ]
        }).compileComponents();
        fixture = TestBed.createComponent(ProjectDocuments);
        fixture.componentRef.setInput('projectId', 'project-123');
        fixture.componentRef.setInput('projectLabel', 'Project');
        store = fixture.debugElement.injector.get(FileSystemStore);
        navigation = fixture.debugElement.injector.get(NavigationStore);
    });

    async function render(): Promise<void> {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
    }

    function host(): HTMLElement {
        return fixture.nativeElement as HTMLElement;
    }

    function folder(path: string): FolderNode {
        const node = store.entities().find((candidate) => candidate.path === path);
        if (!node || !isFolder(node)) { throw new Error(`Missing folder: ${path}`); }

        return node;
    }

    function menuFor(node: FolderNode): MenuItem[] {
        const row = host().querySelector(`[data-testid="pd-row-${node.id}"]`);
        if (!row) { throw new Error(`Missing row: ${node.name}`); }
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

        const menu = fixture.debugElement.query(By.directive(ContextMenu))
            .componentInstance as ContextMenu;

        return menu.model ?? [];
    }

    function disabled(items: MenuItem[], label: string): boolean | undefined {
        return items.find((item) => item.label === label)?.disabled;
    }

    it('opens Execution first and keeps recycle bins last in both trees', async () => {
        await render();
        expect(navigation.currentFolder()?.listKey).toBe('EXECUTION');
        const labels = [...host().querySelectorAll('.pd-tree-section-title')]
            .map((element) => element.textContent?.trim());
        expect(labels).toEqual(['Project - Execution Documents', 'Project - Marketing Documents']);
        expect(host().querySelector('.pd-status')?.textContent).toContain('4 folders, 0 files');
        const bin = folder('/execution/Recycle Bin');
        expect(host().querySelector(`[data-testid="pd-row-${bin.id}"]`)).toBeNull();
        const tree = host().querySelector('pr-folder-tree');
        const names = [...tree!.querySelectorAll('.pd-tree-label')]
            .map((element) => element.textContent?.trim());
        expect(names[names.length - 1]).toBe('Recycle Bin');
    });

    it('resolves a case-insensitive list deep link after default initialization and clears the URL',
        async () => {
            queryParams['listKey'] = 'eXeCuTiOn';
            queryParams['folderPath'] = '/execution/Contracts';
            const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
            await render();
            expect(navigation.currentFolder()?.path).toBe('/execution/Contracts');
            expect(navigation.history().length).toBe(2);
            expect(navigate).toHaveBeenCalledOnceWith([], { queryParams: [], replaceUrl: true });
        });

    it('ignores an invalid initial list and leaves query parameters unchanged', async () => {
        queryParams['listKey'] = 'invalid';
        queryParams['folderPath'] = '/execution/Contracts';
        const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
        await render();
        expect(navigation.currentFolder()?.path).toBe('/execution');
        expect(navigate).not.toHaveBeenCalled();
    });

    it('applies target-list access to tree menus while another writable list is open', async () => {
        await render();
        const label = [...host().querySelectorAll('.pd-tree-node')]
            .find((element) => element.textContent?.trim() === 'Campaigns');
        if (!label) { throw new Error('Expected Campaigns tree label'); }
        label.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        const menu = fixture.debugElement.query(By.directive(ContextMenu))
            .componentInstance as ContextMenu;
        expect(navigation.currentFolder()?.listKey).toBe('EXECUTION');
        expect(disabled(menu.model ?? [], 'Rename Folder')).toBeTrue();
        expect(disabled(menu.model ?? [], 'Upload within folder')).toBeTrue();
        expect(disabled(menu.model ?? [], 'Copy Folder')).toBeFalse();
    });

    it('protects default folder identity while allowing its contents to be edited', async () => {
        await render();
        const contracts = folder('/execution/Contracts');
        const items = menuFor(contracts);
        expect(disabled(items, 'Rename Folder')).toBeTrue();
        expect(disabled(items, 'Delete Folder')).toBeTrue();
        expect(disabled(items, 'Copy Folder')).toBeFalse();
        expect(disabled(items, 'Upload within folder')).toBeFalse();
        navigation.navigateTo(contracts.id);
        await render();
        expect((host().querySelector('[data-testid="pd-btn-new-folder"]') as HTMLButtonElement)
            .disabled).toBeFalse();
    });

    it('uses destination list access and disables bin actions in readonly lists',
        async () => {
            await render();
            const press = folder('/marketing/Press');
            navigation.navigateTo(press.parentId!);
            await render();
            const items = menuFor(press);
            expect(disabled(items, 'Rename Folder')).toBeTrue();
            expect(disabled(items, 'Delete Folder')).toBeTrue();
            expect(disabled(items, 'Upload within folder')).toBeTrue();
            const api = fixture.debugElement.injector.get(FileSystemApi);
            await firstValueFrom(api.delete('project-123', press));
            const bin = folder('/marketing/Recycle Bin');
            navigation.navigateTo(bin.id);
            await render();
            const record = store.entities().find((node): node is FolderNode =>
                isFolder(node) && node.parentId === bin.id)!;
            const binMenu = menuFor(record);
            expect(binMenu.map((item) => item.label)).toEqual(['Restore', 'Delete']);
            expect(binMenu.every((item) => item.disabled)).toBeTrue();
            expect((host().querySelector('[data-testid="pd-search"]') as HTMLInputElement)
                .disabled).toBeTrue();
        });

    it('shows escaped HTTP restore failures with their trace ID and retains the deleted record',
        async () => {
            await render();
            await store.delete(folder('/execution/Schedules').id);
            navigation.navigateTo(folder('/execution/Recycle Bin').id);
            await render();
            const record = store.entities().find((node): node is FolderNode =>
                isFolder(node) && node.parentId === navigation.currentFolderId())!;
            const api = fixture.debugElement.injector.get(FileSystemApi);
            spyOn(api, 'restoreRecycleBinItem').and.returnValue(throwError(() =>
                new HttpErrorResponse({
                    status: 409,
                    error: { message: '<b>Original name exists</b>' },
                    headers: new HttpHeaders({ [TRACE_ID_HEADER]: 'restore-trace-123' })
                })));
            const showError = spyOn(TestBed.inject(PopupService), 'showErrorPopupWithReportAction')
                .and.callThrough();
            const item = menuFor(record).find((candidate) => candidate.label === 'Restore')!;
            item.command?.({ item });
            await render();
            const dialogs = [...document.querySelectorAll('.p-dialog')];
            const error = dialogs.find((dialog) => dialog.textContent?.includes('Cannot restore'));
            expect(error?.textContent).toContain('<b>Original name exists</b>');
            expect(error?.querySelector('b')).toBeNull();
            expect(error?.textContent).toContain('restore-trace-123');
            expect(showError).toHaveBeenCalledOnceWith({
                title: 'Cannot restore the item',
                message: '<b>Original name exists</b>',
                escapeMessage: true,
                traceId: 'restore-trace-123',
                isClosable: true
            });
            expect(store.entityMap()[record.id]).toBeDefined();
        });

    it('shows the generic PR restore error for failures without an HTTP response', async () => {
        await render();
        await store.delete(folder('/execution/Schedules').id);
        navigation.navigateTo(folder('/execution/Recycle Bin').id);
        await render();
        const record = store.entities().find((node): node is FolderNode =>
            isFolder(node) && node.parentId === navigation.currentFolderId())!;
        const api = fixture.debugElement.injector.get(FileSystemApi);
        spyOn(api, 'restoreRecycleBinItem').and.returnValue(throwError(() => new Error('Failed')));
        const item = menuFor(record).find((candidate) => candidate.label === 'Restore')!;
        item.command?.({ item });
        await render();
        const error = document.querySelector('pr-error-popup');
        expect(error?.textContent).toContain(
            'An error occurred when trying to restore the item. Please refresh and try again.');
        expect(error?.querySelector('[data-testid="popup-trace-id"]')).toBeNull();
        expect(store.entityMap()[record.id]).toBeDefined();
    });

    it('requires confirmation before permanently deleting a recycle-bin record', async () => {
        await render();
        await store.delete(folder('/execution/Schedules').id);
        navigation.navigateTo(folder('/execution/Recycle Bin').id);
        await render();
        const binId = navigation.currentFolderId();
        const record = store.entities().find((node): node is FolderNode =>
            isFolder(node) && node.parentId === binId)!;
        const api = fixture.debugElement.injector.get(FileSystemApi);
        const remove = spyOn(api, 'deletePermanentlyRecycleBinItem').and.callThrough();
        const item = menuFor(record).find((candidate) => candidate.label === 'Delete')!;
        item.command?.({ item });
        await render();
        expect(remove).not.toHaveBeenCalled();
        const confirm = document.querySelector<HTMLButtonElement>(
            '[data-testid="confirmation-popup-confirm"]');
        expect(confirm).not.toBeNull();
        confirm?.click();
        await render();
        expect(remove).toHaveBeenCalledOnceWith('project-123', binId!, record.id);
        expect(store.entityMap()[record.id]).toBeUndefined();
        expect(host().textContent).toContain('The recycle bin is empty.');
    });

    it('keeps a recycle-bin record when the shared confirmation is cancelled', async () => {
        await render();
        await store.delete(folder('/execution/Schedules').id);
        navigation.navigateTo(folder('/execution/Recycle Bin').id);
        await render();
        const record = store.entities().find((node): node is FolderNode =>
            isFolder(node) && node.parentId === navigation.currentFolderId())!;
        const api = fixture.debugElement.injector.get(FileSystemApi);
        const remove = spyOn(api, 'deletePermanentlyRecycleBinItem').and.callThrough();
        const item = menuFor(record).find((candidate) => candidate.label === 'Delete')!;
        item.command?.({ item });
        await render();
        const cancel = document.querySelector<HTMLButtonElement>(
            '[data-testid="confirmation-popup-cancel"]');
        expect(cancel).not.toBeNull();
        cancel?.click();
        await render();
        expect(remove).not.toHaveBeenCalled();
        expect(store.entityMap()[record.id]).toBeDefined();
    });

    it('keeps the current bin when Open Folder is requested from the tree', async () => {
        await render();
        const bin = folder('/execution/Recycle Bin');
        navigation.navigateTo(bin.id);
        await render();
        const label = [...host().querySelectorAll('.pd-tree-node')]
            .find((element) => element.textContent?.trim() === 'Contracts');
        expect(label).toBeDefined();
        label?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        const menu = fixture.debugElement.query(By.directive(ContextMenu))
            .componentInstance as ContextMenu;
        const item = menu.model?.find((candidate) => candidate.label === 'Open Folder');
        expect(item).toBeDefined();
        item?.command?.({ item });
        await render();
        expect(navigation.currentFolderId()).toBe(bin.id);
    });

    it('ignores a deleted file activation emitted while viewing its bin', async () => {
        await render();
        const contracts = folder('/execution/Contracts');
        navigation.navigateTo(contracts.id);
        await render();
        const file = store.entities().find((node) =>
            node.kind === 'file' && node.parentId === contracts.id)!;
        await store.delete(file.id);
        const bin = folder('/execution/Recycle Bin');
        navigation.navigateTo(bin.id);
        await render();
        const record = store.entities().find((node) =>
            node.kind === 'file' && node.parentId === bin.id)!;
        const open = spyOn(fixture.debugElement.injector.get(FileLaunchService), 'openOnline');
        const table = fixture.debugElement.query(By.directive(FileTable))
            .componentInstance as FileTable;
        table.itemDoubleClicked.emit(record);
        await render();
        expect(open).not.toHaveBeenCalled();
        expect(navigation.currentFolderId()).toBe(bin.id);
    });
});
