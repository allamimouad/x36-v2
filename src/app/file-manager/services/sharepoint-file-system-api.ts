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
 * Base URL pattern
 *   `${siteUrl}/_api/web/`
 *   `siteUrl` is injected via `FILE_MANAGER_CONFIG` (or a dedicated SP token).
 *
 * Authentication
 *   On-prem typically uses NTLM/Kerberos via the browser. All requests must be
 *   sent with `withCredentials: true`. No bearer token needed.
 *
 * Form digest
 *   POST/MERGE/DELETE requests require an `X-RequestDigest` header. Cache the
 *   digest from `POST /_api/contextinfo` (FormDigestValue) until ~30s before
 *   `FormDigestTimeoutSeconds` expires. On 403 with `-2130575252` (digest
 *   expired), refresh once and retry — implement in `digest.interceptor.ts`.
 *
 * id ↔ serverRelativeUrl mapping
 *   Required project invariant: `id = serverRelativeUrl` and `path = id`.
 *   This keeps the mock and on-prem implementation aligned. Use
 *   `encodeURIComponent` consistently when interpolating into request URLs.
 *
 * Endpoints per method
 *   getRoot         GET    /_api/web/GetFolderByServerRelativeUrl('<libRoot>')
 *   listChildren    GET    /_api/web/GetFolderByServerRelativeUrl('<id>')
 *                            ?$expand=Folders,Files
 *                            &$select=Folders/Name,Folders/ServerRelativeUrl,
 *                                     Folders/ItemCount,Folders/TimeCreated,
 *                                     Folders/TimeLastModified,
 *                                     Files/Name,Files/ServerRelativeUrl,
 *                                     Files/Length,Files/TimeCreated,
 *                                     Files/TimeLastModified
 *   createFolder    POST   /_api/web/Folders
 *                            body: { '__metadata': { type: 'SP.Folder' },
 *                                    ServerRelativeUrl: '<parent>/<name>' }
 *   rename          POST   /_api/web/GetFileByServerRelativeUrl('<id>')/MoveTo
 *                            (or .../GetFolderByServerRelativeUrl('<id>')/MoveTo)
 *                            with newurl=<sibling path with new name>
 *   move            POST   ...MoveTo with newurl=<newParent>/<name>
 *   copy            POST   .../CopyTo for files
 *                   POST   recursive copy for folders (no native API; iterate)
 *   delete          POST   /_api/web/GetFileByServerRelativeUrl('<id>')
 *                            with X-HTTP-Method: DELETE
 *                            (or .../GetFolderByServerRelativeUrl('<id>'))
 *   upload (small)  POST   /_api/web/GetFolderByServerRelativeUrl('<parent>')
 *                            /Files/add(url='<name>',overwrite=false)
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
import type { FileNode, FileSystemNode, FolderNode } from '../models/file-system-node.model';
import { FileSystemApi } from './file-system-api';

const PHASE6 = 'TODO: implement in Phase 6 — see PHASES.md';

@Injectable()
export class SharePointFileSystemApi extends FileSystemApi {
  /** GET /_api/web/GetFolderByServerRelativeUrl('<libraryRoot>') */
  override getRoot(): Promise<FolderNode> {
    throw new Error(PHASE6);
  }

  /**
   * GET /_api/web/GetFolderByServerRelativeUrl('<id>')?$expand=Folders,Files
   * Map Folders[]/Files[] into FolderNode[]/FileNode[]; id = ServerRelativeUrl.
   */
  override listChildren(_folderId: string): Promise<{ folders: FolderNode[]; files: FileNode[] }> {
    throw new Error(PHASE6);
  }

  /** POST /_api/web/Folders with ServerRelativeUrl='<parent>/<name>' */
  override createFolder(_parentId: string, _name: string): Promise<FolderNode> {
    throw new Error(PHASE6);
  }

  /** POST .../GetFileByServerRelativeUrl|GetFolderByServerRelativeUrl('<id>')/MoveTo */
  override rename(_id: string, _newName: string): Promise<FileSystemNode> {
    throw new Error(PHASE6);
  }

  /** POST .../MoveTo with newurl='<newParent>/<name>' */
  override move(_id: string, _newParentId: string): Promise<FileSystemNode> {
    throw new Error(PHASE6);
  }

  /** POST .../CopyTo for files; recursive iteration for folders. */
  override copy(_id: string, _newParentId: string): Promise<FileSystemNode> {
    throw new Error(PHASE6);
  }

  /** POST .../GetFileByServerRelativeUrl|GetFolderByServerRelativeUrl with X-HTTP-Method: DELETE */
  override delete(_id: string): Promise<void> {
    throw new Error(PHASE6);
  }

  /**
   * Files ≤ chunkSize: POST .../Files/add(url,overwrite=false)
   * Files > chunkSize: StartUpload → ContinueUpload chunks → FinishUpload
   * Honor `signal` (abort the in-flight chunk + StartUpload session).
   */
  override upload(
    _parentId: string,
    _file: File,
    _onProgress: (percent: number) => void,
    _signal?: AbortSignal,
  ): Promise<FileNode> {
    throw new Error(PHASE6);
  }
}
