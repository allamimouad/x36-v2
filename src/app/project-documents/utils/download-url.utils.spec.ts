import type { FileNode, FolderNode } from '../models/file-system-node.model';
import { downloadDragData, safeWebUrl } from './download-url.utils';

describe('download-url utils', () => {
    const url = 'https://sharepoint.test/_layouts/15/download.aspx?SourceUrl=%2Freport.pdf';

    function file(overrides: Partial<FileNode> = {}): FileNode {
        return {
            kind: 'file', listKey: 'EXECUTION', id: 'f1', path: '/Docs/report.pdf',
            name: 'report.pdf', parentId: 'd1', modifiedAt: '2026-01-01T00:00:00Z',
            downloadUrl: url, ...overrides
        };
    }

    it('accepts http(s) and rejects other schemes, credentials and garbage', () => {
        expect(safeWebUrl(url)).toBe(url);
        expect(safeWebUrl('javascript:alert(1)')).toBeNull();
        expect(safeWebUrl('https://user:password@sharepoint.test/file.pdf')).toBeNull();
        expect(safeWebUrl('not a url')).toBeNull();
        expect(safeWebUrl(undefined)).toBeNull();
    });

    it('builds a DownloadURL payload for a file with a safe download link', () => {
        expect(downloadDragData(file())).toBe(`application/octet-stream:report.pdf:${url}`);
    });

    it('offers nothing for a folder, a missing or unsafe link, or a name with a colon', () => {
        const folder: FolderNode = {
            kind: 'folder', listKey: 'EXECUTION', id: 'd1', path: '/Docs', name: 'Docs',
            parentId: null, modifiedAt: '2026-01-01T00:00:00Z', isRecycleBin: false
        };
        expect(downloadDragData(folder)).toBeNull();
        expect(downloadDragData(file({ downloadUrl: undefined }))).toBeNull();
        expect(downloadDragData(file({ downloadUrl: 'javascript:alert(1)' }))).toBeNull();
        expect(downloadDragData(file({ name: 'a:b.pdf' }))).toBeNull();
    });
});
