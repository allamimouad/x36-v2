import { InjectionToken } from '@angular/core';

export interface FileManagerConfig {
    libraryRootName: string;
    maxUploadSizeBytes: number;
    uploadConcurrency: number;
    bulkOpConcurrency: number;
}

export const DEFAULT_FILE_MANAGER_CONFIG: FileManagerConfig = {
    libraryRootName: 'Documents',
    maxUploadSizeBytes: 250 * 1024 * 1024,
    uploadConcurrency: 4,
    bulkOpConcurrency: 4
};

export const FILE_MANAGER_CONFIG = new InjectionToken<FileManagerConfig>('FILE_MANAGER_CONFIG', {
    providedIn: 'root',
    factory: (): FileManagerConfig => DEFAULT_FILE_MANAGER_CONFIG
});
