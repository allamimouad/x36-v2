import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'app-nav-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, TooltipModule],
  template: `
    <div class="fm-toolbar">
      <div class="fm-toolbar-left">
        <button
          pButton
          type="button"
          icon="pi pi-arrow-left"
          [disabled]="!canGoBack()"
          (click)="back.emit()"
          pTooltip="Back (Alt+Left)"
          tooltipPosition="bottom"
          [text]="true"
          severity="secondary"
          data-testid="fm-btn-back"
          aria-label="Back"
        ></button>
        <button
          pButton
          type="button"
          icon="pi pi-arrow-right"
          [disabled]="!canGoForward()"
          (click)="forward.emit()"
          pTooltip="Forward (Alt+Right)"
          tooltipPosition="bottom"
          [text]="true"
          severity="secondary"
          data-testid="fm-btn-forward"
          aria-label="Forward"
        ></button>
        <button
          pButton
          type="button"
          icon="pi pi-arrow-up"
          [disabled]="!canGoUp()"
          (click)="up.emit()"
          pTooltip="Parent folder (Alt+Up)"
          tooltipPosition="bottom"
          [text]="true"
          severity="secondary"
          data-testid="fm-btn-up"
          aria-label="Parent folder"
        ></button>
        <span class="fm-divider"></span>
        <button
          pButton
          type="button"
          icon="pi pi-refresh"
          (click)="refresh.emit()"
          pTooltip="Refresh (F5)"
          tooltipPosition="bottom"
          [text]="true"
          severity="secondary"
          data-testid="fm-btn-refresh"
          aria-label="Refresh"
        ></button>
      </div>

      <div class="fm-toolbar-right">
        <button
          pButton
          type="button"
          icon="pi pi-folder-plus"
          label="New folder"
          [disabled]="true"
          pTooltip="Coming in Phase 2"
          tooltipPosition="bottom"
          severity="secondary"
          [outlined]="true"
          data-testid="fm-btn-new-folder"
        ></button>
        <button
          pButton
          type="button"
          icon="pi pi-upload"
          label="Upload"
          [disabled]="true"
          pTooltip="Coming in Phase 5"
          tooltipPosition="bottom"
          severity="secondary"
          [outlined]="true"
          data-testid="fm-btn-upload"
        ></button>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        border-bottom: 1px solid var(--p-content-border-color, #e5e7eb);
        background: var(--p-content-background, #fff);
      }
      .fm-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem 0.75rem;
        gap: 0.5rem;
      }
      .fm-toolbar-left,
      .fm-toolbar-right {
        display: flex;
        align-items: center;
        gap: 0.25rem;
      }
      .fm-divider {
        width: 1px;
        height: 1.25rem;
        background: var(--p-content-border-color, #e5e7eb);
        margin: 0 0.25rem;
      }
    `,
  ],
})
export class NavToolbarComponent {
  readonly canGoBack = input<boolean>(false);
  readonly canGoForward = input<boolean>(false);
  readonly canGoUp = input<boolean>(false);

  readonly back = output<void>();
  readonly forward = output<void>();
  readonly up = output<void>();
  readonly refresh = output<void>();
}
