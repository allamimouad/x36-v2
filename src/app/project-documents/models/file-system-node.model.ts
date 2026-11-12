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
    /**
     * URL to open the file in the browser (Office Online viewer for Office documents,
     * direct SharePoint URL otherwise). Always populated for file nodes; it is the
     * fallback when desktopUrl is null.
     */
    onlineUrl?: string;
    /**
     * Office desktop protocol URI (ms-word:, ms-excel:, ms-powerpoint:) to launch the
     * installed Office application. Null when the file type is not an Office document.
     */
    desktopUrl?: string;
    /** URL to download the file via SharePoint's download handler. Always populated. */
    downloadUrl?: string;
    accessLevel?: FileNodeResponseAccessLevelEnum;
}

export function isFolder(n: FileSystemNode): n is FolderNode {
    return n.kind === 'folder';
}

export function isFile(n: FileSystemNode): n is FileNode {
    return n.kind === 'file';
}
