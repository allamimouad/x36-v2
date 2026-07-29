import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { ProgressBar } from 'primeng/progressbar';
import { TooltipModule } from 'primeng/tooltip';
import type { UploadBatch, UploadTask } from '../../models/upload-task.model';

@Component({
    selector: 'pr-upload-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ButtonModule, ProgressBar, TooltipModule],
    templateUrl: './upload-panel.html',
    styleUrl: './upload-panel.scss'
})
export class UploadPanel {
    public readonly tasks = input.required<readonly UploadTask[]>();
    public readonly batches = input.required<readonly UploadBatch[]>();
    public readonly collapsed = input(false);

    public readonly collapsedChange = output<boolean>();
    public readonly taskCancelled = output<string>();
    public readonly taskRetried = output<string>();
    public readonly batchCancelled = output<string>();
    public readonly completedCleared = output();

    protected readonly visibleBatches = computed(() =>
        this.batches().filter(
            (batch) =>
                batch.status === 'preparing' ||
                batch.error !== undefined ||
                (batch.status === 'done' && batch.fileCount === 0)
        )
    );

    protected readonly summary = computed(() => {
        const tasks = this.tasks();
        const preparing = this.batches().filter((batch) => batch.status === 'preparing').length;
        const active = tasks.filter(
            (task) =>
                task.status === 'queued' ||
                task.status === 'uploading' ||
                task.status === 'finalizing'
        ).length;
        if (preparing > 0) {
            return `${preparing} folder${preparing === 1 ? '' : 's'} preparing`;
        }
        if (active > 0) {
            return `${active} upload${active === 1 ? '' : 's'} active`;
        }

        return 'Uploads';
    });

    protected readonly canClear = computed(
        () =>
            this.tasks().some(
                (task) =>
                    task.status === 'done' ||
                    task.status === 'cancelled' ||
                    task.status === 'error'
            ) ||
            this.batches().some(
                (batch) =>
                    batch.status === 'done' ||
                    batch.status === 'cancelled' ||
                    batch.status === 'error'
            )
    );

    protected toggleCollapsed(): void {
        this.collapsedChange.emit(!this.collapsed());
    }

    protected batchProgress(batch: UploadBatch): number {
        if (batch.directoryCount === 0) { return 0; }

        return Math.round(batch.createdDirectoryCount / batch.directoryCount * 100);
    }

    protected batchStatus(batch: UploadBatch): string {
        switch (batch.status) {
            case 'preparing':
                return batch.directoryCount === 0
                    ? 'Reading folder structure…'
                    : `Creating folders ${batch.createdDirectoryCount}/${batch.directoryCount}`;
            case 'done':
                return 'Folder structure created';
            case 'cancelled':
                return 'Folder preparation cancelled';
            case 'error':
                return 'Folder preparation failed';
            case 'uploading':
                return 'Folder structure created';
        }
    }

    protected taskStatus(task: UploadTask): string {
        switch (task.status) {
            case 'queued':
                return 'Queued';
            case 'uploading':
                return `${task.progress}%`;
            case 'finalizing':
                return 'Finalizing…';
            case 'done':
                return 'Uploaded';
            case 'error':
                return 'Failed';
            case 'cancelled':
                return 'Cancelled';
        }
    }

    protected isTaskActive(task: UploadTask): boolean {
        return task.status === 'queued' ||
            task.status === 'uploading' ||
            task.status === 'finalizing';
    }

    protected canRetry(task: UploadTask): boolean {
        return task.status === 'cancelled' ||
            (task.status === 'error' && task.errorCode === 'network');
    }

    protected statusClass(status: UploadTask['status'] | UploadBatch['status']): string {
        return `pd-upload-${status}`;
    }
}
