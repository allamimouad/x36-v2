import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { delay, of } from 'rxjs';
import type { FileSystemNode, FolderNode } from '../../models/file-system-node.model';
import { FileSystemApi } from '../file-system/file-system-api';
import { MOCK_CONFIG } from '../mock/mock-config.token';
import { MockFileSystemApi } from '../mock/mock-file-system-api';
import { DocumentSearchService } from './document-search.service';

describe('DocumentSearchService', () => {
    let api: MockFileSystemApi;
    let service: DocumentSearchService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                DocumentSearchService,
                { provide: FileSystemApi, useClass: MockFileSystemApi },
                {
                    provide: MOCK_CONFIG,
                    useValue: {
                        errorRate: 0,
                        minLatencyMs: 0,
                        maxLatencyMs: 0,
                        enableErrors: false
                    }
                }
            ]
        });
        api = TestBed.inject(FileSystemApi) as MockFileSystemApi;
        service = TestBed.inject(DocumentSearchService);
    });

    it('keeps only the latest submitted search response', fakeAsync(() => {
        spyOn(api, 'searchDocuments').and.callFake((_projectId, _scope, query) =>
            of(response(query)).pipe(delay(query === 'first' ? 50 : 0))
        );

        service.search('project', scope, 'first');
        service.search('project', scope, 'second');
        tick();

        expect(service.results()[0]?.name).toBe('second.pdf');
        expect(service.isSearching()).toBeFalse();

        tick(50);
        expect(service.results()[0]?.name).toBe('second.pdf');
    }));

    it('drops results whose ids were removed and leaves the rest', fakeAsync(() => {
        spyOn(api, 'searchDocuments').and.returnValue(of([
            ...response('kept'), ...response('gone')
        ]));
        service.search('project', scope, 'anything');
        tick();
        expect(service.results().length).toBe(2);

        service.pruneReferences(['gone']);

        expect(service.results().map(({ id }) => id)).toEqual(['kept']);
        // Nothing matching: the list must be left exactly as it was.
        service.pruneReferences(['not-a-result']);
        expect(service.results().map(({ id }) => id)).toEqual(['kept']);
    }));

    it('re-runs the last search without emptying the list first', fakeAsync(() => {
        const search = spyOn(api, 'searchDocuments').and.returnValue(
            of(response('first')).pipe(delay(5))
        );
        service.search('project', scope, 'term');
        tick(5);
        expect(service.results().length).toBe(1);

        search.and.returnValue(of(response('second')).pipe(delay(5)));
        service.refresh();

        // Still showing the old rows: clearing them would trade one stale row for an
        // empty table for as long as the query takes.
        expect(service.results()[0]?.id).toBe('first');
        tick(5);
        expect(service.results()[0]?.id).toBe('second');
        expect(search).toHaveBeenCalledTimes(2);
        expect(search.calls.mostRecent().args).toEqual(['project', scope, 'term']);
    }));

    it('does nothing on refresh when no search was submitted', () => {
        const search = spyOn(api, 'searchDocuments');

        service.refresh();

        expect(search).not.toHaveBeenCalled();
    });

});


function response(query: string): FileSystemNode[] {
    return [{
        kind: 'file',
        listKey: 'EXECUTION',
        id: query,
        name: `${query}.pdf`,
        path: `/execution/${query}.pdf`,
        parentId: 'root',
        createdAt: '2026-08-17T09:00:00Z',
        modifiedAt: '2026-08-17T10:00:00Z',
        sizeBytes: 10
    }];
}

const scope: FolderNode = {
    kind: 'folder',
    isRecycleBin: false,
    listKey: 'EXECUTION',
    id: 'root',
    path: '/execution',
    name: '',
    parentId: null,
    itemCount: 0,
    createdAt: '2026-08-17T10:00:00Z',
    modifiedAt: '2026-08-17T10:00:00Z'
};
