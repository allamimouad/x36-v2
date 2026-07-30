import {
    HttpEventType,
    provideHttpClient,
    withInterceptorsFromDi
} from '@angular/common/http';
import {
    HttpTestingController,
    provideHttpClientTesting
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FileSystemError } from '../models/file-system-error.model';
import type {
    FileNode,
    FileSystemNode,
    FolderNode
} from '../models/file-system-node.model';
import { SharePointFileSystemApi } from './sharepoint-file-system-api';

describe('SharePointFileSystemApi', () => {
    const parent: FolderNode = {
        kind: 'folder',
        listKey: 'execution',
        id: 'parent-id',
        path: '/sites/project/Documents',
        name: 'Documents',
        parentId: null,
        itemCount: 0,
        createdAt: '2026-07-30T10:00:00Z',
        modifiedAt: '2026-07-30T10:00:00Z'
    };
    const uploaded: FileNode = {
        kind: 'file',
        listKey: 'execution',
        id: 'file-id',
        path: '/sites/project/Documents/report.pdf',
        name: 'report.pdf',
        parentId: parent.id,
        sizeBytes: 4,
        createdAt: '2026-07-30T10:01:00Z',
        modifiedAt: '2026-07-30T10:01:00Z'
    };
    const target: FolderNode = {
        kind: 'folder',
        listKey: 'execution',
        id: 'target-id',
        path: '/sites/project/Documents/Target',
        name: 'Target',
        parentId: parent.id,
        itemCount: 0,
        createdAt: '2026-07-30T10:00:00Z',
        modifiedAt: '2026-07-30T10:00:00Z'
    };
    const crossListTarget: FolderNode = {
        ...target,
        listKey: 'marketing',
        id: 'marketing-target-id',
        path: '/sites/project/Marketing/Target',
        parentId: 'marketing-root-id'
    };

    let api: SharePointFileSystemApi;
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withInterceptorsFromDi()),
                provideHttpClientTesting(),
                SharePointFileSystemApi
            ]
        });
        api = TestBed.inject(SharePointFileSystemApi);
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        http.verify({ ignoreCancelled: true });
    });

    it('sends the complete copy contract and emits the canonical copied node', () => {
        const copied: FileNode = {
            ...uploaded,
            listKey: target.listKey,
            id: 'copied-id',
            path: `${target.path}/${uploaded.name}`,
            parentId: target.id
        };
        let result: FileSystemNode | undefined;

        api.copy('project 1', uploaded, target).subscribe((node) => {
            result = node;
        });

        const request = http.expectOne('/projects/project%201/documents/copy');
        expect(request.request.method).toBe('POST');
        expect(request.request.body).toEqual({
            kind: 'file',
            sourceParentPath: parent.path,
            sourceName: uploaded.name,
            targetListKey: target.listKey,
            targetParentId: target.id,
            targetParentPath: target.path
        });
        request.flush(copied);

        expect(result).toEqual(copied);
    });

    it('rejects a cross-list copy before sending an HTTP request', () => {
        let receivedError: unknown;

        api.copy('project', uploaded, crossListTarget).subscribe({
            error: (error: unknown) => {
                receivedError = error;
            }
        });

        expect(receivedError).toEqual(
            jasmine.objectContaining<FileSystemError>({ code: 'cross-list-copy' })
        );
        http.expectNone('/projects/project/documents/copy');
    });

    it('maps a missing copy source or destination to not-found', () => {
        let receivedError: unknown;

        api.copy('project', uploaded, target).subscribe({
            error: (error: unknown) => {
                receivedError = error;
            }
        });

        const request = http.expectOne('/projects/project/documents/copy');
        request.flush(
            { message: 'Not found' },
            { status: 404, statusText: 'Not Found' }
        );

        expect(receivedError).toEqual(
            jasmine.objectContaining<Partial<FileSystemError>>({
                code: 'not-found'
            })
        );
    });

    it('reports progress and emits the created file', () => {
        const file = new File(['data'], 'report.pdf', {
            type: 'application/pdf'
        });
        const progress: number[] = [];
        let result: FileNode | undefined;

        api.upload('project 1', parent, file, (percent) => progress.push(percent))
            .subscribe((created) => {
                result = created;
            });

        const request = http.expectOne((candidate) =>
            candidate.url ===
                '/projects/project%201/document-lists/execution/documents/parent-id/files'
        );
        expect(request.request.method).toBe('POST');
        expect(request.request.body).toBe(file);
        expect(request.request.params.get('name')).toBe('report.pdf');
        expect(request.request.headers.get('Content-Type')).toBe(
            'application/octet-stream'
        );
        expect(request.request.reportProgress).toBeTrue();

        request.event({
            type: HttpEventType.UploadProgress,
            loaded: 2,
            total: 4
        });
        request.flush(uploaded);

        expect(progress).toEqual([50, 100]);
        expect(result).toEqual(uploaded);
    });

    it('sends an empty File as the raw request body', () => {
        const file = new File([], 'empty.txt');

        api.upload('project', parent, file, () => undefined).subscribe();

        const request = http.expectOne((candidate) =>
            candidate.params.get('name') === 'empty.txt'
        );
        expect(request.request.body).toBe(file);
        expect(file.size).toBe(0);
        request.flush({ ...uploaded, name: 'empty.txt', sizeBytes: 0 });
    });

    it('aborts the HTTP request when the signal is aborted', () => {
        const controller = new AbortController();
        let receivedError: unknown;

        api.upload(
            'project',
            parent,
            new File(['data'], 'report.pdf'),
            () => undefined,
            controller.signal
        ).subscribe({
            error: (error: unknown) => {
                receivedError = error;
            }
        });

        const request = http.expectOne((candidate) =>
            candidate.params.get('name') === 'report.pdf'
        );
        controller.abort();

        expect(request.cancelled).toBeTrue();
        expect(receivedError).toEqual(
            jasmine.objectContaining<Partial<FileSystemError>>({
                code: 'cancelled'
            })
        );
    });

    it('maps a duplicate-file response to name-collision', () => {
        let receivedError: unknown;

        api.upload(
            'project',
            parent,
            new File(['data'], 'report.pdf'),
            () => undefined
        ).subscribe({
            error: (error: unknown) => {
                receivedError = error;
            }
        });

        const request = http.expectOne((candidate) =>
            candidate.params.get('name') === 'report.pdf'
        );
        request.flush(
            { message: 'Already exists' },
            { status: 409, statusText: 'Conflict' }
        );

        expect(receivedError).toEqual(
            jasmine.objectContaining<Partial<FileSystemError>>({
                code: 'name-collision'
            })
        );
    });
});
