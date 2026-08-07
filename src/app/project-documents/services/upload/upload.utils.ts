import {
    FileSystemError,
    type FileSystemErrorCode
} from '../../models/file-system-error.model';
import type { UploadTask } from '../../models/upload-task.model';

const DEFAULT_UPLOAD_ERROR = 'Upload failed. Please try again.';
const UPLOAD_ERROR_MESSAGES: Partial<Record<FileSystemErrorCode, string>> = {
    'name-collision': 'A file with this name already exists.',
    locked: 'The upload destination is currently locked.',
    'not-found': 'The destination folder is no longer available.',
    'permission-denied': 'You do not have permission to upload here.',
    network: 'Connection problem — retry the complete file.',
    cancelled: 'Upload was cancelled.',
    'descendant-move': DEFAULT_UPLOAD_ERROR,
    unknown: DEFAULT_UPLOAD_ERROR
};

export function isActiveTask(task: UploadTask): boolean {
    return task.status === 'queued' ||
        task.status === 'uploading' ||
        task.status === 'finalizing';
}

export function isRetryableTask(task: UploadTask): boolean {
    return task.status === 'cancelled' ||
        task.status === 'error' && task.errorCode === 'network';
}

export function isCancellation(error: unknown): boolean {
    return error instanceof FileSystemError && error.code === 'cancelled';
}

export function uploadErrorCode(error: unknown): FileSystemErrorCode {
    return error instanceof FileSystemError ? error.code : 'unknown';
}

export function uploadErrorMessage(error: unknown): string {
    if (!(error instanceof FileSystemError)) {
        return DEFAULT_UPLOAD_ERROR;
    }
    if (error.code === 'invalid-name' || error.code === 'too-large') {
        return error.message;
    }

    return UPLOAD_ERROR_MESSAGES[error.code] ?? DEFAULT_UPLOAD_ERROR;
}

export function directoryCancellationMessage(preparationStarted: boolean): string {
    return preparationStarted
        ? 'Folder upload was cancelled. Already-created folders were kept.'
        : 'Folder preparation was cancelled.';
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) {
        return `${Math.ceil(bytes / 1024)} KiB`;
    }

    return `${Math.ceil(bytes / (1024 * 1024))} MiB`;
}
