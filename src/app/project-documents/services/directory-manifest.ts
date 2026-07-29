import { FileSystemError } from '../models/file-system-error.model';

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

export async function buildDirectoryManifest(
    rootHandle: FileSystemDirectoryHandle,
    signal?: AbortSignal
): Promise<DirectoryManifest> {
    const directories: LocalDirectoryEntry[] = [];
    const files: LocalFileEntry[] = [];

    const visit = async (
        handle: FileSystemDirectoryHandle,
        relativePath: string,
        parentRelativePath: string | null
    ): Promise<void> => {
        throwIfCancelled(signal);
        directories.push({
            name: handle.name,
            relativePath,
            parentRelativePath
        });

        const children: FileSystemHandleUnion[] = [];
        for await (const child of handle.values()) {
            throwIfCancelled(signal);
            children.push(child);
        }
        children.sort((a, b) => a.name.localeCompare(b.name));

        for (const child of children) {
            throwIfCancelled(signal);
            const childPath = `${relativePath}/${child.name}`;
            if (child.kind === 'directory') {
                await visit(child, childPath, relativePath);
            } else {
                const file = await child.getFile();
                throwIfCancelled(signal);
                files.push({
                    file,
                    relativePath: childPath,
                    parentRelativePath: relativePath
                });
            }
        }
    };

    await visit(rootHandle, rootHandle.name, null);

    return {
        root: directories[0],
        directories,
        files
    };
}

function throwIfCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new FileSystemError('cancelled', 'Folder upload was cancelled');
    }
}
