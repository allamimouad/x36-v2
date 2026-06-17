/**
 * SharePoint on-prem implementation of {@link FileSystemApi}.
 *
 * STATUS: STUB. To be implemented on the SharePoint-connected laptop in Phase 6.
 * Every method body must currently throw "TODO: implement in Phase 6".
 *
 * ───────────────────────────────────────────────────────────────────────────
 * Implementation notes for the developer who picks this up
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Generated client
 *   The SharePoint REST surface is consumed via an auto-generated client built
 *   from the OpenAPI/Swagger spec for the on-prem site. This file is a thin
 *   adapter that maps our domain methods to the generated client and converts
 *   its DTOs into our `FolderNode` / `FileNode` shapes. Do NOT hand-write HTTP
 *   calls here — call the generated client.
 *
 * Base URL pattern
 *   `${siteUrl}/_api/web/`
 *   `siteUrl` is injected via `FILE_MANAGER_CONFIG` (or a dedicated SP token)
 *   and used by the generated client.
 *
 * Authentication
 *   On-prem typically uses NTLM/Kerberos via the browser. The generated client
 *   should be configured with `withCredentials: true`. No bearer token needed.
 *
 * Form digest
 *   POST/MERGE/DELETE requests require an `X-RequestDigest` header. Cache the
 *   digest from `POST /_api/contextinfo` (FormDigestValue) until ~30s before
 *   `FormDigestTimeoutSeconds` expires. On 403 with `-2130575252` (digest
 *   expired), refresh once and retry — implement in `digest.interceptor.ts`.
 *
 * id / path mapping
 *   `node.id` = SharePoint `UniqueId` (a GUID; stable across rename/move).
 *   `node.path` = `ServerRelativeUrl` (mutable; used as the URL fragment for
 *   write operations).
 *
 *   Every operation is scoped by `projectId`. The adapter/backend resolves that
 *   project to its SharePoint document library and verifies supplied node ids
 *   belong to it. Full node arguments provide fields needed by write operations.
 *
 * Endpoints per method (logical — actual calls go through the generated client)
 *   listDocuments   GET    project library root when parentId is omitted,
 *                          otherwise /_api/web/GetFolderById('<parentId>')
 *                            ?$expand=Folders,Files
 *                            &$select=UniqueId,Name,ServerRelativeUrl,ItemCount,
 *                                     Folders/UniqueId,Folders/Name,
 *                                     Folders/ServerRelativeUrl,Folders/ItemCount,
 *                                     Folders/TimeCreated,Folders/TimeLastModified,
 *                                     Files/UniqueId,Files/Name,
 *                                     Files/ServerRelativeUrl,Files/Length,
 *                                     Files/TimeCreated,Files/TimeLastModified
 *   createFolder    POST   /_api/web/Folders
 *                            body: { '__metadata': { type: 'SP.Folder' },
 *                                    ServerRelativeUrl: '<parent.path>/<name>' }
 *                            Extract UniqueId from the response to set the new node's id.
 *   rename          POST   /_api/web/GetFolderById('<node.id>')/MoveTo (or GetFileById)
 *                            newurl = `${parentOf(node.path)}/${newName}`
 *   move            POST   .../GetFolderById('<node.id>')/MoveTo
 *                            with newurl = `${newParent.path}/${node.name}`
 *                            Returns moved node; UniqueId unchanged, only path changes.
 *                            Set `parentId: newParent.id` on the returned FileSystemNode.
 *   copy            POST   .../GetFileById('<node.id>')/CopyTo for files
 *                            newurl = `${newParent.path}/${node.name}`
 *                   POST   recursive copy for folders (no native API; iterate)
 *                   Response gives a new UniqueId for the copy.
 *   delete          POST   /_api/web/GetFolderById('<node.id>') (or GetFileById)
 *                            with X-HTTP-Method: DELETE
 *   upload (small)  POST   /_api/web/GetFolderByServerRelativeUrl('<parent.path>')
 *                            /Files/add(url='<file.name>',overwrite=false)
 *   upload (large)  StartUpload    POST .../StartUpload(uploadId='<guid>')
 *                   ContinueUpload POST .../ContinueUpload(uploadId,fileOffset)
 *                   FinishUpload   POST .../FinishUpload(uploadId,fileOffset)
 *
 * Error code mapping (SharePoint → FileSystemError code)
 *   -2147024713  →  'name-collision'    (object already exists)
 *   -2147024894  →  'not-found'         (file/folder not found)
 *   -2147024891  →  'permission-denied' (access denied)
 *   -2130575252  →  'unknown'           (digest expired — auto-retry, then surface)
 *   HTTP 401/403 →  'permission-denied'
 *   HTTP 404     →  'not-found'
 *   HTTP 409     →  'name-collision'
 *   HTTP 429     →  'network'           (throttled — backoff in caller)
 *   any network  →  'network'
 *   AbortError   →  'cancelled'
 *
 * Risks to watch (also in PHASES.md §6)
 *   - Form digest expiry under load
 *   - 429 throttling on bulk ops (concurrency 4 may still be too aggressive)
 *   - Permission errors masked as generic 401/403
 *   - Timezone: SP returns UTC; ensure ISO strings round-trip correctly
 *   - URL length limits on deep hierarchies
 *   - Path encoding: spaces, apostrophes (must double-escape inside `'...'`)
 */

import { Injectable } from '@angular/core';
import { type Observable, throwError } from 'rxjs';
import type { DocumentListing } from '../models/document-listing.model';
import type { FileNode, FileSystemNode, FolderNode } from '../models/file-system-node.model';
import { FileSystemApi } from './file-system-api';

const PHASE6 = 'TODO: implement in Phase 6 — see PHASES.md';

@Injectable()
export class SharePointFileSystemApi extends FileSystemApi {
  /**
   * Resolve the project's library root when `parentId` is absent; otherwise get the folder by id.
   * Use `$select` + `$expand=Folders,Files` and map the result into a DocumentListing.
   */
  override listDocuments(_projectId: string, _parentId?: string): Observable<DocumentListing> {
    return throwError(() => new Error(PHASE6));
  }

  /**
   * POST /_api/web/Folders with ServerRelativeUrl=`${parent.path}/${name}`.
   * Extract UniqueId from the response to set the new FolderNode.id.
   */
  override createFolder(
    _projectId: string,
    _parent: FolderNode,
    _name: string,
  ): Observable<FolderNode> {
    return throwError(() => new Error(PHASE6));
  }

  /**
   * POST .../GetFolderById('<node.id>')/MoveTo (or GetFileById)
   * with newurl = `${parentOf(node.path)}/${newName}`.
   */
  override rename(
    _projectId: string,
    _node: FileSystemNode,
    _newName: string,
  ): Observable<FileSystemNode> {
    return throwError(() => new Error(PHASE6));
  }

  /**
   * POST .../GetFolderById('<node.id>')/MoveTo with newurl = `${newParent.path}/${node.name}`.
   * Returns the moved node — UniqueId stays the same, only ServerRelativeUrl changes.
   * Set parentId: newParent.id on the returned node.
   */
  override move(
    _projectId: string,
    _node: FileSystemNode,
    _newParent: FolderNode,
  ): Observable<FileSystemNode> {
    return throwError(() => new Error(PHASE6));
  }

  /**
   * POST .../GetFileById('<node.id>')/CopyTo for files; recursive iteration for folders.
   * Response gives a new UniqueId for the copy.
   */
  override copy(
    _projectId: string,
    _node: FileSystemNode,
    _newParent: FolderNode,
  ): Observable<FileSystemNode> {
    return throwError(() => new Error(PHASE6));
  }

  /** POST .../GetFolderById('<node.id>') (or GetFileById) with X-HTTP-Method: DELETE. */
  override delete(_projectId: string, _node: FileSystemNode): Observable<void> {
    return throwError(() => new Error(PHASE6));
  }

  /**
   * Files ≤ chunkSize: POST .../GetFolderByServerRelativeUrl('<parent.path>')
   *                         /Files/add(url='<file.name>',overwrite=false)
   * Files > chunkSize: StartUpload → ContinueUpload chunks → FinishUpload
   * Honor `signal` (abort the in-flight chunk + StartUpload session).
   */
  override upload(
    _projectId: string,
    _parent: FolderNode,
    _file: File,
    _onProgress: (percent: number) => void,
    _signal?: AbortSignal,
  ): Observable<FileNode> {
    return throwError(() => new Error(PHASE6));
  }
}
