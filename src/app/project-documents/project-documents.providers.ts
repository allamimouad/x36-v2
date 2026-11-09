import { type EnvironmentProviders, makeEnvironmentProviders, type Type } from '@angular/core';
import { FileSystemApi } from './services/file-system/file-system-api';

export interface ProjectDocumentsOptions {
    /** The adapter this feature reads and writes documents through. */
    api: Type<FileSystemApi>;
}

/**
 * Wires this feature into a host application.
 *
 * The adapter is the one thing the feature cannot decide for itself: which backend it
 * talks to belongs to whoever mounts it. Everything else it needs is either provided by
 * the component itself, because it is per-instance state, or has a root default.
 *
 * `EnvironmentProviders` deliberately restricts this to an environment injector — a
 * route or the application config — so the choice cannot be buried in a component,
 * where it would shadow the host and could not be substituted in a test.
 */
export function provideProjectDocuments(
    options: ProjectDocumentsOptions
): EnvironmentProviders {
    return makeEnvironmentProviders([
        { provide: FileSystemApi, useClass: options.api }
    ]);
}
