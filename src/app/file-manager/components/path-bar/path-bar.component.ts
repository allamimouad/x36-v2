import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { PathSegment } from '../../stores/navigation.store';

@Component({
  selector: 'app-path-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './path-bar.component.html',
  styleUrl: './path-bar.component.scss',
})
export class PathBarComponent {
  readonly segments = input.required<PathSegment[]>();
  readonly rootLabel = input<string>('Documents');

  readonly segmentClicked = output<string>();
}
