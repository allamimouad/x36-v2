import { Routes } from '@angular/router';

export const routes: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./file-manager-demo/file-manager-demo.component').then(
                (m) => m.FileManagerDemoComponent
            )
    }
];
