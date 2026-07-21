import type { FileSystemError } from './file-system-error.model';
import type { FolderNode } from './file-system-node.model';

/**
 * The two fixed project document lists. Domain concept (not SharePoint-specific):
 * each maps, in the backend, to one of the project's SharePoint document libraries.
 * Every node carries its list key so the backend can resolve the correct site and
 * document library even when the two lists do not share a SharePoint site.
 */
export type DocumentListKey = 'execution' | 'marketing';

export const DOCUMENT_LIST_KEYS: readonly DocumentListKey[] = ['execution', 'marketing'];

export const DOCUMENT_LIST_LABELS: Record<DocumentListKey, string> = {
    execution: 'Execution Documents',
    marketing: 'Marketing Documents'
};

export type DocumentListRootStatus =
    | { status: 'loaded'; root: FolderNode }
    | { status: 'not-found' }
    | { status: 'error'; error: FileSystemError };

/** The root load result of each document list, returned by `FileSystemStore.initialize`. */
export type DocumentListRoots = Record<DocumentListKey, DocumentListRootStatus>;
