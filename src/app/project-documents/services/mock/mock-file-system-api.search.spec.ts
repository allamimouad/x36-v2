import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import type { FolderNode } from '../../models/file-system-node.model';
import { MOCK_CONFIG } from './mock-config.token';
import { MockFileSystemApi } from './mock-file-system-api';

describe('MockFileSystemApi search', () => {
    let api: MockFileSystemApi;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                MockFileSystemApi,
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
        api = TestBed.inject(MockFileSystemApi);
    });

    it('searches file and folder names recursively below a list root', async () => {
        const root = await executionRoot();

        const results = await firstValueFrom(
            api.searchDocuments('project-123', root, 'SIGNED')
        );

        expect(results.length).toBeGreaterThan(1);
        expect(results.some((result) => result.kind === 'folder' && result.name === 'Signed'))
            .toBeTrue();
        expect(results.some((result) => result.name === 'globex-msa-signed.pdf')).toBeTrue();
        expect(results.every((result) => result.listKey === 'EXECUTION')).toBeTrue();
        expect(results.find((result) => result.name === 'globex-msa-signed.pdf')).toEqual(
            jasmine.objectContaining({
                path:
                    '/execution/Contracts/Vendors/2026/Q111111111111111111111111111111/' +
                    'Signed/globex-msa-signed.pdf'
            })
        );
    });

    it('keeps a nested search inside the selected folder subtree', async () => {
        const rootListing = await firstValueFrom(api.listDocumentRoot('project-123', 'EXECUTION'));
        const contracts = rootListing.folders.find((folder) => folder.name === 'Contracts');
        if (!contracts) { throw new Error('Expected Contracts'); }
        const contractsListing = await firstValueFrom(
            api.listDocuments('project-123', contracts)
        );
        const vendors = contractsListing.folders.find((folder) => folder.name === 'Vendors');
        if (!vendors) { throw new Error('Expected Vendors'); }

        const response = await firstValueFrom(
            api.searchDocuments('project-123', vendors, 'agreement')
        );

        expect(response).toEqual([]);
    });

    async function executionRoot(): Promise<FolderNode> {
        return (await firstValueFrom(api.listDocumentRoot('project-123', 'EXECUTION')))
            .currentFolder;
    }
});
