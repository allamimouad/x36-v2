import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { TreeNode } from 'primeng/api';
import type { FolderNode } from '../../models/file-system-node.model';
import { FolderTree } from './folder-tree';

describe('FolderTree inline delete confirmation', () => {
    let fixture: ComponentFixture<FolderTree>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({ imports: [FolderTree] }).compileComponents();
        fixture = TestBed.createComponent(FolderTree);
        fixture.componentRef.setInput('nodes', nodes);
    });

    it('shows controls only on the pending node and focuses Cancel', async () => {
        fixture.componentRef.setInput('deleteConfirmationId', child.id);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const cancel = button(`pd-delete-cancel-${child.id}`);
        expect(cancel).not.toBeNull();
        expect(button(`pd-delete-confirm-${child.id}`)).not.toBeNull();
        expect(button(`pd-delete-cancel-${root.id}`)).toBeNull();
        expect(document.activeElement).toBe(cancel);
    });

    it('emits confirm and cancel without selecting the tree node', () => {
        fixture.componentRef.setInput('deleteConfirmationId', child.id);
        fixture.detectChanges();
        const confirmed = jasmine.createSpy('confirmed');
        const cancelled = jasmine.createSpy('cancelled');
        const selected = jasmine.createSpy('selected');
        fixture.componentInstance.deleteConfirmed.subscribe(confirmed);
        fixture.componentInstance.deleteCancelled.subscribe(cancelled);
        fixture.componentInstance.nodeSelected.subscribe(selected);

        button(`pd-delete-confirm-${child.id}`)?.click();
        button(`pd-delete-cancel-${child.id}`)?.click();

        expect(confirmed).toHaveBeenCalledOnceWith(child);
        expect(cancelled).toHaveBeenCalledTimes(1);
        expect(selected).not.toHaveBeenCalled();
    });

    function button(testId: string): HTMLButtonElement | null {
        return hostElement().querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
    }

    function hostElement(): HTMLElement {
        const element: unknown = fixture.nativeElement;
        if (!(element instanceof HTMLElement)) {
            throw new Error('Expected FolderTree host element');
        }

        return element;
    }
});

const root: FolderNode = {
    kind: 'folder',
    listKey: 'EXECUTION',
    id: 'root-1',
    path: '/Documents',
    name: 'Execution',
    parentId: null,
    itemCount: 1,
    createdAt: '2026-08-04T00:00:00Z',
    modifiedAt: '2026-08-04T00:00:00Z'
};

const child: FolderNode = {
    kind: 'folder',
    listKey: 'EXECUTION',
    id: 'folder-1',
    path: '/Documents/Reports',
    name: 'Reports',
    parentId: root.id,
    itemCount: 0,
    createdAt: '2026-08-04T00:00:00Z',
    modifiedAt: '2026-08-04T00:00:00Z'
};

const nodes: TreeNode<FolderNode>[] = [{
    key: root.id,
    label: root.name,
    data: root,
    expanded: true,
    children: [{ key: child.id, label: child.name, data: child }]
}];
