import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogService } from 'primeng/dynamicdialog';
import { PopupService } from '../project-documents/tokens/shared-ui';
import { ProjectDocuments } from '../project-documents/project-documents';
import { ProjectOverviewService } from '../../services/project-overview.service';

@Component({
    selector: 'pr-project-documents-demo',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ProjectDocuments],
    providers: [DialogService, PopupService, ProjectOverviewService],
    template: '<pr-project-documents [id]="projectId" />',
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

    constructor() {
        inject(ProjectOverviewService).projectDTO.set({
            id: 1,
            name: 'Demo Project',
            projectType: null,
            projectPhase: null,
            initialProjectPhase: null
        });
    }
}
