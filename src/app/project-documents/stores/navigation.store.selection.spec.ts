import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { DocumentListRoots } from '../models/document-list.model';
import type { FileSystemNode, FolderNode } from '../models/file-system-node.model';
import { FileSystemReader } from './file-system-reader';
import { NavigationStore } from './navigation.store';

function folderNode(id: string, parentId: string | null, name: string): FolderNode {
    return {
        kind: 'folder',
        isRecycleBin: false,
        listKey: 'EXECUTION',
        id,
        path: parentId === null ? `/${name}` : `/Root/${name}`,
        name,
        parentId,
        itemCount: 0,
        createdAt: '2026-10-01T00:00:00Z',
        modifiedAt: '2026-10-01T00:00:00Z'
    };
}

const root = folderNode('root', null, 'Root');
const first = folderNode('first', 'root', 'First');
const second = folderNode('second', 'root', 'Second');

class StubReader implements FileSystemReader {
    public readonly entityMap = signal<Record<string, FileSystemNode>>({
        root, first, second
    });
    public readonly entities = signal<FileSystemNode[]>([root, first, second]);
    public readonly folderIdsWithLoadedChildren = signal<string[]>([]);
    public readonly folderIdsWithLoadingChildren = signal<string[]>([]);
    public readonly initializedRoots = signal<DocumentListRoots | null>(null);

    public loadChildren(): Promise<void> {
        return Promise.resolve();
    }

    public invalidate(): void {
        /* nothing to invalidate in the stub */
    }
}

/** Selection is right-pane state: per viewed folder, and never pointing at dead nodes. */
describe('NavigationStore selection', () => {
    let nav: InstanceType<typeof NavigationStore>;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                NavigationStore,
                { provide: FileSystemReader, useClass: StubReader }
            ]
        });
        nav = TestBed.inject(NavigationStore);
        nav.initialize({ currentFolderId: root.id, expandedRootIds: [] });
    });

    it('replaces on a single select and adds or removes on a toggle', () => {
        nav.select(first.id, 'single');
        expect([...nav.selectedIds()]).toEqual([first.id]);
        expect(nav.selectionAnchorId()).toBe(first.id);

        nav.select(second.id, 'toggle');
        expect([...nav.selectedIds()].sort()).toEqual([first.id, second.id].sort());
        expect(nav.selectionAnchorId()).toBe(second.id);

        nav.select(second.id, 'toggle');
        expect([...nav.selectedIds()]).toEqual([first.id]);

        nav.select(second.id, 'single');
        expect([...nav.selectedIds()]).toEqual([second.id]);
    });

    it('clears the selection when the viewed folder changes', () => {
        nav.setSelection([first.id, second.id], first.id);

        nav.navigateTo(first.id);

        expect(nav.selectedIds().size).toBe(0);
        expect(nav.selectionAnchorId()).toBeNull();
    });

    it('drops pruned ids from the selection and the anchor', () => {
        nav.setSelection([first.id, second.id], second.id);

        nav.pruneReferences([second.id]);

        expect([...nav.selectedIds()]).toEqual([first.id]);
        expect(nav.selectionAnchorId()).toBeNull();
    });
});
