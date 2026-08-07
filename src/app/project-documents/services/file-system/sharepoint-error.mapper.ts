import { HttpErrorResponse } from '@angular/common/http';
import { FileSystemError } from '../../models/file-system-error.model';

export type SharePointOperation = 'copy' | 'rename' | 'resolve-path' | 'upload';

const OPERATION_LABELS: Record<SharePointOperation, string> = {
    copy: 'Copy',
    rename: 'Rename',
    'resolve-path': 'Folder lookup',
    upload: 'Upload'
};

/** Translate transport-level backend responses into the file-manager error contract. */
export function mapSharePointError(
    operation: SharePointOperation,
    error: unknown
): FileSystemError {
    if (error instanceof FileSystemError) { return error; }

    const label = OPERATION_LABELS[operation];
    if (!(error instanceof HttpErrorResponse)) {
        return new FileSystemError('unknown', `${label} failed`, error);
    }
    if (isNetworkFailure(error.status)) {
        return new FileSystemError('network', `${label} request failed`, error);
    }

    return mapHttpStatus(operation, error);
}

function isNetworkFailure(status: number): boolean {
    return status === 0 || status === 408 || status === 429 || status >= 500;
}

function mapHttpStatus(
    operation: SharePointOperation,
    error: HttpErrorResponse
): FileSystemError {
    switch (error.status) {
        case 400:
            return new FileSystemError(
                'invalid-name',
                `Invalid ${operation} request`,
                error
            );
        case 401:
        case 403:
            return new FileSystemError(
                'permission-denied',
                `${OPERATION_LABELS[operation]} is not permitted`,
                error
            );
        case 404:
            return new FileSystemError('not-found', notFoundMessage(operation), error);
        case 409:
            return new FileSystemError(
                'name-collision',
                collisionMessage(operation),
                error
            );
        case 413:
            return operation === 'upload'
                ? new FileSystemError('too-large', 'File exceeds the upload limit', error)
                : unknownError(operation, error);
        case 423:
            return operation === 'rename'
                ? new FileSystemError('locked', 'Document is locked', error)
                : unknownError(operation, error);
        default:
            return unknownError(operation, error);
    }
}

function notFoundMessage(operation: SharePointOperation): string {
    switch (operation) {
        case 'copy':
            return 'Copy source or destination was not found';
        case 'upload':
            return 'Upload destination was not found';
        case 'rename':
            return 'Document was not found';
        case 'resolve-path':
            return 'Folder path was not found';
        default:
            return 'Document was not found';
    }
}

function collisionMessage(operation: SharePointOperation): string {
    return operation === 'upload'
        ? 'A file with that name already exists'
        : 'An item with that name already exists';
}

function unknownError(
    operation: SharePointOperation,
    error: HttpErrorResponse
): FileSystemError {
    return new FileSystemError(
        'unknown',
        `${OPERATION_LABELS[operation]} failed`,
        error
    );
}
