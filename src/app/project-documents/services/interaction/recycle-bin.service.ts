import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { PopupService, TRACE_ID_HEADER } from 'ibportal-web-ui-commons';
import {
    ConfirmationPopup,
    DEFAULT_CONFIRMATION_POPUP_DIALOG_CONFIG
} from '@shared/components/confirmation-popup/confirmation-popup';
import type { FileSystemNode } from '../../models/file-system-node.model';
import { NotificationService } from './notification.service';
import { FileSystemStore } from '../../stores/file-system.store';

/**
 * Restoring and permanently deleting a recycle-bin record.
 *
 * Both are terminal in a way the rest of the feature is not — a permanent delete cannot
 * be undone, and a restore can fail on a name that has since been taken — so each
 * reports in its own way: the delete asks first, and the restore surfaces the backend's
 * own message rather than a generic one.
 */
@Injectable()
export class RecycleBinService {
    private readonly fileSystem = inject(FileSystemStore);
    private readonly notifications = inject(NotificationService);
    private readonly popupService = inject(PopupService);

    /** Asks for confirmation; the delete itself happens only on acceptance. */
    public requestPermanentDelete(node: FileSystemNode): void {
        this.popupService.showPopup(
            ConfirmationPopup,
            { ...DEFAULT_CONFIRMATION_POPUP_DIALOG_CONFIG, width: '28rem' },
            {
                confirmButtonText: 'Confirm',
                declineButtonText: 'Cancel',
                message: `Are you sure you want to permanently delete "${node.name}" ${node.kind}?`,
                onAccept: () => void this.deletePermanently(node)
            }
        );
    }

    public async restore(node: FileSystemNode): Promise<void> {
        try {
            await this.fileSystem.restoreRecycleBinNodes(node.id);
            this.notifications.success(
                `The ${node.kind} "${node.name}" has been successfully restored.`
            );
        } catch (error) {
            this.reportRestoreFailure(error);
        }
    }

    private async deletePermanently(node: FileSystemNode): Promise<void> {
        try {
            await this.fileSystem.deleteRecycleBinNodes(node.id);
            this.notifications.success(
                `The ${node.kind} "${node.name}" has been successfully deleted.`
            );
        } catch (error) {
            this.notifications.error(error);
        }
    }

    /**
     * A failed restore gets a popup rather than a toast: the backend's reason — most
     * often a name collision at the original location — is what the user has to act on.
     */
    private reportRestoreFailure(error: unknown): void {
        const sharepointError = error instanceof HttpErrorResponse
            ? (error.error as { message: string })
            : undefined;
        this.popupService.showErrorPopupWithReportAction({
            title: 'Cannot restore the item',
            message: sharepointError?.message || 'An error occurred when trying to ' +
                'restore the item. Please refresh and try again.',
            escapeMessage: true,
            traceId:
                error instanceof HttpErrorResponse
                    ? error.headers.get(TRACE_ID_HEADER) ?? undefined
                    : undefined,
            isClosable: true
        });
    }
}
