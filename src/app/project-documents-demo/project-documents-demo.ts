import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DialogService } from 'primeng/dynamicdialog';
import { PopupService } from 'ibportal-web-ui-commons';
import { ProjectDocuments } from '../project-documents/project-documents';

@Component({
    selector: 'pr-project-documents-demo',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ProjectDocuments],
    providers: [DialogService, PopupService],
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
export class ProjectDocumentsDemo {
    protected readonly projectId = 'demo-project';
    protected readonly projectLabel = 'Demo Project';
}
