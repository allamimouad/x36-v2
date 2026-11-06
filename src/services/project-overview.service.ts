import { Injectable, signal } from '@angular/core';

/**
 * The project overview payload. Only `name` is read in this feature; the rest are
 * declared because the real DTO requires them, and typed `unknown` because their types
 * belong to the overview feature and nothing here depends on them.
 *
 * Required-ness is the part that matters. It keeps a bare object literal illegal, so a
 * fixture has to assert its shape — and an assertion compiles against this declaration
 * and against the fuller real one alike.
 */
export interface ProjectDTO {
    id: unknown;
    name: string | null;
    projectType: unknown;
    projectPhase: unknown;
    initialProjectPhase: unknown;
}

@Injectable()
export class ProjectOverviewService {
    public readonly projectDTO = signal<ProjectDTO | null>(null);
}
