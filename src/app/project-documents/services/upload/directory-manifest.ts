import { FileSystemError } from '../../models/file-system-error.model';

export interface LocalDirectoryEntry {
    name: string;
    relativePath: string;
    parentRelativePath: string | null;
}

export interface LocalFileEntry {
    file: File;
    relativePath: string;
    parentRelativePath: string;
}

export interface DirectoryManifest {
    root: LocalDirectoryEntry;
    directories: LocalDirectoryEntry[];
    files: LocalFileEntry[];
}

interface ManifestAccumulator {
    directories: LocalDirectoryEntry[];
    files: LocalFileEntry[];
    signal?: AbortSignal;
}

export async function buildDirectoryManifest(
    rootHandle: FileSystemDirectoryHandle,
    signal?: AbortSignal
): Promise<DirectoryManifest> {
    const accumulator: ManifestAccumulator = { directories: [], files: [], signal };
    await visitDirectory(rootHandle, rootHandle.name, null, accumulator);

    return {
        root: accumulator.directories[0],
        directories: accumulator.directories,
        files: accumulator.files
    };
}

async function visitDirectory(
    handle: FileSystemDirectoryHandle,
    relativePath: string,
    parentRelativePath: string | null,
    accumulator: ManifestAccumulator
): Promise<void> {
    throwIfCancelled(accumulator.signal);
    accumulator.directories.push({ name: handle.name, relativePath, parentRelativePath });
    const children = await sortedChildren(handle, accumulator.signal);
    for (const child of children) {
        throwIfCancelled(accumulator.signal);
        const childPath = `${relativePath}/${child.name}`;
        if (child.kind === 'directory') {
            await visitDirectory(child, childPath, relativePath, accumulator);
        } else {
            await addFile(child, childPath, relativePath, accumulator);
        }
    }
}

async function sortedChildren(
    handle: FileSystemDirectoryHandle,
    signal?: AbortSignal
): Promise<FileSystemHandleUnion[]> {
    const children: FileSystemHandleUnion[] = [];
    for await (const child of handle.values()) {
        throwIfCancelled(signal);
        children.push(child);
    }

    return children.sort((a, b) => a.name.localeCompare(b.name));
}

async function addFile(
    handle: FileSystemFileHandle,
    relativePath: string,
    parentRelativePath: string,
    accumulator: ManifestAccumulator
): Promise<void> {
    const file = await handle.getFile();
    throwIfCancelled(accumulator.signal);
    accumulator.files.push({ file, relativePath, parentRelativePath });
}

function throwIfCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new FileSystemError('cancelled', 'Folder upload was cancelled');
    }
}
