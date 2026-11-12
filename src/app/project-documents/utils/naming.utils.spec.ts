import type { FileNode, FolderNode } from '../models/file-system-node.model';
import {
    editableName,
    resolveNameCollision,
    splitFileName,
    submittedName,
    validateName
} from './naming.utils';

describe('splitFileName', () => {
    it('splits at the last dot and leaves the dot out of the extension', () => {
        expect(splitFileName('report.docx')).toEqual({ base: 'report', ext: 'docx' });
        expect(splitFileName('archive.tar.gz')).toEqual({ base: 'archive.tar', ext: 'gz' });
    });

    it('treats a leading dot as part of the name', () => {
        // `.gitignore` is a name, not an empty name with an extension.
        expect(splitFileName('.gitignore')).toEqual({ base: '.gitignore', ext: '' });
    });

    it('treats a trailing dot as part of the name', () => {
        // Otherwise the dot is read as an empty extension, and whatever rebuilds the
        // name drops it — `report.` would quietly become `report`.
        expect(splitFileName('report.')).toEqual({ base: 'report.', ext: '' });
    });

    it('reports no extension when there is no dot', () => {
        expect(splitFileName('README')).toEqual({ base: 'README', ext: '' });
        expect(splitFileName('')).toEqual({ base: '', ext: '' });
    });
});

describe('editableName', () => {
    it('withholds a file extension and offers a folder name whole', () => {
        // The extension is not in the box, so it cannot be edited away by accident.
        expect(editableName(file('report.docx'))).toBe('report');
        expect(editableName(folder('Contracts'))).toBe('Contracts');
        expect(editableName(folder('v1.2'))).toBe('v1.2');
    });

    it('offers a dotfile whole, having no extension to withhold', () => {
        expect(editableName(file('.gitignore'))).toBe('.gitignore');
    });
});

describe('submittedName', () => {
    it('puts back the extension it withheld', () => {
        expect(submittedName(file('report.docx'), 'summary')).toBe('summary.docx');
        expect(submittedName(file('report.docx'), '  summary  ')).toBe('summary.docx');
    });

    it('takes a folder name exactly as typed', () => {
        expect(submittedName(folder('Contracts'), ' Vendors ')).toBe(' Vendors ');
    });

    it('keeps blank input intact rather than inventing a bare extension', () => {
        // The caller rejects an empty name; returning `.docx` here would hand it a
        // plausible-looking name to send instead.
        expect(submittedName(file('report.docx'), '')).toBe('');
        expect(submittedName(file('report.docx'), '   ')).toBe('   ');
    });

    it('returns the input unchanged when there was no extension to restore', () => {
        expect(submittedName(file('README'), 'NOTES')).toBe('NOTES');
        expect(submittedName(file('report.'), 'summary')).toBe('summary');
    });
});

describe('validateName', () => {
    it('accepts an ordinary name', () => {
        expect(validateName('Quarterly report.docx')).toEqual({ valid: true });
    });

    it('rejects empty, reserved, invalid-character and over-long names', () => {
        expect(validateName('   ')).toEqual({ valid: false, reason: 'empty' });
        expect(validateName('.')).toEqual({ valid: false, reason: 'reserved' });
        expect(validateName('..')).toEqual({ valid: false, reason: 'reserved' });
        expect(validateName('a/b')).toEqual({ valid: false, reason: 'invalid-chars' });
        expect(validateName('a:b')).toEqual({ valid: false, reason: 'invalid-chars' });
        expect(validateName('x'.repeat(129))).toEqual({ valid: false, reason: 'too-long' });
        expect(validateName('x'.repeat(128))).toEqual({ valid: true });
    });
});

describe('resolveNameCollision', () => {
    it('leaves a free name alone', () => {
        expect(resolveNameCollision('report.docx', ['other.docx'])).toBe('report.docx');
    });

    it('suffixes before the extension, and keeps counting past taken suffixes', () => {
        expect(resolveNameCollision('report.docx', ['report.docx'])).toBe('report (2).docx');
        expect(resolveNameCollision('report.docx', ['report.docx', 'report (2).docx']))
            .toBe('report (3).docx');
    });

    it('suffixes at the end when there is no extension', () => {
        expect(resolveNameCollision('Contracts', ['Contracts'])).toBe('Contracts (2)');
        expect(resolveNameCollision('.gitignore', ['.gitignore'])).toBe('.gitignore (2)');
    });

    it('compares case-insensitively, as the backend does', () => {
        expect(resolveNameCollision('Report.docx', ['report.docx'])).toBe('Report (2).docx');
    });
});

function file(name: string): FileNode {
    return {
        kind: 'file',
        listKey: 'EXECUTION',
        id: `file-${name}`,
        name,
        path: `/execution/${name}`,
        parentId: 'root',
        createdAt: '2026-10-01T00:00:00Z',
        modifiedAt: '2026-10-01T00:00:00Z'
    };
}

function folder(name: string): FolderNode {
    return {
        kind: 'folder',
        isRecycleBin: false,
        listKey: 'EXECUTION',
        id: `folder-${name}`,
        name,
        path: `/execution/${name}`,
        parentId: 'root',
        itemCount: 0,
        createdAt: '2026-10-01T00:00:00Z',
        modifiedAt: '2026-10-01T00:00:00Z'
    };
}
