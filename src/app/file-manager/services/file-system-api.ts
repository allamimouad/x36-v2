import type { Observable } from 'rxjs';
import type { DocumentListing, ResolvedDocumentPath } from '../models/document-listing.model';
import type { DocumentListKey } from '../models/document-list.model';
import type { FileNode, FileSystemNode, FolderNode } from '../models/file-system-node.model';

/**
 * Backend-agnostic file system contract. Implementations are an in-memory mock
 * and a SharePoint adapter. The store always traffics in `FolderNode`
 * / `FileSystemNode` values — each implementation reads whichever fields it
 * needs (`id` for stable identity, `path` for URL construction, etc.).
 *
 * Methods return `Observable` rather than `Promise`: the real adapter is built on
 * Angular `HttpClient` (Observable-native). An `Observable` can be consumed as a
 * single-shot result via `firstValueFrom` for today's request/response calls, while
 * a `Promise` contract could not later be widened to expose cancellation or
 * multi-emission. Keeping the contract as the superset preserves the option to add
 * read-cancellation and progress-streams without a future API refactor. Stores that
 * prefer async/await bridge with `firstValueFrom` at the call site.
 */
export abstract class FileSystemApi {
    /**
   * List the root of one document list (`listKey`) with its direct children.
   * `listKey` is the only place a list key is needed — a root has no parent id.
   */
    abstract listDocumentRoot(
        projectId: string,
        listKey: DocumentListKey,
    ): Observable<DocumentListing>;

    /** List the direct children of a folder, addressed by its id alone. */
    abstract listDocuments(projectId: string, parentId: string): Observable<DocumentListing>;

    /**
   * Resolve a list-relative path (real folder names, case-insensitive) to its target
   * folder. `path === ''` is the list root. Returns the target listing plus the
   * canonical path casing; does NOT return ancestors. Throws `not-found` on a miss.
   */
    abstract resolveDocumentPath(
        projectId: string,
        listKey: DocumentListKey,
        path: string,
    ): Observable<ResolvedDocumentPath>;

    /** Create a new folder under `parent`. Throws on name collision. */
    abstract createFolder(projectId: string, parent: FolderNode, name: string): Observable<FolderNode>;

    /** Rename a folder or file. Throws on name collision or invalid name. */
    abstract rename(
        projectId: string,
        node: FileSystemNode,
        newName: string,
    ): Observable<FileSystemNode>;

    /** Move a folder or file to a new parent. Throws on descendant move, name collision. */
    abstract move(
        projectId: string,
        node: FileSystemNode,
        newParent: FolderNode,
    ): Observable<FileSystemNode>;

    /** Copy a folder (recursive) or file to a new parent. */
    abstract copy(
        projectId: string,
        node: FileSystemNode,
        newParent: FolderNode,
    ): Observable<FileSystemNode>;

    /** Delete a folder (recursive) or file. */
    abstract delete(projectId: string, node: FileSystemNode): Observable<void>;

    /** Upload a file. Emits progress (0-100). Returns the created FileNode. */
    abstract upload(
        projectId: string,
        parent: FolderNode,
        file: File,
        onProgress: (percent: number) => void,
        signal?: AbortSignal,
    ): Observable<FileNode>;
}
