import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import type { DocumentListKey } from '../../models/document-list.model';
import type { FolderNode } from '../../models/file-system-node.model';
import { MOCK_CONFIG } from './mock-config.token';
import { MockFileSystemApi } from './mock-file-system-api';

describe('MockFileSystemApi recycle bin', () => {
    let api: MockFileSystemApi;
    const projectId = 'project-123';

    beforeEach(() => {
        TestBed.configureTestingModule({ providers: [MockFileSystemApi, {
            provide: MOCK_CONFIG,
            useValue: { minLatencyMs: 0, maxLatencyMs: 0, enableErrors: false, errorRate: 0 }
        }] });
        api = TestBed.inject(MockFileSystemApi);
    });

    async function rootAndBin(list: DocumentListKey): Promise<{
        root: FolderNode; bin: FolderNode;
    }> {
        const listing = await firstValueFrom(api.listDocumentRoot(projectId, list));
        const bin = listing.folders.find((folder) => folder.isRecycleBin);
        if (!bin) { throw new Error('Expected recycle bin'); }

        return { root: listing.currentFolder, bin };
    }

    it('restores a deleted folder and its nested contents with the original ids', async () => {
        const { root, bin } = await rootAndBin('EXECUTION');
        const parent = await firstValueFrom(api.createFolder(projectId, root, 'Parent'));
        const child = await firstValueFrom(api.createFolder(projectId, parent, 'Child'));
        await firstValueFrom(api.delete(projectId, parent));
        expect((await firstValueFrom(api.listDocuments(projectId, root))).folders
            .some((folder) => folder.id === parent.id)).toBeFalse();

        const deleted = await firstValueFrom(api.getRecycleBinItems(projectId, bin.id));
        expect(deleted.folders.length).toBe(1);
        const record = deleted.folders[0];
        expect(record.parentId).toBe(bin.id);
        expect(record.path).toBe(parent.path);
        expect(record.id).not.toBe(parent.id);
        await firstValueFrom(api.restoreRecycleBinItem(projectId, bin.id, record.id));

        expect((await firstValueFrom(api.listDocuments(projectId, root))).folders)
            .toContain(jasmine.objectContaining({ id: parent.id, path: parent.path }));
        expect((await firstValueFrom(api.listDocuments(projectId, parent))).folders)
            .toContain(jasmine.objectContaining({ id: child.id, path: child.path }));
        expect((await firstValueFrom(api.getRecycleBinItems(projectId, bin.id))).folders)
            .toEqual([]);
    });

    it('retains a deleted record when its original location is missing', async () => {
        const { root, bin } = await rootAndBin('EXECUTION');
        const parent = await firstValueFrom(api.createFolder(projectId, root, 'Parent'));
        const child = await firstValueFrom(api.createFolder(projectId, parent, 'Child'));
        await firstValueFrom(api.delete(projectId, child));
        await firstValueFrom(api.delete(projectId, parent));
        const listing = await firstValueFrom(api.getRecycleBinItems(projectId, bin.id));
        const record = listing.folders.find((folder) => folder.name === child.name)!;

        await expectAsync(firstValueFrom(api.restoreRecycleBinItem(projectId, bin.id, record.id)))
            .toBeRejectedWith(jasmine.objectContaining({ code: 'not-found' }));
        expect((await firstValueFrom(api.getRecycleBinItems(projectId, bin.id))).folders.length)
            .toBe(2);
    });

    it('retains a deleted record on a name collision and allows permanent deletion', async () => {
        const { root, bin } = await rootAndBin('EXECUTION');
        const folder = await firstValueFrom(api.createFolder(projectId, root, 'Duplicate'));
        await firstValueFrom(api.delete(projectId, folder));
        await firstValueFrom(api.createFolder(projectId, root, 'Duplicate'));
        const [record] = (await firstValueFrom(api.getRecycleBinItems(projectId, bin.id))).folders;

        await expectAsync(firstValueFrom(api.restoreRecycleBinItem(projectId, bin.id, record.id)))
            .toBeRejectedWith(jasmine.objectContaining({ code: 'name-collision' }));
        await firstValueFrom(api.deletePermanentlyRecycleBinItem(projectId, bin.id, record.id));
        expect((await firstValueFrom(api.getRecycleBinItems(projectId, bin.id))).folders)
            .toEqual([]);
        await expectAsync(firstValueFrom(api.restoreRecycleBinItem(projectId, bin.id, record.id)))
            .toBeRejectedWith(jasmine.objectContaining({ code: 'not-found' }));
    });

    it('isolates deleted records between lists and rejects a mismatched bin id', async () => {
        const execution = await rootAndBin('EXECUTION');
        const marketing = await rootAndBin('MARKETING');
        const folder = await firstValueFrom(api.createFolder(projectId, execution.root, 'Deleted'));
        await firstValueFrom(api.delete(projectId, folder));
        const [record] = (await firstValueFrom(api.getRecycleBinItems(
            projectId, execution.bin.id
        ))).folders;

        expect((await firstValueFrom(api.getRecycleBinItems(
            projectId, marketing.bin.id
        ))).folders).toEqual([]);
        await expectAsync(firstValueFrom(api.deletePermanentlyRecycleBinItem(
            projectId, marketing.bin.id, record.id
        ))).toBeRejectedWith(jasmine.objectContaining({ code: 'not-found' }));
        expect((await firstValueFrom(api.getRecycleBinItems(
            projectId, execution.bin.id
        ))).folders.length).toBe(1);
    });
});
