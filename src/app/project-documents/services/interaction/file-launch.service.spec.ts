import { TestBed } from '@angular/core/testing';
import type { FileNode, FolderNode } from '../../models/file-system-node.model';
import { FileLaunchService } from './file-launch.service';

describe('FileLaunchService', () => {
    let service: FileLaunchService;

    beforeEach(() => {
        TestBed.configureTestingModule({ providers: [FileLaunchService] });
        service = TestBed.inject(FileLaunchService);
    });

    it('exposes only safe absolute web links', () => {
        const file = node({
            onlineUrl: 'https://sharepoint.test/Documents/report.docx?web=1',
            downloadUrl: 'javascript:alert(1)'
        });

        expect(service.canOpenOnline(file)).toBeTrue();
        expect(service.canDownload(file)).toBeFalse();
        expect(service.canDownload(node({
            downloadUrl: 'https://user:password@sharepoint.test/file.pdf'
        }))).toBeFalse();
    });

    it('exposes only safe absolute SharePoint folder links', () => {
        expect(service.canOpenSharePointWeb(folder({
            webUrl: 'https://sharepoint.test/sites/project/Documents/Contracts'
        }))).toBeTrue();
        expect(service.canOpenSharePointWeb(folder({
            webUrl: 'javascript:alert(1)'
        }))).toBeFalse();
    });

    it('opens a safe SharePoint folder link in a new tab', () => {
        const open = spyOn(window, 'open');

        expect(service.openSharePointWeb(folder({
            webUrl: 'https://sharepoint.test/sites/project/Documents/Contracts'
        }))).toBeTrue();
        expect(open).toHaveBeenCalledOnceWith(
            'https://sharepoint.test/sites/project/Documents/Contracts',
            '_blank',
            'noopener'
        );
    });

    it('accepts supported Office edit and view URI schemes', () => {
        expect(service.canOpenDesktop(node({
            desktopUrl: 'ms-word:ofe|u|https://sharepoint.test/Documents/report.docx'
        }))).toBeTrue();
        expect(service.canOpenDesktop(node({
            desktopUrl: 'ms-excel:ofv|u|http://sharepoint.test/Documents/report.xlsx'
        }))).toBeTrue();
    });

    it('rejects arbitrary protocols and malformed Office URIs', () => {
        expect(service.canOpenDesktop(node({
            desktopUrl: 'custom-app:ofe|u|https://sharepoint.test/file.bin'
        }))).toBeFalse();
        expect(service.canOpenDesktop(node({
            desktopUrl: 'ms-word:ofe|u|javascript:alert(1)'
        }))).toBeFalse();
    });

    it('clicks a temporary anchor for a safe direct download', () => {
        const click = spyOn(HTMLAnchorElement.prototype, 'click');

        expect(service.download(node({
            downloadUrl: 'https://sharepoint.test/_layouts/15/download.aspx?SourceUrl=%2Ffile.pdf'
        }))).toBeTrue();
        expect(click).toHaveBeenCalled();
    });
});

function node(overrides: Partial<FileNode>): FileNode {
    return {
        kind: 'file',
        listKey: 'EXECUTION',
        id: 'file-1',
        path: '/Documents/report.docx',
        name: 'report.docx',
        parentId: 'folder-1',
        sizeBytes: 10,
        createdAt: '2026-07-31T00:00:00.000Z',
        modifiedAt: '2026-07-31T00:00:00.000Z',
        ...overrides
    };
}

function folder(overrides: Partial<FolderNode>): FolderNode {
    return {
        kind: 'folder',
        listKey: 'EXECUTION',
        id: 'folder-1',
        path: '/Documents',
        name: 'Documents',
        parentId: null,
        itemCount: 0,
        createdAt: '2026-07-31T00:00:00.000Z',
        modifiedAt: '2026-07-31T00:00:00.000Z',
        ...overrides
    };
}
