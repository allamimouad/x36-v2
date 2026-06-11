import type { DocumentListing } from '../models/document-listing.model';
import type { FileNode, FileSystemNode, FolderNode } from '../models/file-system-node.model';

/**
 * Backend-agnostic file system contract. Implementations are an in-memory mock
 * and a SharePoint adapter (Phase 6). The store always traffics in `FolderNode`
 * / `FileSystemNode` values — each implementation reads whichever fields it
 * needs (`id` for stable identity, `path` for URL construction, etc.).
 */
export abstract class FileSystemApi {
  /** List the project root, or a folder identified by `parentId`, with its direct children. */
  abstract listDocuments(projectId: string, parentId?: string): Promise<DocumentListing>;

  /** Create a new folder under `parent`. Throws on name collision. */
  abstract createFolder(projectId: string, parent: FolderNode, name: string): Promise<FolderNode>;

  /** Rename a folder or file. Throws on name collision or invalid name. */
  abstract rename(
    projectId: string,
    node: FileSystemNode,
    newName: string,
  ): Promise<FileSystemNode>;

  /** Move a folder or file to a new parent. Throws on descendant move, name collision. */
  abstract move(
    projectId: string,
    node: FileSystemNode,
    newParent: FolderNode,
  ): Promise<FileSystemNode>;

  /** Copy a folder (recursive) or file to a new parent. */
  abstract copy(
    projectId: string,
    node: FileSystemNode,
    newParent: FolderNode,
  ): Promise<FileSystemNode>;

  /** Delete a folder (recursive) or file. */
  abstract delete(projectId: string, node: FileSystemNode): Promise<void>;

  /** Upload a file. Emits progress (0-100). Returns the created FileNode. */
  abstract upload(
    projectId: string,
    parent: FolderNode,
    file: File,
    onProgress: (percent: number) => void,
    signal?: AbortSignal,
  ): Promise<FileNode>;
}
