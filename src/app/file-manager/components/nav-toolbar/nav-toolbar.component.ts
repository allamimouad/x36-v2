import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

@Component({
    selector: 'app-nav-toolbar',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ButtonModule, TooltipModule],
    templateUrl: './nav-toolbar.component.html',
    styleUrl: './nav-toolbar.component.scss'
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
