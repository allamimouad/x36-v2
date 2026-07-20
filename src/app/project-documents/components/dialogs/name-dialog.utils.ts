import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { validateName } from '../../utils/naming.utils';

export const fileSystemNameValidator: ValidatorFn = (
    control: AbstractControl<string>
): ValidationErrors | null => {
    const result = validateName(control.value ?? '');

    return result.valid ? null : { fileSystemName: result.reason };
};

export function localNameError(control: AbstractControl<string>): string | null {
    if (!control.touched || !control.errors) { return null; }
    const reason: unknown = control.errors['fileSystemName'];
    switch (reason) {
        case 'empty':
            return 'Enter a name.';
        case 'reserved':
            return 'That name is reserved.';
        case 'invalid-chars':
            return 'The name cannot contain \\ / : * ? " < > |.';
        case 'too-long':
            return 'The name cannot exceed 128 characters.';
        default:
            return null;
    }
}
