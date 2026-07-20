import { ChangeDetectionStrategy, Component, input, model, output, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { Checkbox } from 'primeng/checkbox';
import { Dialog } from 'primeng/dialog';
import { FormsModule } from '@angular/forms';

export type ConflictResolution = 'replace' | 'keep-both' | 'skip' | 'cancel';

export interface ConflictResolutionChoice {
    resolution: ConflictResolution;
    applyToAll: boolean;
}

@Component({
    selector: 'pr-conflict-resolution-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, ButtonModule, Checkbox, Dialog],
    templateUrl: './conflict-resolution-dialog.html',
    styleUrl: './action-dialog.scss'
})
export class ConflictResolutionDialog {
    public readonly visible = model(false);
    public readonly itemName = input('');
    public readonly showApplyToAll = input(false);
    public readonly submitting = input(false);

    public readonly resolved = output<ConflictResolutionChoice>();

    protected readonly applyToAll = signal(false);

    protected onShow(): void {
        this.applyToAll.set(false);
    }

    protected choose(resolution: ConflictResolution): void {
        if (this.submitting()) { return; }
        this.resolved.emit({ resolution, applyToAll: this.applyToAll() });
        if (resolution === 'cancel') { this.visible.set(false); }
    }
}
