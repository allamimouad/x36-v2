import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ProjectDocumentsComponent } from '../project-documents/project-documents.component';

@Component({
    selector: 'pr-project-documents-demo',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ProjectDocumentsComponent],
    template: '<pr-project-documents [projectId]="projectId" [projectLabel]="projectLabel" />',
    styles: `
    :host {
      display: block;
      height: 100%;
      box-sizing: border-box;
      padding: 1rem;
    }
  `
})
export class ProjectDocumentsDemoComponent {
    protected readonly projectId = 'demo-project';
    protected readonly projectLabel = 'Demo Project';
}
