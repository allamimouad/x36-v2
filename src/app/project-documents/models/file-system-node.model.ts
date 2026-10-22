import type { DocumentListKey } from './document-list.model';
import { FolderNodeResponseAccessLevelEnum } from '@api/model/folderNodeResponse';
import { FileNodeResponseAccessLevelEnum } from '@api/model/fileNodeResponse';

export type FileSystemNode = FolderNode | FileNode;

export interface FolderNode {
    kind: 'folder';
    listKey: DocumentListKey;
    id: string;
    path: string;
    name: string;
    parentId: string | null;
    itemCount?: number;
    createdAt?: string;
    modifiedAt: string;
    modifiedBy?: string;
    webUrl?: string;
    isRecycleBin: boolean;
    accessLevel?: FolderNodeResponseAccessLevelEnum;
}

export interface FileNode {
    kind: 'file';
    listKey: DocumentListKey;
    id: string;
    path: string;
    name: string;
    parentId: string;
    sizeBytes?: number;
    createdAt?: string;
    modifiedAt: string;
    modifiedBy?: string;
    contentType?: string;
    onlineUrl?: string;
    desktopUrl?: string;
    downloadUrl?: string;
    accessLevel?: FileNodeResponseAccessLevelEnum;
}

export function isFolder(n: FileSystemNode): n is FolderNode {
    return n.kind === 'folder';
}

export function isFile(n: FileSystemNode): n is FileNode {
    return n.kind === 'file';
}
