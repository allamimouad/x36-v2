/**
 * SharePoint on-prem implementation of {@link FileSystemApi}.
 *
 * STATUS: PARTIAL. Copy and upload are implemented; the remaining methods return an
 * implementation-pending error.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * Implementation notes for the developer who picks this up
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Backend client
 *   Angular calls the application's backend, never SharePoint directly. The upload
 *   request construction is isolated in `requestUpload` so an auto-generated client
 *   can replace the equivalent `HttpClient` call without changing progress,
 *   cancellation, or error behavior.
 *
 * Backend site/list routing
 *   `projectId` + `node.listKey` resolve the SharePoint site and document library.
 *   Execution and marketing may live on different sites, so no operation may infer
 *   site context from a GUID or path alone.
 *
 * Authentication
 *   Use the application's existing frontend-to-backend authentication. SharePoint
 *   credentials, access tokens, and routing configuration remain backend-only. File
 *   DTOs may contain ready-to-use open/download navigation links, but never tokens.
 *   The backend reuses its existing authenticated Feign client; its interceptor
 *   supplies the cached per-user certificate-backed OAuth bearer token. Do not add
 *   token or form-digest handling to this Angular adapter.
 *
 * id / path mapping
 *   `node.id` = SharePoint `UniqueId` (a GUID; stable across rename/move).
 *   `node.path` = `ServerRelativeUrl` (mutable; used as the URL fragment for
 *   write operations).
 *
 *   Every operation is scoped by `projectId` and `listKey`. Each returned node keeps
 *   its list key. Full node arguments provide source context; `newParent.listKey`
 *   provides destination context for move/copy.
 *
 * Backend mappings per method (logical — Angular calls the generated backend client)
 *   listDocumentRoot GET   the `listKey` document library's root folder
 *                            (resolve listKey → SharePoint list, then its RootFolder)
 *                            ?$expand=Folders,Files (same $select as below)
 *   listDocuments   GET    /_api/web/GetFolderById('<parentId>')
 *                            ?$expand=Folders,Files
 *                            &$select=UniqueId,Name,ServerRelativeUrl,ItemCount,
 *                                     Folders/UniqueId,Folders/Name,
 *                                     Folders/ServerRelativeUrl,Folders/ItemCount,
 *                                     Folders/TimeCreated,Folders/TimeLastModified,
 *                                     Files/UniqueId,Files/Name,
 *                                     Files/ServerRelativeUrl,Files/Length,
 *                                     Files/TimeCreated,Files/TimeLastModified
 *   createFolder    POST   the generated backend operation that creates a folder with
 *                            unique-name behavior. Return its canonical Name,
 *                            ServerRelativeUrl, and UniqueId; collision resolution must
 *                            be atomic on the backend side.
 *   rename          PATCH  backend /projects/{projectId}/document-lists/{listKey}
 *                            /documents/{node.id}?kind={node.kind}
 *                            Backend MERGEs `FileLeafRef` through the file/folder's
 *                            `ListItemAllFields`, then reads the canonical node by id.
 *   move            POST   .../GetFolderById('<node.id>')/MoveTo
 *                            with newurl = `${newParent.path}/${node.name}`
 *                            Returns moved node; UniqueId unchanged, only path changes.
 *                            Set `parentId: newParent.id` on the returned FileSystemNode.
 *   copy            POST   backend /projects/{projectId}/documents/copy with the
 *                            source parent path/name plus the destination list key,
 *                            parent id, and parent path. The backend reuses its existing
 *                            copy plus canonical post-copy lookup.
 *   delete          DELETE backend /projects/{projectId}/document-lists/{node.listKey}
 *                            /documents/{node.id}?kind=file|folder
 *                            Backend calls GetFileById or GetFolderById in that list's site.
 *   upload          POST   backend /projects/{projectId}/document-lists/{parent.listKey}
 *                            /documents/{parent.id}/files?name={file.name}
 *                            with the File as the raw application/octet-stream body.
 *                            Observe Angular upload progress and map the returned file DTO.
 *
 * Error code mapping (SharePoint → FileSystemError code)
 *   -2147024713  →  'name-collision'    (object already exists)
 *   -2147024894  →  'not-found'         (file/folder not found)
 *   -2147024891  →  'permission-denied' (access denied)
 *   HTTP 401/403 →  'permission-denied'
 *   HTTP 404     →  'not-found'
 *   HTTP 409     →  'name-collision'
 *   HTTP 413     →  'too-large'
 *   HTTP 429     →  'network'           (throttled — backoff in caller)
 *   any network  →  'network'
 *   AbortError   →  'cancelled'
 *
 * Risks to watch
 *   - OAuth token expiry/refresh is owned by the backend authentication layer
 *   - 429 throttling on bulk ops (concurrency 4 may still be too aggressive)
 *   - Permission errors masked as generic 401/403
 *   - Timezone: SP returns UTC; ensure ISO strings round-trip correctly
 *   - URL length limits on deep hierarchies
 *   - Path encoding: spaces, apostrophes (must double-escape inside `'...'`)
 */

import {
    HttpClient,
    HttpErrorResponse,
    type HttpEvent,
    HttpEventType,
    HttpParams
} from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, throwError } from 'rxjs';
import type { DocumentListing, ResolvedDocumentPath } from '../models/document-listing.model';
import type { DocumentListKey } from '../models/document-list.model';
import { FileSystemError } from '../models/file-system-error.model';
import type { FileNode, FileSystemNode, FolderNode } from '../models/file-system-node.model';
import { parentOf } from '../utils/path.utils';
import { FileSystemApi } from './file-system-api';

const IMPLEMENTATION_PENDING = 'SharePointFileSystemApi is not implemented yet';

interface CopyDocumentRequest {
    kind: FileSystemNode['kind'];
    sourceParentPath: string;
    sourceName: string;
    targetListKey: DocumentListKey;
    targetParentId: string;
    targetParentPath: string;
}

@Injectable()
export class SharePointFileSystemApi extends FileSystemApi {
    private readonly http = inject(HttpClient);

    /**
   * Resolve `listKey` → the project's SharePoint document library, then GET its
   * RootFolder with `$expand=Folders,Files`. Map the result into a DocumentListing.
   */
    public override listDocumentRoot(
        _projectId: string,
        _listKey: DocumentListKey
    ): Observable<DocumentListing> {
    // TODO: implement with the SharePoint integration US.
        return throwError(() => new Error(IMPLEMENTATION_PENDING));
    }

    /**
   * Send `parent.listKey` and `parent.id` to the list-scoped backend children route,
   * then map the response into a DocumentListing.
   */
    public override listDocuments(
        _projectId: string,
        _parent: FolderNode
    ): Observable<DocumentListing> {
    // TODO: implement with the SharePoint integration US.
        return throwError(() => new Error(IMPLEMENTATION_PENDING));
    }

    /**
   * Resolve a list-relative path to its target folder. Walk `path` from the list root,
   * URL-encoding each real folder name into the `ServerRelativeUrl`
   * (`GetFolderByServerRelativeUrl('<basePath>/<encoded(path)>')?$expand=Folders,Files`).
   * Return the target listing plus the canonical path casing; no ancestors. Map a
   * SharePoint not-found into `FileSystemError('not-found')`.
   */
    public override resolveDocumentPath(
        _projectId: string,
        _listKey: DocumentListKey,
        _path: string
    ): Observable<ResolvedDocumentPath> {
    // TODO: implement with the SharePoint integration US.
        return throwError(() => new Error(IMPLEMENTATION_PENDING));
    }

    /**
   * Request creation with `name`, using the backend's unique-name behavior when the
   * requested name already exists. Return the canonical persisted name/path and extract
   * UniqueId from the response to set the new FolderNode.id.
   */
    public override createFolder(
        _projectId: string,
        _parent: FolderNode,
        _name: string
    ): Observable<FolderNode> {
    // TODO: implement with the SharePoint integration US.
        return throwError(() => new Error(IMPLEMENTATION_PENDING));
    }

    /**
   * Request a list-scoped backend rename by `node.id` and `node.kind`. The backend
   * updates `ListItemAllFields.FileLeafRef`, then returns the canonical by-id read with
   * SharePoint-owned path, modification time, and editor.
   */
    public override rename(
        _projectId: string,
        _node: FileSystemNode,
        _newName: string
    ): Observable<FileSystemNode> {
    // TODO: implement with the SharePoint integration US.
        return throwError(() => new Error(IMPLEMENTATION_PENDING));
    }

    /**
   * POST .../GetFolderById('<node.id>')/MoveTo with newurl = `${newParent.path}/${node.name}`.
   * Returns the moved node — UniqueId stays the same, only ServerRelativeUrl changes.
   * Set parentId: newParent.id on the returned node.
   */
    public override move(
        _projectId: string,
        _node: FileSystemNode,
        _newParent: FolderNode
    ): Observable<FileSystemNode> {
    // TODO: implement with the SharePoint integration US.
        return throwError(() => new Error(IMPLEMENTATION_PENDING));
    }

    /** Call the project-scoped backend copy route and emit its canonical copied node. */
    public override copy(
        projectId: string,
        node: FileSystemNode,
        newParent: FolderNode
    ): Observable<FileSystemNode> {
        if (node.listKey !== newParent.listKey) {
            return throwError(
                () => new FileSystemError(
                    'cross-list-copy',
                    'Cannot copy items between document lists'
                )
            );
        }

        return this.requestCopy(projectId, node, newParent).pipe(
            catchError((error: unknown) => throwError(() => this.mapCopyError(error)))
        );
    }

    /** Call the list-scoped backend DELETE route using `node.listKey`, `node.id`, and kind. */
    public override delete(_projectId: string, _node: FileSystemNode): Observable<void> {
    // TODO: implement with the SharePoint integration US.
        return throwError(() => new Error(IMPLEMENTATION_PENDING));
    }

    /**
   * POST the complete File as one raw request to the list-scoped backend upload route.
   * Report browser-to-backend progress, honor `signal`, and emit the returned FileNode.
   */
    public override upload(
        projectId: string,
        parent: FolderNode,
        file: File,
        onProgress: (percent: number) => void,
        signal?: AbortSignal
    ): Observable<FileNode> {
        return new Observable<FileNode>((subscriber) => {
            let lastProgress = -1;

            const reportProgress = (percent: number): void => {
                const normalized = Math.max(0, Math.min(100, Math.round(percent)));
                if (normalized === lastProgress) { return; }
                lastProgress = normalized;
                onProgress(normalized);
            };
            const cancel = (): void => {
                requestSubscription.unsubscribe();
                if (subscriber.closed) { return; }
                subscriber.error(
                    new FileSystemError('cancelled', 'Upload was cancelled')
                );
            };

            if (signal?.aborted) {
                subscriber.error(
                    new FileSystemError('cancelled', 'Upload was cancelled')
                );

                return;
            }
            signal?.addEventListener('abort', cancel, { once: true });

            const requestSubscription = this.requestUpload(projectId, parent, file).subscribe({
                next: (event) => {
                    if (event.type === HttpEventType.UploadProgress) {
                        const total = event.total ?? file.size;
                        reportProgress(total > 0 ? event.loaded / total * 100 : 100);
                    }
                    if (event.type !== HttpEventType.Response) { return; }
                    if (!event.body) {
                        subscriber.error(
                            new FileSystemError(
                                'unknown',
                                'The upload response did not contain a file'
                            )
                        );

                        return;
                    }
                    reportProgress(100);
                    subscriber.next(event.body);
                    subscriber.complete();
                },
                error: (error: unknown) => {
                    subscriber.error(
                        signal?.aborted
                            ? new FileSystemError('cancelled', 'Upload was cancelled')
                            : this.mapUploadError(error)
                    );
                }
            });

            return () => {
                signal?.removeEventListener('abort', cancel);
                requestSubscription?.unsubscribe();
            };
        });
    }

    /**
     * Replace only this method body when an auto-generated backend client is available.
     * Its generated call must observe HTTP events and enable progress reporting.
     */
    private requestUpload(
        projectId: string,
        parent: FolderNode,
        file: File
    ): Observable<HttpEvent<FileNode>> {
        const url =
            `/projects/${encodeURIComponent(projectId)}` +
            `/document-lists/${encodeURIComponent(parent.listKey)}` +
            `/documents/${encodeURIComponent(parent.id)}/files`;

        return this.http.post<FileNode>(url, file, {
            headers: { 'Content-Type': 'application/octet-stream' },
            params: new HttpParams().set('name', file.name),
            observe: 'events',
            reportProgress: true
        });
    }

    /**
     * Replace only this method body when an auto-generated backend client is available.
     * Keep the request mapping in this adapter so stores remain backend-agnostic.
     */
    private requestCopy(
        projectId: string,
        node: FileSystemNode,
        newParent: FolderNode
    ): Observable<FileSystemNode> {
        const request: CopyDocumentRequest = {
            kind: node.kind,
            sourceParentPath: parentOf(node.path),
            sourceName: node.name,
            targetListKey: newParent.listKey,
            targetParentId: newParent.id,
            targetParentPath: newParent.path
        };
        const url = `/projects/${encodeURIComponent(projectId)}/documents/copy`;

        return this.http.post<FileSystemNode>(url, request);
    }

    private mapCopyError(error: unknown): FileSystemError {
        if (error instanceof FileSystemError) { return error; }
        if (!(error instanceof HttpErrorResponse)) {
            return new FileSystemError('unknown', 'Copy failed', error);
        }

        const status = error.status;
        if (status === 0 || status === 408 || status === 429 || status >= 500) {
            return new FileSystemError('network', 'Copy request failed', error);
        }
        switch (status) {
            case 400:
                return new FileSystemError('invalid-name', 'Invalid copy request', error);
            case 401:
            case 403:
                return new FileSystemError(
                    'permission-denied',
                    'Copy is not permitted',
                    error
                );
            case 404:
                return new FileSystemError(
                    'not-found',
                    'Copy source or destination was not found',
                    error
                );
            case 409:
                return new FileSystemError(
                    'name-collision',
                    'An item with that name already exists',
                    error
                );
            default:
                return new FileSystemError('unknown', 'Copy failed', error);
        }
    }

    private mapUploadError(error: unknown): FileSystemError {
        if (error instanceof FileSystemError) { return error; }
        if (!(error instanceof HttpErrorResponse)) {
            return new FileSystemError('unknown', 'Upload failed', error);
        }

        const status = error.status;
        if (status === 0 || status === 408 || status === 429 || status >= 500) {
            return new FileSystemError('network', 'Upload request failed', error);
        }
        switch (status) {
            case 400:
                return new FileSystemError('invalid-name', 'Invalid upload request', error);
            case 401:
            case 403:
                return new FileSystemError(
                    'permission-denied',
                    'Upload is not permitted',
                    error
                );
            case 404:
                return new FileSystemError(
                    'not-found',
                    'Upload destination was not found',
                    error
                );
            case 409:
                return new FileSystemError(
                    'name-collision',
                    'A file with that name already exists',
                    error
                );
            case 413:
                return new FileSystemError(
                    'too-large',
                    'File exceeds the upload limit',
                    error
                );
            default:
                return new FileSystemError('unknown', 'Upload failed', error);
        }
    }
}
