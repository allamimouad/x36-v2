import type { ParamMap } from '@angular/router';
import {
    DOCUMENT_LIST_KEYS,
    type DocumentListKey,
    type DocumentListRoots,
    type DocumentListRootStatus
} from '../models/document-list.model';
import { FileSystemError } from '../models/file-system-error.model';
import type { FolderNode } from '../models/file-system-node.model';

/** The folder behind a root status, or `null` for any status other than loaded. */
export function rootFromStatus(root: DocumentListRootStatus): FolderNode | null {
    return root.status === 'loaded' ? root.root : null;
}

/**
 * Distinguishes "this project has no documents" from "we could not read them". Only the
 * second invites a retry, so saying the wrong one sends the user down the wrong path.
 */
export function bootstrapFailureMessage(roots: DocumentListRoots): string {
    const allNotFound = DOCUMENT_LIST_KEYS.every((key) => roots[key].status === 'not-found');

    return allNotFound
        ? 'No documents found for this project.'
        : 'Documents could not be loaded. Try refreshing.';
}

export function logRootLoadErrors(roots: DocumentListRoots): void {
    for (const key of DOCUMENT_LIST_KEYS) {
        const root = roots[key];
        if (root.status !== 'error') { continue; }
        console.error(`[project-documents] ${key} documents could not be loaded`, root.error);
    }
}

/**
 * A retry is offered only for a network failure. Re-running a read that failed because
 * the folder is gone or forbidden would fail the same way every time.
 */
export function retryForReadError(error: unknown, retry: () => void): (() => void) | undefined {
    return error instanceof FileSystemError && error.code === 'network' ? retry : undefined;
}

export interface InitialFolderParams {
    listKey: DocumentListKey;
    folderPath: string;
}

/**
 * The deep link a project can be opened with. Both parameters are required: a list
 * without a path, or a path without a list, cannot be resolved to a folder. The list
 * key is matched case-insensitively because the link is hand-written as often as not.
 */
export function parseInitialFolderParams(params: ParamMap): InitialFolderParams | null {
    const listKeyParam = params.get('listKey');
    const folderPath = params.get('folderPath');

    if (!listKeyParam || !folderPath) {
        return null;
    }

    const listKey = DOCUMENT_LIST_KEYS.find(
        (key) => key.toLowerCase() === listKeyParam.toLowerCase()
    );

    return listKey ? { listKey, folderPath } : null;
}
