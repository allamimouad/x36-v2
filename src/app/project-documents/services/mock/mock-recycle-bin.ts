import { FileSystemError } from '../../models/file-system-error.model';
import type { DocumentListing } from '../../models/document-listing.model';
import {
    isFolder,
    type FileSystemNode,
    type FolderNode
} from '../../models/file-system-node.model';
import { joinPath } from '../../utils/path.utils';
import { assertNameAvailable, clone, nowIso, touchParentCounts } from './mock-node-utils';

interface DeletedEntry {
    binId: string;
    node: FileSystemNode;
    original: FileSystemNode;
    subtree: FileSystemNode[];
}

/** In-memory recycle-bin records keep original locations and complete folder subtrees. */
export class MockRecycleBin {
    private readonly entries = new Map<string, DeletedEntry>();

    constructor(private readonly nodes: Map<string, FileSystemNode>) {}

    public addBin(root: FolderNode): void {
        const bin: FolderNode = {
            kind: 'folder',
            listKey: root.listKey,
            id: crypto.randomUUID(),
            name: 'Recycle Bin',
            path: joinPath(root.path, 'Recycle Bin'),
            parentId: root.id,
            itemCount: 0,
            modifiedAt: nowIso(),
            isRecycleBin: true
        };
        this.nodes.set(bin.id, bin);
    }

    public recycle(original: FileSystemNode, subtree: FileSystemNode[]): void {
        const bin = [...this.nodes.values()].find(
            (node): node is FolderNode =>
                isFolder(node) && node.isRecycleBin && node.listKey === original.listKey
        );
        if (!bin) { throw new FileSystemError('not-found', 'Recycle bin not found'); }
        const node: FileSystemNode = {
            ...clone(original),
            id: crypto.randomUUID(),
            path: `sites/mock/${original.path.replace(/^\/+/, '')}`,
            parentId: bin.id,
            modifiedAt: nowIso(),
            modifiedBy: 'You'
        };
        this.entries.set(node.id, { binId: bin.id, node, original: clone(original),
            subtree: clone(subtree) });
    }

    public listing(binId: string): DocumentListing {
        const bin = this.nodes.get(binId);
        if (!bin || !isFolder(bin) || !bin.isRecycleBin) {
            throw new FileSystemError('not-found', 'Recycle bin not found');
        }
        const items = [...this.entries.values()]
            .filter((entry) => entry.binId === binId).map((entry) => clone(entry.node));

        return {
            currentFolder: { ...clone(bin), itemCount: items.length },
            folders: items.filter(isFolder),
            files: items.filter((node) => node.kind === 'file')
        };
    }

    public restore(binId: string, nodeId: string): void {
        const entry = this.requireEntry(binId, nodeId);
        const parent = this.nodes.get(entry.original.parentId ?? '');
        if (!parent || !isFolder(parent)) {
            throw new FileSystemError('not-found', 'The original folder no longer exists.');
        }
        assertNameAvailable(this.nodes, parent.id, entry.original.name);
        const newPath = joinPath(parent.path, entry.original.name);
        for (const node of entry.subtree) {
            const path = node.id === entry.original.id ? newPath :
                newPath + node.path.slice(entry.original.path.length);
            this.nodes.set(node.id, { ...clone(node), path });
        }
        this.entries.delete(nodeId);
        touchParentCounts(this.nodes, parent.id);
    }

    public deletePermanently(binId: string, nodeId: string): void {
        this.requireEntry(binId, nodeId);
        this.entries.delete(nodeId);
    }

    private requireEntry(binId: string, nodeId: string): DeletedEntry {
        const entry = this.entries.get(nodeId);
        if (entry?.binId !== binId) {
            throw new FileSystemError('not-found', 'Deleted item no longer exists.');
        }

        return entry;
    }
}
