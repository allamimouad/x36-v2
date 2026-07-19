import { inject, Injectable } from '@angular/core';
import { MessageService, type ToastMessageOptions } from 'primeng/api';
import { FileSystemError } from '../models/file-system-error.model';

export const PROJECT_DOCUMENTS_TOAST_KEY = 'project-documents';

interface NotificationData {
    retry?: () => void;
}

@Injectable()
export class NotificationService {
    private readonly messages = inject(MessageService);

    public success(message: string): void {
        this.add('success', 'Success', message, 4_000);
    }

    public info(message: string): void {
        this.add('info', 'Information', message, 5_000);
    }

    public warning(message: string): void {
        this.add('warn', 'Warning', message, 6_000);
    }

    public error(error: unknown, retry?: () => void): void {
        const retryAction =
            error instanceof FileSystemError && error.code === 'network' ? retry : undefined;
        console.error('[project-documents] error', error);
        this.messages.add({
            key: PROJECT_DOCUMENTS_TOAST_KEY,
            severity: 'error',
            summary: 'Something went wrong',
            detail: this.userMessageFor(error),
            closable: true,
            sticky: retryAction !== undefined,
            life: retryAction ? undefined : 7_000,
            data: retryAction ? { retry: retryAction } satisfies NotificationData : undefined
        });
    }

    public userMessageFor(error: unknown): string {
        if (!(error instanceof FileSystemError)) {
            return 'Something went wrong. Please try again.';
        }

        switch (error.code) {
            case 'not-found':
                return 'Folder is no longer available.';
            case 'name-collision':
                return 'An item with that name already exists.';
            case 'invalid-name':
                return 'That name is not valid.';
            case 'descendant-move':
                return 'A folder cannot be moved into itself or one of its subfolders.';
            case 'permission-denied':
                return 'You do not have permission to perform this action.';
            case 'network':
                return 'Connection problem — try again.';
            case 'cancelled':
                return 'The operation was cancelled.';
            case 'unknown':
                return 'Something went wrong. Please try again.';
        }
    }

    public hasRetry(message: ToastMessageOptions): boolean {
        return typeof this.dataFor(message)?.retry === 'function';
    }

    public runRetry(message: ToastMessageOptions): void {
        const retry = this.dataFor(message)?.retry;
        if (!retry) { return; }
        this.clear();
        retry();
    }

    public clear(): void {
        this.messages.clear(PROJECT_DOCUMENTS_TOAST_KEY);
    }

    private add(
        severity: 'success' | 'info' | 'warn',
        summary: string,
        detail: string,
        life: number
    ): void {
        this.messages.add({
            key: PROJECT_DOCUMENTS_TOAST_KEY,
            severity,
            summary,
            detail,
            life,
            closable: true
        });
    }

    private dataFor(message: ToastMessageOptions): NotificationData | undefined {
        const data: unknown = message.data;
        if (typeof data !== 'object' || data === null) { return undefined; }

        return data as NotificationData;
    }
}
