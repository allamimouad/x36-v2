import type { FileNode, FolderNode } from './file-system-node.model';

export interface DocumentListing {
  currentFolder: FolderNode;
  folders: FolderNode[];
  files: FileNode[];
}
