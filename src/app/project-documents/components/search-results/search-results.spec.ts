import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { FileSystemNode } from '../../models/file-system-node.model';
import { SearchResults } from './search-results';

describe('SearchResults', () => {
    let fixture: ComponentFixture<SearchResults>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({ imports: [SearchResults] }).compileComponents();
        fixture = TestBed.createComponent(SearchResults);
        fixture.componentRef.setInput('results', [result]);
        fixture.componentRef.setInput('rootPath', '/execution');
        fixture.componentRef.setInput('query', 'report');
        fixture.detectChanges();
    });

    it('shows the result location and activates only a double-clicked result', () => {
        const activated = jasmine.createSpy('activated');
        fixture.componentInstance.resultActivated.subscribe(activated);
        const row = host().querySelector<HTMLElement>(
            `[data-testid="pd-search-result-${result.id}"]`
        );
        if (!row) { throw new Error('Expected search result row'); }

        row.click();

        expect(activated).not.toHaveBeenCalled();

        row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

        expect(host().textContent).toContain('execution/Contracts');
        expect(host().textContent).toContain('Created');
        expect(host().textContent).toContain('Last Modified');
        expect(host().textContent).toContain('Modified By');
        expect(host().textContent).toContain('Editor');
        expect(host().textContent).not.toContain('Size');
        expect(activated).toHaveBeenCalledOnceWith(result);
    });

    it('emits a search-result request on right-click', () => {
        const requested = jasmine.createSpy('requested');
        fixture.componentInstance.contextMenuRequested.subscribe(requested);
        const row = host().querySelector<HTMLElement>(
            `[data-testid="pd-search-result-${result.id}"]`
        );
        if (!row) { throw new Error('Expected search result row'); }
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

        row.dispatchEvent(event);

        expect(event.defaultPrevented).toBeTrue();
        expect(requested).toHaveBeenCalledOnceWith({ event, result });
    });

    it('submits an inline file rename while preserving the extension', () => {
        const renamed = jasmine.createSpy('renamed');
        fixture.componentInstance.renameSubmitted.subscribe(renamed);
        fixture.componentRef.setInput('renamingId', result.id);
        fixture.detectChanges();
        const input = host().querySelector<HTMLInputElement>(
            'input[aria-label="Rename search result"]'
        );
        if (!input) { throw new Error('Expected rename input'); }
        input.value = 'renamed-report';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect(renamed).toHaveBeenCalledOnceWith({
            node: result,
            name: 'renamed-report.docx'
        });
    });

    it('confirms inline deletion with the canonical result node', () => {
        const confirmed = jasmine.createSpy('confirmed');
        fixture.componentInstance.deleteConfirmed.subscribe(confirmed);
        fixture.componentRef.setInput('deleteConfirmationId', result.id);
        fixture.detectChanges();
        const button = host().querySelector<HTMLButtonElement>(
            `[aria-label="Confirm deleting ${result.name}"]`
        );
        if (!button) { throw new Error('Expected delete confirmation'); }

        button.click();

        expect(confirmed).toHaveBeenCalledOnceWith(result);
    });

    function host(): HTMLElement {
        const element: unknown = fixture.nativeElement;
        if (!(element instanceof HTMLElement)) { throw new Error('Expected component host'); }

        return element;
    }
});

const result: FileSystemNode = {
    kind: 'file',
    listKey: 'EXECUTION',
    id: 'file-1',
    name: 'report.docx',
    path: '/execution/Contracts/report.docx',
    parentId: 'contracts',
    createdAt: '2026-08-17T09:00:00Z',
    modifiedAt: '2026-08-17T10:00:00Z',
    modifiedBy: 'Editor',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    onlineUrl: 'https://sharepoint.example/report.docx',
    downloadUrl: 'https://sharepoint.example/report.docx?download=1'
};
