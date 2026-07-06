import { Routes } from '@angular/router';

export const routes: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./project-documents-demo/project-documents-demo.component').then(
                (m) => m.ProjectDocumentsDemoComponent
            )
    }
];
