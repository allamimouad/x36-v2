import { Routes } from '@angular/router';

export const routes: Routes = [
    {
        path: '',
        loadChildren: () =>
            import('./project-documents-demo/demo.routes').then((m) => m.demoRoutes)
    }
];
