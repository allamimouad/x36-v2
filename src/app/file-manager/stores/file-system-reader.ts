import type { Signal } from '@angular/core';
import type { DocumentListKey } from '../models/document-list.model';
import type { FileSystemNode } from '../models/file-system-node.model';

/**
 * Read-and-load surface exposed to consumers (e.g. `NavigationStore`) that need
 * to observe file-system state and trigger loads, but must NOT mutate it.
 *
 * `FileSystemStore` is the only implementation; the binding is wired via
 * `{ provide: FileSystemReader, useExisting: FileSystemStore }` on the container.
 * Mutation methods (`createFolder`, `rename`, `move`, `copy`, `delete`, `upload`)
 * are intentionally absent so they remain type-level forbidden here.
 */
export abstract class FileSystemReader {
    public abstract readonly entityMap: Signal<Record<string, FileSystemNode>>;
    public abstract readonly entities: Signal<FileSystemNode[]>;
    public abstract readonly folderIdsWithLoadedChildren: Signal<string[]>;
    public abstract readonly folderIdsWithLoadingChildren: Signal<string[]>;
    /** The root folder id of each document list (for mapping a root back to its list key). */
    public abstract readonly rootIdByList: Signal<Record<DocumentListKey, string | null>>;

    /** Fetch (or refetch) the children of `parentId` and cache them. */
    public abstract loadChildren(parentId: string): Promise<void>;

    /** Drop the cached "loaded" flag for `parentId` so the next load refetches. */
    public abstract invalidate(parentId: string): void;
}
