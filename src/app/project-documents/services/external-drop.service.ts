import { Injectable } from '@angular/core';

export interface ExternalDropSelection {
    files: File[];
    directories: FileSystemDirectoryHandle[];
}

interface CapturedDropItem {
    handlePromise: Promise<FileSystemHandle | null> | null;
    legacyEntry: FileSystemEntry | null;
    file: File | null;
}

@Injectable()
export class ExternalDropService {
    public containsFiles(dataTransfer: DataTransfer | null): boolean {
        if (!dataTransfer) { return false; }

        return Array.from(dataTransfer.types).includes('Files') ||
            Array.from(dataTransfer.items).some((item) => item.kind === 'file');
    }

    public async read(dataTransfer: DataTransfer): Promise<ExternalDropSelection> {
        // Capture every browser-owned entry synchronously during the drop event.
        // Chromium requires getAsFileSystemHandle() to be invoked while the event's
        // protected data store is still readable.
        const fallbackFiles = Array.from(dataTransfer.files);
        const captured = Array.from(dataTransfer.items)
            .filter((item) => item.kind === 'file')
            .map((item) => captureItem(item));

        const handles = (await Promise.all(captured.map((item) => resolveHandle(item))))
            .filter((handle): handle is FileSystemHandleUnion => handle !== null);
        if (handles.length === 0) {
            handles.push(...fallbackFiles.map(fileHandle));
        }

        const files: File[] = [];
        const directories: FileSystemDirectoryHandle[] = [];
        for (const handle of handles) {
            if (!handle) { continue; }
            if (handle.kind === 'directory') {
                directories.push(handle);
            } else {
                files.push(await handle.getFile());
            }
        }

        return { files, directories };
    }
}

function captureItem(item: DataTransferItem): CapturedDropItem {
    let handlePromise: Promise<FileSystemHandle | null> | null = null;
    try {
        if (typeof item.getAsFileSystemHandle === 'function') {
            handlePromise = item.getAsFileSystemHandle().catch(() => null);
        }
    } catch {
        handlePromise = null;
    }

    let legacyEntry: FileSystemEntry | null = null;
    try {
        if (typeof item.webkitGetAsEntry === 'function') {
            legacyEntry = item.webkitGetAsEntry();
        }
    } catch {
        legacyEntry = null;
    }

    return {
        handlePromise,
        legacyEntry,
        file: item.getAsFile()
    };
}

async function resolveHandle(item: CapturedDropItem): Promise<FileSystemHandleUnion | null> {
    const modernHandle = await item.handlePromise;
    if (modernHandle) { return modernHandle as FileSystemHandleUnion; }
    if (item.legacyEntry) { return legacyHandle(item.legacyEntry); }

    return item.file ? fileHandle(item.file) : null;
}

function legacyHandle(entry: FileSystemEntry): FileSystemHandleUnion {
    return entry.isDirectory
        ? legacyDirectoryHandle(entry as FileSystemDirectoryEntry)
        : legacyFileHandle(entry as FileSystemFileEntry);
}

function legacyDirectoryHandle(entry: FileSystemDirectoryEntry): FileSystemDirectoryHandle {
    return {
        kind: 'directory',
        name: entry.name,
        async *values(): AsyncIterableIterator<FileSystemHandleUnion> {
            for (const child of await readLegacyChildren(entry)) {
                yield legacyHandle(child);
            }
        }
    } as FileSystemDirectoryHandle;
}

function legacyFileHandle(entry: FileSystemFileEntry): FileSystemFileHandle {
    return {
        kind: 'file',
        name: entry.name,
        getFile: () => new Promise<File>((resolve, reject) => {
            entry.file(resolve, reject);
        })
    } as FileSystemFileHandle;
}

function fileHandle(file: File): FileSystemFileHandle {
    return {
        kind: 'file',
        name: file.name,
        getFile: async () => file
    } as FileSystemFileHandle;
}

async function readLegacyChildren(
    directory: FileSystemDirectoryEntry
): Promise<FileSystemEntry[]> {
    const reader = directory.createReader();
    const children: FileSystemEntry[] = [];
    // Legacy directory readers return entries in batches (often capped at 100).
    // Reading once silently truncates larger dropped folders.
    while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
            reader.readEntries(resolve, reject);
        });
        if (batch.length === 0) { return children; }
        children.push(...batch);
    }
}
