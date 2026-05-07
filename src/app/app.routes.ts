import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./file-manager/file-manager.component').then((m) => m.FileManagerComponent),
  },
];
