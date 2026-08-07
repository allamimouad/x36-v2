import { TestBed } from '@angular/core/testing';
import { isFile, isFolder, type FolderNode } from '../../models/file-system-node.model';
import { FileSystemApi } from '../file-system/file-system-api';
import { MockFileSystemApi } from '../mock/mock-file-system-api';
import { MOCK_CONFIG } from '../mock/mock-config.token';
import { FileSystemStore } from '../../stores/file-system.store';
import { FILE_MANAGER_CONFIG } from '../../tokens/file-manager-config.token';
import { UploadService } from './upload.service';

describe('UploadService', () => {
    let fileSystem: InstanceType<typeof FileSystemStore>;
    let uploads: UploadService;
    let executionRoot: FolderNode;

    beforeEach(async () => {
        TestBed.configureTestingModule({
            providers: [
                FileSystemStore,
                UploadService,
                { provide: FileSystemApi, useClass: MockFileSystemApi },
                {
                    provide: MOCK_CONFIG,
                    useValue: {
                        errorRate: 0,
                        minLatencyMs: 0,
                        maxLatencyMs: 0,
                        enableErrors: false
                    }
                },
                {
                    provide: FILE_MANAGER_CONFIG,
                    useValue: {
                        libraryRootName: 'Documents',
                        maxUploadSizeBytes: 250 * 1024 * 1024,
                        uploadConcurrency: 2,
                        bulkOpConcurrency: 4
                    }
                }
            ]
        });
        fileSystem = TestBed.inject(FileSystemStore);
        uploads = TestBed.inject(UploadService);
        const roots = await fileSystem.initialize('project-123');
        if (roots.EXECUTION.status !== 'loaded') {
            throw new Error('Expected execution root');
        }
        executionRoot = roots.EXECUTION.root;
    });

    it('creates the complete directory tree before uploading its files', async () => {
        const handle = fakeDirectory('Customer Folder', [
            fakeDirectory('Empty'),
            fakeDirectory('A', [fakeFile('report.pdf', 'report')]),
            fakeDirectory('B', [
                fakeDirectory('C', [fakeFile('image.png', 'image')])
            ])
        ]);

        await uploads.enqueueDirectory(handle, executionRoot);
        await waitForUploads(uploads);

        const nodes = fileSystem.entities();
        const selectedRoot = requireFolder(nodes, '/execution/Customer Folder');
        const empty = requireFolder(nodes, '/execution/Customer Folder/Empty');
        const a = requireFolder(nodes, '/execution/Customer Folder/A');
        const c = requireFolder(nodes, '/execution/Customer Folder/B/C');
        const report = nodes.find(
            (node) => node.path === '/execution/Customer Folder/A/report.pdf'
        );
        const image = nodes.find(
            (node) => node.path === '/execution/Customer Folder/B/C/image.png'
        );

        expect(selectedRoot.parentId).toBe(executionRoot.id);
        expect(empty.parentId).toBe(selectedRoot.id);
        expect(report?.parentId).toBe(a.id);
        expect(image?.parentId).toBe(c.id);
        expect(uploads.tasks().every((task) => task.status === 'done')).toBeTrue();
        expect(uploads.batches()[0].status).toBe('done');
    });

    it('keeps empty trees and gives duplicate roots unique names', async () => {
        await uploads.enqueueDirectory(
            fakeDirectory('Empty Package', [fakeDirectory('Nested Empty')]),
            executionRoot
        );
        await uploads.enqueueDirectory(
            fakeDirectory('Empty Package', [fakeDirectory('Nested Empty')]),
            executionRoot
        );

        const nodes = fileSystem.entities();
        expect(nodes.some((node) => node.path === '/execution/Empty Package/Nested Empty'))
            .toBeTrue();
        expect(nodes.some((node) => node.path === '/execution/Empty Package (1)/Nested Empty'))
            .toBeTrue();
    });

    it('shows every dropped folder but prepares their trees one at a time', async () => {
        const firstGate = deferred();
        const secondGate = deferred();
        const thirdGate = deferred();
        const preparations = [
            uploads.enqueueDirectory(
                gatedDirectory('First Folder', firstGate.promise),
                executionRoot
            ),
            uploads.enqueueDirectory(
                gatedDirectory('Second Folder', secondGate.promise),
                executionRoot
            ),
            uploads.enqueueDirectory(
                gatedDirectory('Third Folder', thirdGate.promise),
                executionRoot
            )
        ];

        expect(uploads.batches().map((batch) => batch.status))
            .toEqual(['preparing', 'queued', 'queued']);

        firstGate.resolve();
        await waitForBatchStatus(uploads, 1, 'preparing');
        expect(uploads.batches().map((batch) => batch.status))
            .toEqual(['done', 'preparing', 'queued']);

        secondGate.resolve();
        await waitForBatchStatus(uploads, 2, 'preparing');
        expect(uploads.batches().map((batch) => batch.status))
            .toEqual(['done', 'done', 'preparing']);

        thirdGate.resolve();
        await Promise.all(preparations);
        expect(uploads.batches().map((batch) => batch.status))
            .toEqual(['done', 'done', 'done']);
    });

    it('rejects an oversized file without calling the file-system upload operation', () => {
        const api = TestBed.inject(FileSystemApi);
        const upload = spyOn(api, 'upload').and.callThrough();
        const oversized = new File(['content'], 'oversized.bin');
        Object.defineProperty(oversized, 'size', {
            value: 250 * 1024 * 1024 + 1
        });

        uploads.enqueueFiles([oversized], executionRoot);

        expect(upload).not.toHaveBeenCalled();
        expect(uploads.tasks()[0].status).toBe('error');
        expect(uploads.tasks()[0].errorCode).toBe('too-large');
    });

    it('fails a duplicate file without overwriting the completed upload', async () => {
        uploads.enqueueFiles([new File(['first'], 'duplicate.txt')], executionRoot);
        await waitForUploads(uploads);
        uploads.enqueueFiles([new File(['second'], 'duplicate.txt')], executionRoot);
        await waitForUploads(uploads);

        expect(uploads.tasks().map((task) => task.status)).toEqual(['done', 'error']);
        expect(uploads.tasks()[1].errorCode).toBe('name-collision');
        const duplicateFiles = fileSystem.entities()
            .filter(isFile)
            .filter((node) => node.path === '/execution/duplicate.txt');
        expect(duplicateFiles.length).toBe(1);
        expect(duplicateFiles[0].sizeBytes).toBe(5);
    });

    it('cancels an active upload without creating its file', async () => {
        uploads.enqueueFiles([new File(['cancel me'], 'cancelled.txt')], executionRoot);
        uploads.cancelTask(uploads.tasks()[0].id);
        await waitForUploads(uploads);

        expect(uploads.tasks()[0].status).toBe('cancelled');
        expect(
            fileSystem.entities().some((node) => node.path === '/execution/cancelled.txt')
        ).toBeFalse();
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
            await Promise.resolve();
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
        getFile: () => Promise.resolve(new File([contents], name))
    } as FileSystemFileHandle;
}

function gatedDirectory(
    name: string,
    gate: Promise<undefined>,
    children: readonly FileSystemHandleUnion[] = []
): FileSystemDirectoryHandle {
    return {
        kind: 'directory',
        name,
        async *values(): AsyncIterableIterator<FileSystemHandleUnion> {
            await gate;
            for (const child of children) {
                yield child;
            }
        }
    } as FileSystemDirectoryHandle;
}

function deferred(): { promise: Promise<undefined>; resolve: () => undefined } {
    let resolve = (): undefined => undefined;
    const promise = new Promise<undefined>((done) => {
        resolve = (): undefined => {
            done(undefined);

            return undefined;
        };
    });

    return { promise, resolve };
}

function requireFolder(
    nodes: ReturnType<InstanceType<typeof FileSystemStore>['entities']>,
    path: string
): FolderNode {
    const folder = nodes.find((node) => node.path === path);
    if (!folder || !isFolder(folder)) {
        throw new Error(`Expected folder at ${path}`);
    }

    return folder;
}

async function waitForUploads(uploads: UploadService): Promise<void> {
    const timeoutAt = Date.now() + 5_000;
    while (
        uploads.tasks().some(
            (task) =>
                task.status === 'queued' ||
                task.status === 'uploading' ||
                task.status === 'finalizing'
        )
    ) {
        if (Date.now() > timeoutAt) {
            throw new Error('Uploads did not finish');
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

async function waitForBatchStatus(
    uploads: UploadService,
    index: number,
    status: 'preparing'
): Promise<void> {
    const timeoutAt = Date.now() + 5_000;
    while (uploads.batches()[index]?.status !== status) {
        if (Date.now() > timeoutAt) {
            throw new Error(`Batch ${index} did not reach ${status}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}
