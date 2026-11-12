import type { Routes } from '@angular/router';
import { provideProjectDocuments } from '../project-documents/project-documents.providers';
import { MockFileSystemApi } from '../project-documents/services/mock/mock-file-system-api';

/**
 * The development harness, wired the way a host application wires this feature: the
 * route chooses the adapter. Keeping the choice here rather than in `app.routes.ts`
 * leaves the mock in this lazily loaded chunk instead of the initial bundle.
 */
export const demoRoutes: Routes = [
    {
        path: '',
        providers: [provideProjectDocuments({ api: MockFileSystemApi })],
        loadComponent: () =>
            import('./project-documents-demo').then((m) => m.ProjectDocumentsDemo)
    }
];
