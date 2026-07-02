import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

@Component({
    selector: 'pr-nav-toolbar',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ButtonModule, TooltipModule],
    templateUrl: './nav-toolbar.component.html',
    styleUrl: './nav-toolbar.component.scss'
})
export class NavToolbarComponent {
    public readonly canGoBack = input<boolean>(false);
    public readonly canGoForward = input<boolean>(false);
    public readonly canGoUp = input<boolean>(false);

    public readonly back = output<void>();
    public readonly forward = output<void>();
    public readonly up = output<void>();
    public readonly refresh = output<void>();
}
