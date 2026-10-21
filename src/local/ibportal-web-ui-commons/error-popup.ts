import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
    selector: 'pr-error-popup',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ButtonModule],
    templateUrl: './error-popup.html',
    styles: ['.popup-actions { display: flex; justify-content: flex-end; gap: .5rem; }']
})
export class ErrorPopup {
    public readonly message = input('');
    public readonly escapeMessage = input(true);
    public readonly traceId = input<string>();
    public readonly isClosable = input(true);
    protected readonly ref = inject(DynamicDialogRef);
    protected readonly reportCopied = signal(false);
    protected readonly reportCopyFailed = signal(false);

    protected async copyReportDetails(): Promise<void> {
        this.reportCopyFailed.set(false);
        try {
            const details = this.traceId()
                ? `${this.message()}\nTrace ID: ${this.traceId()}` : this.message();
            await navigator.clipboard.writeText(details);
            this.reportCopied.set(true);
        } catch {
            this.reportCopyFailed.set(true);
        }
    }
}
