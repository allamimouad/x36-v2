import type { FileNode, FolderNode } from './file-system-node.model';

export interface DocumentListing {
  currentFolder: FolderNode;
  folders: FolderNode[];
  files: FileNode[];
}

/** Result of resolving a typed list-relative path to a folder. */
export interface ResolvedDocumentPath {
  /** Canonical path with the backend's real folder casing; `''` for the list root. */
  canonicalPath: string;
  /** The target folder + its direct children (no ancestors). */
  listing: DocumentListing;
}
