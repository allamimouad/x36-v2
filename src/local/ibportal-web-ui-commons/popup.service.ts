import { ApplicationRef, DestroyRef, inject, Injectable, type Type } from '@angular/core';
import {
    DialogService,
    type DynamicDialogConfig,
    type DynamicDialogRef
} from 'primeng/dynamicdialog';
import { take } from 'rxjs';
import { ErrorPopup } from './error-popup';

export interface ErrorPopupOptions {
    title: string;
    message: string;
    escapeMessage?: boolean;
    traceId?: string;
    isClosable?: boolean;
}

@Injectable({ providedIn: 'root' })
export class PopupService {
    private readonly dialogs = inject(DialogService);
    private readonly references = new Set<Pick<DynamicDialogRef<unknown>, 'destroy'>>();

    constructor() {
        const dispose = (): void => {
            for (const ref of this.references) { ref.destroy(); }
            this.references.clear();
        };
        const unregister = inject(ApplicationRef).onDestroy(dispose);
        inject(DestroyRef).onDestroy(() => {
            unregister();
            dispose();
        });
    }

    public showPopup<T>(
        component: Type<T>,
        config: DynamicDialogConfig<unknown, Record<string, unknown>>,
        inputs: Record<string, unknown> = {}
    ): DynamicDialogRef<T> | null {
        const ref = this.dialogs.open(component, { ...config, inputValues: inputs });
        if (ref) {
            this.references.add(ref);
            ref.onDestroy.pipe(take(1)).subscribe(() => { this.references.delete(ref); });
        }

        return ref;
    }

    public showErrorPopupWithReportAction(options: ErrorPopupOptions):
        DynamicDialogRef<ErrorPopup> | null {
        return this.showPopup(ErrorPopup, {
            header: options.title,
            width: '28rem',
            style: { maxWidth: '90vw' },
            modal: true,
            draggable: false,
            resizable: false,
            closable: options.isClosable ?? true,
            closeOnEscape: options.isClosable ?? true
        }, {
            message: options.message,
            escapeMessage: options.escapeMessage ?? true,
            traceId: options.traceId,
            isClosable: options.isClosable ?? true
        });
    }
}
