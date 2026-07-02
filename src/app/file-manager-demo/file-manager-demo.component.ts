import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FileManagerComponent } from '../file-manager/file-manager.component';

@Component({
    selector: 'pr-file-manager-demo',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FileManagerComponent],
    template: '<pr-file-manager [projectId]="projectId" [projectLabel]="projectLabel" />',
    styles: `
    :host {
      display: block;
      height: 100%;
    }
  `
})
export class FileManagerDemoComponent {
    protected readonly projectId = 'demo-project';
    protected readonly projectLabel = 'Demo Project';
}
