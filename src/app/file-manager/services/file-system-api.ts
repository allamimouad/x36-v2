import type { FileNode, FileSystemNode, FolderNode } from '../models/file-system-node.model';

export abstract class FileSystemApi {
  /** List direct children of a folder. */
  abstract listChildren(folderId: string): Promise<{
    folders: FolderNode[];
    files: FileNode[];
  }>;

  /** Get root folder (always available). */
  abstract getRoot(): Promise<FolderNode>;

  /** Create a new folder. Throws on name collision. */
  abstract createFolder(parentId: string, name: string): Promise<FolderNode>;

  /** Rename a folder or file. Throws on name collision or invalid name. */
  abstract rename(id: string, newName: string): Promise<FileSystemNode>;

  /** Move a folder or file to a new parent. Throws on descendant move, name collision. */
  abstract move(id: string, newParentId: string): Promise<FileSystemNode>;

  /** Copy a folder (recursive) or file to a new parent. */
  abstract copy(id: string, newParentId: string): Promise<FileSystemNode>;

  /** Delete a folder (recursive) or file. */
  abstract delete(id: string): Promise<void>;

  /** Upload a file. Emits progress (0-100). Returns the created FileNode. */
  abstract upload(
    parentId: string,
    file: File,
    onProgress: (percent: number) => void,
    signal?: AbortSignal,
  ): Promise<FileNode>;
}
