import { HttpErrorResponse } from '@angular/common/http';
import { FileSystemError } from '../../models/file-system-error.model';
import { mapSharePointError } from './sharepoint-error.mapper';

describe('mapSharePointError', () => {
    it('preserves an existing file-system error', () => {
        const original = new FileSystemError('cancelled', 'Cancelled');

        expect(mapSharePointError('upload', original)).toBe(original);
    });

    it('maps operation-specific not-found responses', () => {
        expect(mapSharePointError('copy', response(404))).toEqual(
            jasmine.objectContaining<Partial<FileSystemError>>({ code: 'not-found' })
        );
        expect(mapSharePointError('upload', response(404))).toEqual(
            jasmine.objectContaining<Partial<FileSystemError>>({ code: 'not-found' })
        );
        expect(mapSharePointError('resolve-path', response(404))).toEqual(
            jasmine.objectContaining<Partial<FileSystemError>>({ code: 'not-found' })
        );
    });

    it('does not treat an invalid path request as a missing folder', () => {
        expect(mapSharePointError('resolve-path', response(400))).toEqual(
            jasmine.objectContaining<Partial<FileSystemError>>({ code: 'invalid-name' })
        );
    });

    it('maps a locked rename response', () => {
        expect(mapSharePointError('rename', response(423))).toEqual(
            jasmine.objectContaining<Partial<FileSystemError>>({ code: 'locked' })
        );
    });

    it('maps an oversized upload response', () => {
        expect(mapSharePointError('upload', response(413))).toEqual(
            jasmine.objectContaining<Partial<FileSystemError>>({ code: 'too-large' })
        );
    });

    it('maps transport and server failures to network', () => {
        expect(mapSharePointError('copy', response(0))).toEqual(
            jasmine.objectContaining<Partial<FileSystemError>>({ code: 'network' })
        );
        expect(mapSharePointError('copy', response(503))).toEqual(
            jasmine.objectContaining<Partial<FileSystemError>>({ code: 'network' })
        );
    });
});

function response(status: number): HttpErrorResponse {
    return new HttpErrorResponse({ status, statusText: 'Backend error' });
}
