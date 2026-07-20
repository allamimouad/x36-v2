import { FormControl } from '@angular/forms';
import { fileSystemNameValidator, localNameError } from './name-dialog.utils';

describe('name dialog validation', () => {
    it('accepts a valid file-system name', () => {
        const control = new FormControl('Contracts', {
            nonNullable: true,
            validators: [fileSystemNameValidator]
        });

        expect(control.valid).toBe(true);
        expect(localNameError(control)).toBeNull();
    });

    it('does not expose a validation message until the field is touched', () => {
        const control = new FormControl('', {
            nonNullable: true,
            validators: [fileSystemNameValidator]
        });

        expect(localNameError(control)).toBeNull();
        control.markAsTouched();
        expect(localNameError(control)).toBe('Enter a name.');
    });

    it('maps every invalid-name reason to a user-facing message', () => {
        const cases = [
            ['.', 'That name is reserved.'],
            ['a/b', 'The name cannot contain \\ / : * ? " < > |.'],
            ['x'.repeat(129), 'The name cannot exceed 128 characters.']
        ] as const;

        for (const [value, expected] of cases) {
            const control = new FormControl(value, {
                nonNullable: true,
                validators: [fileSystemNameValidator]
            });
            control.markAsTouched();
            expect(localNameError(control)).toBe(expected);
        }
    });
});
