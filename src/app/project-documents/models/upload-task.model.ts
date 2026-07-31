import type { FileSystemErrorCode } from './file-system-error.model';

export type UploadTaskStatus =
  | 'queued'
  | 'uploading'
  | 'finalizing'
  | 'done'
  | 'error'
  | 'cancelled';

export interface UploadTask {
    id: string;
    batchId?: string;
    file: File;
    parentId: string;
    relativePath: string;
    status: UploadTaskStatus;
    progress: number;
    error?: string;
    errorCode?: FileSystemErrorCode;
}

export type UploadBatchStatus =
  | 'queued'
  | 'preparing'
  | 'uploading'
  | 'done'
  | 'error'
  | 'cancelled';

export interface UploadBatch {
    id: string;
    rootName: string;
    targetParentId: string;
    status: UploadBatchStatus;
    directoryCount: number;
    createdDirectoryCount: number;
    fileCount: number;
    error?: string;
}
