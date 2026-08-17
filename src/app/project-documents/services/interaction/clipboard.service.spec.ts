import { TestBed } from '@angular/core/testing';
import type { FileNode } from '../../models/file-system-node.model';
import { ClipboardService } from './clipboard.service';

describe('ClipboardService', () => {
    let clipboard: ClipboardService;

    beforeEach(() => {
        TestBed.configureTestingModule({ providers: [ClipboardService] });
        clipboard = TestBed.inject(ClipboardService);
    });

    it('retains the complete canonical node for a later paste', () => {
        clipboard.copy([file]);

        expect(clipboard.nodes()).toEqual([file]);
        expect(clipboard.ids()).toEqual(new Set([file.id]));
        expect(clipboard.mode()).toBe('copy');
    });

    it('prunes retained nodes by id', () => {
        clipboard.copy([file]);

        clipboard.pruneReferences([file.id]);

        expect(clipboard.nodes()).toEqual([]);
        expect(clipboard.mode()).toBeNull();
    });
});

const file: FileNode = {
    kind: 'file',
    listKey: 'EXECUTION',
    id: 'file-1',
    path: '/execution/Contracts/report.docx',
    name: 'report.docx',
    parentId: 'contracts',
    sizeBytes: 1024,
    createdAt: '2026-08-17T09:00:00Z',
    modifiedAt: '2026-08-17T10:00:00Z'
};
