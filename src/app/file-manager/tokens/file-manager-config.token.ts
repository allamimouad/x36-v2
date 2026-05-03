import { InjectionToken } from '@angular/core';

export interface FileManagerConfig {
  libraryRootName: string;
  maxUploadSizeBytes: number;
  chunkSizeBytes: number;
  uploadConcurrency: number;
  bulkOpConcurrency: number;
}

export const DEFAULT_FILE_MANAGER_CONFIG: FileManagerConfig = {
  libraryRootName: 'Documents',
  maxUploadSizeBytes: 2 * 1024 * 1024 * 1024,
  chunkSizeBytes: 5 * 1024 * 1024,
  uploadConcurrency: 4,
  bulkOpConcurrency: 4,
};

export const FILE_MANAGER_CONFIG = new InjectionToken<FileManagerConfig>('FILE_MANAGER_CONFIG', {
  providedIn: 'root',
  factory: () => DEFAULT_FILE_MANAGER_CONFIG,
});
