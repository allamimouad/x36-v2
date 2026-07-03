import { InjectionToken } from '@angular/core';

export interface MockConfig {
    errorRate: number;
    minLatencyMs: number;
    maxLatencyMs: number;
    enableErrors: boolean;
    unavailableFolderPaths?: readonly string[];
}

export const DEFAULT_MOCK_CONFIG: MockConfig = {
    errorRate: 0.05,
    minLatencyMs: 150,
    maxLatencyMs: 400,
    enableErrors: true,
    unavailableFolderPaths: ['execution/Unavailable on open']
};

export const MOCK_CONFIG = new InjectionToken<MockConfig>('MOCK_CONFIG', {
    providedIn: 'root',
    factory: (): MockConfig => DEFAULT_MOCK_CONFIG
});
