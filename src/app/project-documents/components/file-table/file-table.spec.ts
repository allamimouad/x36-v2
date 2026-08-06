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

    function button(testId: string): HTMLButtonElement | null {
        return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
    }

    function renameInput(): HTMLInputElement {
        const input = fixture.nativeElement.querySelector('.pd-inline-rename-input');
        if (!(input instanceof HTMLInputElement)) {
            throw new Error('Expected inline rename input');
        }

        return input;
    }
});

const folder: FolderNode = {
    kind: 'folder',
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
