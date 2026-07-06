import { Routes } from '@angular/router';

export const routes: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./project-documents-demo/project-documents-demo').then(
                (m) => m.ProjectDocumentsDemo
            )
    }
];
