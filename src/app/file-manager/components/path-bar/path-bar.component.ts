import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { PathSegment } from '../../stores/navigation.store';

@Component({
  selector: 'app-path-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="fm-breadcrumb" aria-label="Folder path">
      @for (seg of segments(); track seg.id; let last = $last; let idx = $index) {
        <button
          type="button"
          class="fm-segment"
          [class.fm-current]="last"
          [attr.data-testid]="'fm-breadcrumb-' + idx"
          (click)="segmentClicked.emit(seg.id)"
        >
          {{ seg.name || rootLabel() }}
        </button>
        @if (!last) {
          <i class="pi pi-angle-right fm-sep" aria-hidden="true"></i>
        }
      }
    </nav>
  `,
  styles: [
    `
      :host {
        display: block;
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid var(--p-content-border-color, #e5e7eb);
      }
      .fm-breadcrumb {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        flex-wrap: wrap;
      }
      .fm-segment {
        background: transparent;
        border: 0;
        padding: 0.25rem 0.5rem;
        cursor: pointer;
        color: var(--p-primary-color, #3b82f6);
        font: inherit;
        border-radius: 4px;
      }
      .fm-segment:hover {
        background: var(--p-content-hover-background, rgba(0, 0, 0, 0.04));
      }
      .fm-current {
        color: var(--p-text-color, #111);
        font-weight: 500;
        cursor: default;
      }
      .fm-sep {
        color: var(--p-text-muted-color, #888);
        font-size: 0.75rem;
      }
    `,
  ],
})
export class PathBarComponent {
  readonly segments = input.required<PathSegment[]>();
  readonly rootLabel = input<string>('Documents');

  readonly segmentClicked = output<string>();
}
