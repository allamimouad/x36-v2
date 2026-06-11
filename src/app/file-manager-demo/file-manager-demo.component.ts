import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FileManagerComponent } from '../file-manager/file-manager.component';

@Component({
  selector: 'app-file-manager-demo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FileManagerComponent],
  template: '<app-file-manager [projectId]="projectId" />',
  styles: `
    :host {
      display: block;
      height: 100%;
    }
  `,
})
export class FileManagerDemoComponent {
  protected readonly projectId = 'demo-project';
}
