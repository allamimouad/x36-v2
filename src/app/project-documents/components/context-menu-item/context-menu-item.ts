import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { MenuItem } from 'primeng/api';

@Component({
    selector: 'pr-context-menu-item',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './context-menu-item.html',
    styleUrl: './context-menu-item.scss'
})
export class ContextMenuItem {
    public readonly item = input.required<MenuItem>();
}
