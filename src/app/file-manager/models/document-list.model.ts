import type { FolderNode } from './file-system-node.model';

/**
 * The two fixed project document lists. Domain concept (not SharePoint-specific):
 * each maps, in the backend, to one of the project's SharePoint document libraries.
 * Used only to select and label the two roots — nodes themselves stay generic.
 */
export type DocumentListKey = 'execution' | 'marketing';

export const DOCUMENT_LIST_KEYS: readonly DocumentListKey[] = ['execution', 'marketing'];

export const DOCUMENT_LIST_LABELS: Record<DocumentListKey, string> = {
    execution: 'Execution Documents',
    marketing: 'Marketing Documents'
};

/** The root folder of each document list, returned by `FileSystemStore.initialize`. */
export type DocumentListRoots = Record<DocumentListKey, FolderNode>;
