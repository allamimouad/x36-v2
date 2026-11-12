import type { FileSystemNode, FolderNode } from '../models/file-system-node.model';
import { containsNode, pathContainsOrEquals } from './node-containment.utils';

/**
 * The path comparison behind every "a folder cannot go inside itself" guard. It is the
 * only thing that can produce that message: the real API answers a descendant copy with
 * a generic HTTP 500 (verified against SharePoint, 2026-11-05), which carries no
 * descendant signal to map.
 */
describe('pathContainsOrEquals', () => {
    it('ignores case, because SharePoint server-relative URLs do', () => {
        // The same folder is addressable either way, so an exact compare would let a
        // differently-cased destination past the guard.
        expect(pathContainsOrEquals('/Contracts', '/contracts/Vendors')).toBeTrue();
        expect(pathContainsOrEquals('/Contracts', '/CONTRACTS')).toBeTrue();
        expect(pathContainsOrEquals('/contracts', '/Contracts/Vendors/2026')).toBeTrue();
    });

    it('treats an equal path as contained and a sibling prefix as not', () => {
        expect(pathContainsOrEquals('/Contracts', '/Contracts')).toBeTrue();

        // The trailing slash is the whole reason this holds.
        expect(pathContainsOrEquals('/Contracts', '/Contracts2')).toBeFalse();
        expect(pathContainsOrEquals('/Contracts', '/contracts2/Vendors')).toBeFalse();
        expect(pathContainsOrEquals('/Contracts/Vendors', '/Contracts')).toBeFalse();
    });
});

describe('containsNode', () => {
    it('falls back to a case-insensitive path test when the parent is not cached', () => {
        // A search hit's ancestors are absent from the cache, so the id walk cannot
        // reach the folder and the path decides.
        const ancestor = folder('contracts', '/Contracts', null);
        const descendant = file('report', '/contracts/Vendors/report.docx', 'vendors');

        expect(containsNode(ancestor, descendant, {})).toBeTrue();
    });

    it('never matches across document lists, whatever the paths say', () => {
        const ancestor = folder('exec', '/Shared', null);
        const other: FileSystemNode = {
            ...file('mkt', '/Shared/brief.docx', 'shared'),
            listKey: 'MARKETING'
        };

        expect(containsNode(ancestor, other, {})).toBeFalse();
    });

    it('does not treat a sibling with a shared prefix as contained', () => {
        const ancestor = folder('contracts', '/Contracts', null);
        const sibling = folder('contracts2', '/Contracts2', null);

        expect(containsNode(ancestor, sibling, {})).toBeFalse();
    });
});

function folder(id: string, path: string, parentId: string | null): FolderNode {
    return {
        kind: 'folder',
        isRecycleBin: false,
        listKey: 'EXECUTION',
        id,
        path,
        name: path.slice(path.lastIndexOf('/') + 1),
        parentId,
        itemCount: 0,
        createdAt: '2026-10-01T00:00:00Z',
        modifiedAt: '2026-10-01T00:00:00Z'
    };
}

function file(id: string, path: string, parentId: string): FileSystemNode {
    return {
        kind: 'file',
        listKey: 'EXECUTION',
        id,
        path,
        name: path.slice(path.lastIndexOf('/') + 1),
        parentId,
        createdAt: '2026-10-01T00:00:00Z',
        modifiedAt: '2026-10-01T00:00:00Z'
    };
}
