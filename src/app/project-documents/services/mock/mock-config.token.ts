import { InjectionToken } from '@angular/core';
import type { DocumentListKey } from '../../models/document-list.model';

export interface MockConfig {
    errorRate: number;
    minLatencyMs: number;
    maxLatencyMs: number;
    enableErrors: boolean;
    unavailableFolderPaths?: readonly string[];
    readonlyListKeys?: readonly DocumentListKey[];
    protectedFolderPaths?: readonly string[];
    readonlyFolderPaths?: readonly string[];
}

export const DEFAULT_MOCK_CONFIG: MockConfig = {
    errorRate: 0.05,
    minLatencyMs: 150,
    maxLatencyMs: 400,
    enableErrors: true,
    unavailableFolderPaths: ['execution/Unavailable on open'],
    protectedFolderPaths: ['execution/Contracts'],
    readonlyFolderPaths: ['marketing/Press']
};

export const MOCK_CONFIG = new InjectionToken<MockConfig>('MOCK_CONFIG', {
    providedIn: 'root',
    factory: (): MockConfig => DEFAULT_MOCK_CONFIG
});
