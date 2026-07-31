import { TestBed } from '@angular/core/testing';
import { buildDirectoryManifest } from './directory-manifest';
import { ExternalDropService } from './external-drop.service';

describe('ExternalDropService', () => {
    let service: ExternalDropService;

    beforeEach(() => {
        TestBed.configureTestingModule({ providers: [ExternalDropService] });
        service = TestBed.inject(ExternalDropService);
    });

    it('reads modern file and directory handles from a desktop drop', async () => {
        const file = new File(['report'], 'report.pdf');
        const directory = modernDirectory('Package');
        const transfer = dataTransfer([
            modernItem(modernFile(file)),
            modernItem(directory)
        ]);

        const selection = await service.read(transfer);

        expect(selection.files).toEqual([file]);
        expect(selection.directories).toEqual([directory]);
    });

    it('adapts a legacy dropped directory and reads every entry batch', async () => {
        const legacyRoot = legacyDirectory('Package', [
            [legacyFile('first.txt', 'first')],
            [legacyDirectory('Empty', [])],
            []
        ]);
        const transfer = dataTransfer([legacyItem(legacyRoot)]);

        const selection = await service.read(transfer);
        const manifest = await buildDirectoryManifest(selection.directories[0]);

        expect(manifest.directories.map((entry) => entry.relativePath)).toEqual([
            'Package',
            'Package/Empty'
        ]);
        expect(manifest.files.map((entry) => entry.relativePath)).toEqual([
            'Package/first.txt'
        ]);
    });

    it('falls back to DataTransfer.files when item handles are unavailable', async () => {
        const file = new File(['plain'], 'plain.txt');
        const transfer = dataTransfer([], [file]);

        expect(service.containsFiles(transfer)).toBeTrue();
        await expectAsync(service.read(transfer)).toBeResolvedTo({
            files: [file],
            directories: []
        });
    });

    it('captures the plain-file fallback before the drag data becomes protected', async () => {
        const file = new File(['protected'], 'protected.txt');
        const transfer = protectedFallbackDataTransfer(file);

        await expectAsync(service.read(transfer)).toBeResolvedTo({
            files: [file],
            directories: []
        });
    });
});

function dataTransfer(
    items: readonly DataTransferItem[],
    files: readonly File[] = []
): DataTransfer {
    return {
        items: arrayLike(items),
        files: arrayLike(files),
        types: files.length > 0 || items.length > 0 ? ['Files'] : []
    } as unknown as DataTransfer;
}

function modernItem(handle: FileSystemHandleUnion): DataTransferItem {
    return {
        kind: 'file',
        type: '',
        getAsFileSystemHandle: async () => handle,
        getAsFile: () => null,
        webkitGetAsEntry: () => null
    } as unknown as DataTransferItem;
}

function legacyItem(entry: FileSystemEntry): DataTransferItem {
    return {
        kind: 'file',
        type: '',
        getAsFile: () => null,
        webkitGetAsEntry: () => entry
    } as unknown as DataTransferItem;
}

function protectedFallbackDataTransfer(file: File): DataTransfer {
    let accessible = true;
    const item = {
        kind: 'file',
        type: '',
        getAsFileSystemHandle: () => Promise.resolve().then(() => {
            accessible = false;

            return null;
        }),
        getAsFile: () => null,
        webkitGetAsEntry: () => null
    } as unknown as DataTransferItem;

    return {
        items: arrayLike([item]),
        get files(): FileList {
            return arrayLike(accessible ? [file] : []) as FileList;
        },
        types: ['Files']
    } as unknown as DataTransfer;
}

function modernFile(file: File): FileSystemFileHandle {
    return {
        kind: 'file',
        name: file.name,
        getFile: async () => file
    } as FileSystemFileHandle;
}

function modernDirectory(name: string): FileSystemDirectoryHandle {
    const children: FileSystemHandleUnion[] = [];

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

function legacyFile(name: string, contents: string): FileSystemFileEntry {
    const file = new File([contents], name);

    return {
        isFile: true,
        isDirectory: false,
        name,
        file: (success: FileCallback) => { success(file); }
    } as FileSystemFileEntry;
}

function legacyDirectory(
    name: string,
    batches: readonly (readonly FileSystemEntry[])[]
): FileSystemDirectoryEntry {
    return {
        isFile: false,
        isDirectory: true,
        name,
        createReader: () => {
            let index = 0;

            return {
                readEntries: (success: FileSystemEntriesCallback) => {
                    success([...(batches[index++] ?? [])]);
                }
            } as FileSystemDirectoryReader;
        }
    } as FileSystemDirectoryEntry;
}

function arrayLike<T>(values: readonly T[]): ArrayLike<T> {
    return Object.assign([...values], {
        item: (index: number) => values[index] ?? null
    });
}
