import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { FileNode, FolderNode } from '../../models/file-system-node.model';
import { FileTable } from './file-table';

describe('FileTable', () => {
    let fixture: ComponentFixture<FileTable>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({ imports: [FileTable] }).compileComponents();
        fixture = TestBed.createComponent(FileTable);
        fixture.componentRef.setInput('folders', [folder]);
        fixture.componentRef.setInput('files', [file]);
    });

    it('shows controls only on the pending row and focuses Cancel', async () => {
        fixture.componentRef.setInput('deleteConfirmationId', file.id);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const cancel = button(`pd-delete-cancel-${file.id}`);
        expect(cancel).not.toBeNull();
        expect(button(`pd-delete-confirm-${file.id}`)).not.toBeNull();
        expect(button(`pd-delete-cancel-${folder.id}`)).toBeNull();
        expect(document.activeElement).toBe(cancel);
    });

    it('emits confirm and cancel without navigating the row', () => {
        fixture.componentRef.setInput('deleteConfirmationId', file.id);
        fixture.detectChanges();
        const confirmed = jasmine.createSpy('confirmed');
        const cancelled = jasmine.createSpy('cancelled');
        const focused = jasmine.createSpy('focused');
        fixture.componentInstance.deleteConfirmed.subscribe(confirmed);
        fixture.componentInstance.deleteCancelled.subscribe(cancelled);
        fixture.componentInstance.itemFocused.subscribe(focused);

        button(`pd-delete-confirm-${file.id}`)?.click();
        button(`pd-delete-cancel-${file.id}`)?.click();

        expect(confirmed).toHaveBeenCalledOnceWith(file);
        expect(cancelled).toHaveBeenCalledTimes(1);
        expect(focused).not.toHaveBeenCalled();
    });

    it('hides a file extension while renaming and restores it on submit', async () => {
        fixture.componentRef.setInput('renamingId', file.id);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const input = renameInput();
        const submitted = jasmine.createSpy('submitted');
        fixture.componentInstance.renameSubmitted.subscribe(submitted);

        expect(input.value).toBe('report');

        input.value = 'renamed-report';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect(submitted).toHaveBeenCalledOnceWith({ node: file, name: 'renamed-report.docx' });
    });

    it('keeps the complete folder name editable', async () => {
        fixture.componentRef.setInput('renamingId', folder.id);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const input = renameInput();
        const submitted = jasmine.createSpy('submitted');
        fixture.componentInstance.renameSubmitted.subscribe(submitted);

        expect(input.value).toBe('Reports');

        input.value = 'Reports.2026';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect(submitted).toHaveBeenCalledOnceWith({ node: folder, name: 'Reports.2026' });
    });

    it('hides the virtual recycle bin from ordinary listings', () => {
        fixture.componentRef.setInput('folders', [folder, { ...folder,
            id: 'bin', name: 'Recycle Bin', isRecycleBin: true }]);
        fixture.detectChanges();
        expect(hostElement().querySelector('[data-testid="pd-row-bin"]')).toBeNull();
        expect(hostElement().querySelector(`[data-testid="pd-row-${folder.id}"]`)).not.toBeNull();
    });

    it('shows deleted metadata without navigation or empty-space actions', () => {
        fixture.componentRef.setInput('currentFolderIsRecycleBin', true);
        fixture.componentRef.setInput('projectName', 'Project');
        fixture.componentRef.setInput('currentFolderListKey', 'EXECUTION');
        fixture.componentRef.setInput('folders', [{ ...folder,
            path: 'sites/archived/another-library/Reports' }]);
        fixture.componentRef.setInput('files', [{ ...file,
            path: 'sites/archived/another-library/report.docx' }]);
        const activated = jasmine.createSpy('activated');
        const emptyMenu = jasmine.createSpy('emptyMenu');
        fixture.componentInstance.itemDoubleClicked.subscribe(activated);
        fixture.componentInstance.emptyContextMenuRequested.subscribe(emptyMenu);
        fixture.detectChanges();

        const host = hostElement();
        expect([...host.querySelectorAll('.pd-th-label')].map((el) => el.textContent?.trim()))
            .toEqual(['File Name', 'Path', 'Deleted', 'Deleted By', 'Size']);
        expect(host.textContent).toContain(file.name);
        expect(host.textContent).toContain('Project/execution/Reports');
        host.querySelector(`[data-testid="pd-row-${file.id}"]`)?.dispatchEvent(
            new MouseEvent('dblclick', { bubbles: true }));
        host.querySelector('.pd-table-surface')?.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true }));
        expect(activated).not.toHaveBeenCalled();
        expect(emptyMenu).not.toHaveBeenCalled();
    });

    it('suppresses blank-space drops in a read-only current folder', () => {
        fixture.componentRef.setInput('isCurrentFolderReadonly', true);
        fixture.detectChanges();
        const dropped = jasmine.createSpy('dropped');
        fixture.componentInstance.currentFolderDropped.subscribe(dropped);
        const space = hostElement().querySelector('.pd-current-folder-space');
        expect(space).not.toBeNull();
        space?.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
        expect(dropped).not.toHaveBeenCalled();
    });

    it('replaces the selection on a plain click and toggles on Ctrl', () => {
        fixture.componentRef.setInput('selectedIds', new Set([folder.id]));
        fixture.detectChanges();
        const requested = jasmine.createSpy('selectionRequested');
        fixture.componentInstance.selectionRequested.subscribe(requested);

        clickRow(file.id, {});
        expect(requested).toHaveBeenCalledWith({ ids: [file.id], anchorId: file.id });

        clickRow(file.id, { ctrlKey: true });
        expect(requested).toHaveBeenCalledWith({
            ids: [folder.id, file.id], anchorId: file.id
        });
    });

    it('extends a Shift-range across the rendered rows and keeps the anchor', () => {
        fixture.componentRef.setInput('selectedIds', new Set([folder.id]));
        fixture.componentRef.setInput('selectionAnchorId', folder.id);
        fixture.detectChanges();
        const requested = jasmine.createSpy('selectionRequested');
        fixture.componentInstance.selectionRequested.subscribe(requested);

        clickRow(file.id, { shiftKey: true });

        // Folders render before files, so the range spans both rows; the anchor stays
        // put so a further Shift-click re-extends from the same row.
        expect(requested).toHaveBeenCalledWith({
            ids: [folder.id, file.id], anchorId: folder.id
        });
    });

    it('falls back to a plain click when Shift is used with no anchor', () => {
        fixture.detectChanges();
        const requested = jasmine.createSpy('selectionRequested');
        fixture.componentInstance.selectionRequested.subscribe(requested);

        clickRow(file.id, { shiftKey: true });

        expect(requested).toHaveBeenCalledWith({ ids: [file.id], anchorId: file.id });
    });

    function clickRow(id: string, modifiers: MouseEventInit): void {
        const element = hostElement().querySelector(`[data-testid="pd-row-${id}"]`);
        if (!(element instanceof HTMLElement)) { throw new Error(`Missing row ${id}`); }
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, ...modifiers }));
        fixture.detectChanges();
    }

    function button(testId: string): HTMLButtonElement | null {
        return hostElement().querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
    }

    function renameInput(): HTMLInputElement {
        const input = hostElement().querySelector('.pd-inline-rename-input');
        if (!(input instanceof HTMLInputElement)) {
            throw new Error('Expected inline rename input');
        }

        return input;
    }

    function hostElement(): HTMLElement {
        const element: unknown = fixture.nativeElement;
        if (!(element instanceof HTMLElement)) {
            throw new Error('Expected FileTable host element');
        }

        return element;
    }
});

const folder: FolderNode = {
    kind: 'folder',
    isRecycleBin: false,
    listKey: 'EXECUTION',
    id: 'folder-1',
    path: '/Documents/Reports',
    name: 'Reports',
    parentId: 'root-1',
    itemCount: 0,
    createdAt: '2026-08-04T00:00:00Z',
    modifiedAt: '2026-08-04T00:00:00Z'
};

const file: FileNode = {
    kind: 'file',
    listKey: 'EXECUTION',
    id: 'file-1',
    path: '/Documents/report.docx',
    name: 'report.docx',
    parentId: 'root-1',
    sizeBytes: 10,
    createdAt: '2026-08-04T00:00:00Z',
    modifiedAt: '2026-08-04T00:00:00Z'
};
