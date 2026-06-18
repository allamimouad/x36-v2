export type FileSystemNode = FolderNode | FileNode;

export interface FolderNode {
  kind: 'folder';
  id: string;
  path: string;
  name: string;
  parentId: string | null;
  itemCount: number;
  createdAt: string;
  modifiedAt: string;
  modifiedBy?: string;
}

export interface FileNode {
  kind: 'file';
  id: string;
  path: string;
  name: string;
  parentId: string;
  sizeBytes: number;
  createdAt: string;
  modifiedAt: string;
  modifiedBy?: string;
  contentType?: string;
  downloadUrl?: string;
}

export function isFolder(n: FileSystemNode): n is FolderNode {
  return n.kind === 'folder';
}

export function isFile(n: FileSystemNode): n is FileNode {
  return n.kind === 'file';
}
