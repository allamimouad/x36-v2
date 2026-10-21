import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import type { FileSystemNode } from '../../models/file-system-node.model';

@Component({
    selector: 'pr-recycle-bin-dialogs',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ButtonModule, DialogModule],
    templateUrl: './recycle-bin-dialogs.html'
})
export class RecycleBinDialogs {
    public readonly pendingDelete = input<FileSystemNode | null>(null);
    public readonly restoreError = input<string | null>(null);
    public readonly deleteConfirmed = output<FileSystemNode>();
    public readonly deleteCancelled = output();
    public readonly errorClosed = output();
}
