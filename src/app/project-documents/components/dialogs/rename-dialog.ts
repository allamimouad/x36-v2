import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    input,
    model,
    output,
    viewChild
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import type { FileNode } from '../../models/file-system-node.model';
import { fileSystemNameValidator, localNameError } from './name-dialog.utils';

export interface RenameRequest {
    node: FileNode;
    name: string;
}

@Component({
    selector: 'pr-rename-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ReactiveFormsModule, ButtonModule, Dialog, InputText],
    templateUrl: './rename-dialog.html',
    styleUrl: './action-dialog.scss'
})
export class RenameDialog {
    public readonly visible = model(false);
    public readonly node = input<FileNode | null>(null);
    public readonly submitting = input(false);
    public readonly serverError = input<string | null>(null);

    public readonly renameRequested = output<RenameRequest>();
    public readonly nameEdited = output();

    protected readonly form = new FormGroup({
        name: new FormControl('', {
            nonNullable: true,
            validators: [fileSystemNameValidator]
        })
    });
    private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

    protected onShow(): void {
        this.form.reset({ name: this.node()?.name ?? '' });
        this.nameInput()?.nativeElement.focus();
        this.nameInput()?.nativeElement.select();
    }

    protected onVisibleChange(visible: boolean): void {
        if (!this.submitting()) { this.visible.set(visible); }
    }

    protected onNameInput(): void {
        this.nameEdited.emit();
    }

    protected validationError(): string | null {
        return localNameError(this.form.controls.name) ?? this.serverError();
    }

    protected cancel(): void {
        if (!this.submitting()) { this.visible.set(false); }
    }

    protected submit(): void {
        const node = this.node();
        this.form.controls.name.markAsTouched();
        if (!node || this.form.invalid || this.submitting()) { return; }
        this.renameRequested.emit({ node, name: this.form.controls.name.value.trim() });
    }
}
