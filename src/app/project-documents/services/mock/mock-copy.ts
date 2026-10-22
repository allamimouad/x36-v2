import type { DocumentListKey } from '../../models/document-list.model';
import {
    isFolder,
    type FileNode,
    type FileSystemNode,
    type FolderNode
} from '../../models/file-system-node.model';
import { joinPath } from '../../utils/path.utils';
import { assertNameAvailable, nowIso, touchParentCounts } from './mock-node-utils';

export class MockNodeCopier {
    constructor(
        private readonly nodes: Map<string, FileSystemNode>,
        private readonly currentUser: string
    ) {}

    public copyRecursive(
        source: FileSystemNode,
        targetListKey: DocumentListKey,
        targetParentId: string,
        targetParentPath: string,
        name: string
    ): FileSystemNode {
        assertNameAvailable(this.nodes, targetParentId, name);
        const targetPath = joinPath(targetParentPath, name);

        return isFolder(source)
            ? this.copyFolderNode(source, targetListKey, targetParentId, targetPath, name)
            : this.copyFileNode(source, targetListKey, targetParentId, targetPath, name);
    }

    private copyFileNode(
        source: FileNode,
        targetListKey: DocumentListKey,
        targetParentId: string,
        targetPath: string,
        name: string
    ): FileNode {
        const now = nowIso();
        const file: FileNode = {
            ...source,
            listKey: targetListKey,
            id: crypto.randomUUID(),
            path: targetPath,
            name,
            parentId: targetParentId,
            createdAt: now,
            modifiedAt: now,
            modifiedBy: this.currentUser
        };
        this.nodes.set(file.id, file);

        return file;
    }

    private copyFolderNode(
        source: FolderNode,
        targetListKey: DocumentListKey,
        targetParentId: string,
        targetPath: string,
        name: string
    ): FolderNode {
        const now = nowIso();
        const children = Array.from(this.nodes.values())
            .filter((node) => node.parentId === source.id);
        const folder: FolderNode = {
            ...source,
            listKey: targetListKey,
            id: crypto.randomUUID(),
            path: targetPath,
            name,
            parentId: targetParentId,
            createdAt: now,
            modifiedAt: now,
            modifiedBy: this.currentUser
        };
        this.nodes.set(folder.id, folder);
        for (const child of children) {
            this.copyRecursive(child, targetListKey, folder.id, folder.path, child.name);
        }
        touchParentCounts(this.nodes, folder.id);

        return folder;
    }
}
