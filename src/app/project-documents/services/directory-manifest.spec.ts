import { FileSystemError } from '../models/file-system-error.model';
import { buildDirectoryManifest } from './directory-manifest';

describe('buildDirectoryManifest', () => {
    it(
        'returns every directory including empty descendants and maps files to parents',
        async () => {
            const root = fakeDirectory('Customer Folder', [
                fakeDirectory('Empty'),
                fakeDirectory('A', [fakeFile('report.pdf', 'report')]),
                fakeDirectory('B', [
                    fakeDirectory('C', [fakeFile('image.png', 'image')])
                ])
            ]);

            const manifest = await buildDirectoryManifest(root);

            expect(manifest.directories.map((entry) => entry.relativePath)).toEqual([
                'Customer Folder',
                'Customer Folder/A',
                'Customer Folder/B',
                'Customer Folder/B/C',
                'Customer Folder/Empty'
            ]);
            expect(
                manifest.files.map((entry) => ({
                    path: entry.relativePath,
                    parent: entry.parentRelativePath
                }))
            ).toEqual([
                {
                    path: 'Customer Folder/A/report.pdf',
                    parent: 'Customer Folder/A'
                },
                {
                    path: 'Customer Folder/B/C/image.png',
                    parent: 'Customer Folder/B/C'
                }
            ]);
        }
    );

    it('stops traversal when folder preparation is cancelled', async () => {
        const controller = new AbortController();
        controller.abort();

        await expectAsync(
            buildDirectoryManifest(fakeDirectory('Cancelled'), controller.signal)
        ).toBeRejectedWithError(FileSystemError);
    });
});

function fakeDirectory(
    name: string,
    children: readonly FileSystemHandleUnion[] = []
): FileSystemDirectoryHandle {
    return {
        kind: 'directory',
        name,
        async *values(): AsyncIterableIterator<FileSystemHandleUnion> {
            for (const child of children) {
                yield child;
            }
        }
    } as FileSystemDirectoryHandle;
}

function fakeFile(name: string, contents: string): FileSystemFileHandle {
    return {
        kind: 'file',
        name,
        getFile: async () => new File([contents], name)
    } as FileSystemFileHandle;
}
