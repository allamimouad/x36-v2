import { TestBed } from '@angular/core/testing';
import { MessageService, type ToastMessageOptions } from 'primeng/api';
import {
    FileSystemError,
    type FileSystemErrorCode
} from '../models/file-system-error.model';
import {
    NotificationService,
    PROJECT_DOCUMENTS_TOAST_KEY
} from './notification.service';

describe('NotificationService', () => {
    let messages: MessageService;
    let notifications: NotificationService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [MessageService, NotificationService]
        });
        messages = TestBed.inject(MessageService);
        notifications = TestBed.inject(NotificationService);
    });

    it('maps file-system error codes without exposing backend messages', () => {
        const expectations: readonly [FileSystemErrorCode, string][] = [
            ['not-found', 'Folder is no longer available.'],
            ['name-collision', 'An item with that name already exists.'],
            ['invalid-name', 'That name is not valid.'],
            [
                'descendant-move',
                'A folder cannot be moved into itself or one of its subfolders.'
            ],
            ['permission-denied', 'You do not have permission to perform this action.'],
            ['network', 'Connection problem — try again.'],
            ['cancelled', 'The operation was cancelled.'],
            ['unknown', 'Something went wrong. Please try again.']
        ];

        for (const [code, expected] of expectations) {
            const error = new FileSystemError(code, 'Sensitive backend details');
            expect(notifications.userMessageFor(error)).toBe(expected);
        }
    });

    it('publishes a keyed sticky error with a retry action', () => {
        const add = spyOn(messages, 'add');
        const log = spyOn(console, 'error');
        const retry = jasmine.createSpy('retry');
        const error = new FileSystemError('network', 'Technical transport details');

        notifications.error(error, retry);

        expect(log).toHaveBeenCalledWith('[project-documents] error', error);
        expect(add).toHaveBeenCalledOnceWith(
            jasmine.objectContaining<ToastMessageOptions>({
                key: PROJECT_DOCUMENTS_TOAST_KEY,
                severity: 'error',
                detail: 'Connection problem — try again.',
                sticky: true,
                data: { retry }
            })
        );
    });

    it('clears the scoped toast before running its retry action', () => {
        const clear = spyOn(messages, 'clear');
        const retry = jasmine.createSpy('retry');
        const message: ToastMessageOptions = { data: { retry } };

        expect(notifications.hasRetry(message)).toBeTrue();
        notifications.runRetry(message);

        expect(clear).toHaveBeenCalledOnceWith(PROJECT_DOCUMENTS_TOAST_KEY);
        expect(retry).toHaveBeenCalledTimes(1);
    });

    it('discards retry actions for errors that are not typed network failures', () => {
        const add = spyOn(messages, 'add');
        spyOn(console, 'error');
        const retry = jasmine.createSpy('retry');

        notifications.error(new FileSystemError('unknown', 'Unexpected failure'), retry);
        notifications.error(new Error('Programming defect'), retry);

        expect(add).toHaveBeenCalledTimes(2);
        for (const [message] of add.calls.allArgs()) {
            expect(message.sticky).toBeFalse();
            expect(message.life).toBe(7_000);
            expect(message.data).toBeUndefined();
            expect(notifications.hasRetry(message)).toBeFalse();
        }
    });

    it('publishes success messages with the feature toast key', () => {
        const add = spyOn(messages, 'add');

        notifications.success('Folder created.');

        expect(add).toHaveBeenCalledOnceWith(
            jasmine.objectContaining<ToastMessageOptions>({
                key: PROJECT_DOCUMENTS_TOAST_KEY,
                severity: 'success',
                summary: 'Success',
                detail: 'Folder created.'
            })
        );
    });
});
