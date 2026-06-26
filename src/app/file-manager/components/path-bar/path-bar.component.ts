import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import type { PathSegment } from '../../stores/navigation.store';

/**
 * Dumb address bar. Shows a fixed `/{projectLabel}/` prefix plus either the breadcrumb
 * (normal mode) or an editable path input (edit mode). Edit mode is parent-controlled:
 * this component only emits intent (`editRequested`/`editCancelled`/`pathSubmitted`).
 * No list-key validation here — the container owns that.
 */
@Component({
  selector: 'app-path-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './path-bar.component.html',
  styleUrl: './path-bar.component.scss',
})
export class PathBarComponent {
  readonly segments = input.required<PathSegment[]>();
  readonly projectLabel = input.required<string>();
  readonly editablePath = input<string>('');
  readonly editing = input<boolean>(false);
  readonly resolving = input<boolean>(false);
  readonly pathError = input<string | null>(null);

  readonly editRequested = output<void>();
  readonly editCancelled = output<void>();
  readonly segmentClicked = output<PathSegment>();
  readonly pathSubmitted = output<string>();

  /** Local draft of the editable path, seeded from `editablePath` on entering edit mode. */
  protected readonly draft = signal('');

  protected onEnterEdit(): void {
    this.draft.set(this.editablePath());
    this.editRequested.emit();
  }

  protected onDraftInput(value: string): void {
    this.draft.set(value);
  }

  protected onSubmit(): void {
    if (this.resolving()) return; // guard against duplicate submits while a resolve is in flight
    // Enter on a plain input doesn't blur it, so a successful submit closes edit mode via
    // the parent (which removes the input); any resulting blur → a harmless extra cancel.
    this.pathSubmitted.emit(this.draft());
  }

  protected onCancel(): void {
    this.editCancelled.emit();
  }

  protected onBlur(): void {
    // Ignore the blur that fires when the input is disabled mid-resolve; only a genuine
    // user blur (not resolving) cancels edit mode.
    if (this.resolving()) return;
    this.editCancelled.emit();
  }
}
