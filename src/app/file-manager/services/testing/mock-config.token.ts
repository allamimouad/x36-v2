import { InjectionToken } from '@angular/core';

export interface MockConfig {
    errorRate: number;
    minLatencyMs: number;
    maxLatencyMs: number;
    enableErrors: boolean;
}

export const DEFAULT_MOCK_CONFIG: MockConfig = {
    errorRate: 0.05,
    minLatencyMs: 150,
    maxLatencyMs: 400,
    enableErrors: true
};

export const MOCK_CONFIG = new InjectionToken<MockConfig>('MOCK_CONFIG', {
    providedIn: 'root',
    factory: () => DEFAULT_MOCK_CONFIG
});
