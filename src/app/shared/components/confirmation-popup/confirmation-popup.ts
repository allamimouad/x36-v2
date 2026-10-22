import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { type DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

export const DEFAULT_CONFIRMATION_POPUP_DIALOG_CONFIG = {
    header: 'Confirmation',
    modal: true,
    draggable: false,
    resizable: false,
    closable: true,
    closeOnEscape: true,
    style: { maxWidth: '90vw' }
} satisfies DynamicDialogConfig;

@Component({
    selector: 'pr-confirmation-popup',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ButtonModule],
    templateUrl: './confirmation-popup.html',
    styles: ['.popup-actions { display: flex; justify-content: flex-end; gap: .5rem; }']
})
export class ConfirmationPopup {
    public readonly confirmButtonText = input('Confirm');
    public readonly declineButtonText = input('Cancel');
    public readonly message = input('');
    public readonly onAccept = input<() => void>();
    protected readonly ref = inject(DynamicDialogRef);

    protected accept(): void {
        this.ref.close();
        this.onAccept()?.();
    }
}
