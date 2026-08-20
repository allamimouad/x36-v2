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
    listKey: 'EXECUTION',
    id: 'root',
    path: '/execution',
    name: '',
    parentId: null,
    itemCount: 0,
    createdAt: '2026-08-17T10:00:00Z',
    modifiedAt: '2026-08-17T10:00:00Z'
};
