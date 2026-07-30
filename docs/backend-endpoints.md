# Backend REST Endpoints — Suggestion (keep in mind)

> **Status: suggestion / not implemented.** Proposed REST contract between the Angular
> frontend and our backend. The backend sits between the frontend and SharePoint and
> maps these domain routes to SharePoint operations. The frontend never sees SharePoint
> list GUIDs/URLs — only `projectId`, `listKey` (`'execution' | 'marketing'`), and
> document ids (`UniqueId`).

## Principles
- **Every document operation is list-scoped.** Execution and Marketing may resolve to
  different SharePoint sites, so `projectId + listKey` selects the backend's configured
  `siteUrl` and document library before any SharePoint request is made.
- `listKey` is the domain key `'execution' | 'marketing'`; the frontend never receives
  SharePoint site URLs, list GUIDs, credentials, or backend access tokens.
- Documents are addressed by SharePoint `UniqueId`. `kind` is additionally supplied for
  operations such as delete where SharePoint exposes separate file and folder APIs.
- Copy is the deliberate exception to id-only addressing: its existing backend service
  already accepts source/destination context and returns the copied item. The controller
  passes canonical decoded paths already carried by the frontend nodes instead of
  adding an unused id or another SharePoint preflight read.
- Mutations return canonical SharePoint fields (Option A); delete returns 204. When
  mapping a renamed file, the Angular adapter preserves its unchanged `parentId`
  because SharePoint's `SP.File` resource does not expose `ParentFolder`.

## Retrieval (root by list, children by id, path resolve by list)
    GET /projects/{projectId}/document-lists/{listKey}/documents                   # root of the list
    GET /projects/{projectId}/document-lists/{listKey}/documents/{folderId}/children
    GET /projects/{projectId}/document-lists/{listKey}/documents/resolve-path?path=Contracts/2026

- `listKey` = `execution` | `marketing`. It selects the SharePoint site/library; the
  folder id selects the entity within that location.
- **Response** of the first two = the `DocumentListing` shape: `{ currentFolder, folders,
  files }` — includes the folder's own metadata, not just its children.
- **resolve-path** maps a list-relative path of **real folder names** (case-insensitive;
  spaces kept, URL-encoded into `ServerRelativeUrl`) to its target. `path=` empty ⇒ list
  root. Response = `{ canonicalPath, listing }` where `canonicalPath` is the actual folder
  casing (`""` for root) and `listing` is the target's `DocumentListing` (**no ancestors**).
  404 ⇒ `not-found`.

## Mutations (list-scoped route summary)
    POST   /projects/{projectId}/document-lists/{listKey}/documents/{parentFolderId}/folders
    POST   /projects/{projectId}/document-lists/{listKey}/documents/{parentFolderId}/files?name={fileName}
    PATCH  /projects/{projectId}/document-lists/{listKey}/documents/{documentId}?kind=file|folder
    POST   /projects/{projectId}/document-lists/{sourceListKey}/documents/{documentId}/move
    POST   /projects/{projectId}/document-lists/{sourceListKey}/documents/copy
    DELETE /projects/{projectId}/document-lists/{listKey}/documents/{documentId}?kind=file|folder

- Create addresses the parent folder in the URL and sends only the requested name.
  Creating directly inside a document list uses that list's root-folder id as
  `parentFolderId`; nested creation uses the current folder's id. Move identifies
  `targetListKey` because its destination may be on another SharePoint site. Copy also
  sends decoded source/target paths already present on the frontend nodes so the
  backend can call SharePoint's path-based native copy without preflight reads.
- `move`/`copy` are action endpoints (not PATCH) because they do more than set a field
  (new path and parent relationship on the returned node, plus a possible cross-list
  copy+delete).

## Example bodies
    POST /projects/123/document-lists/execution/documents/parent-folder-guid/folders
    { "name": "New folder" }

    PATCH /projects/123/document-lists/execution/documents/file-guid?kind=file
    { "name": "New Name.docx" }

    POST /projects/123/document-lists/execution/documents/file-guid/move
    { "targetListKey": "marketing", "targetParentId": "folder-guid" }

    POST /projects/123/document-lists/execution/documents/copy
    {
      "kind": "file",
      "sourcePath": "/sites/project/Documents/report.pdf",
      "sourceName": "report.pdf",
      "targetListKey": "marketing",
      "targetParentId": "folder-guid",
      "targetParentPath": "/sites/project/Marketing/Target"
    }

## Operation implementation guides

Each operation gets a separate implementation file when its backend-to-SharePoint
design is agreed. The overview remains a compact route/index document.

- [CREATE folder](backend-operations/create-folder.md) — complete contract,
  `AddUsingPath` request, canonical response mapping, and frontend handoff.
- [RENAME document](backend-operations/rename.md) — `FileLeafRef` MERGE followed by
  canonical by-id read for updated path and audit metadata.
- [DELETE document](backend-operations/delete.md) — complete contract and SharePoint
  implementation details.
- [COPY document](backend-operations/copy.md) — controller integration over the
  existing service that already performs copy and canonical post-copy lookup.
- [UPLOAD file with Feign](backend-operations/upload-file-feign-buffered.md) —
  bounded first implementation using the existing authenticated Feign client.
- [UPLOAD file with HTTP streaming](backend-operations/upload-file-http-streaming.md) —
  single-request `InputStream` relay for a future transport change.

## Frontend mapping
- `FileSystemApi.listDocumentRoot(projectId, listKey)` → the root GET;
  `FileSystemApi.listDocuments(projectId, parent)` → the children GET, with the adapter
  extracting `parent.listKey` and `parent.id` for the list-scoped route.
- Nodes will carry the domain `listKey`; they still do not expose SharePoint site URLs
  or list GUIDs.
- Mutations stay node-based; the adapter extracts source/target list keys and ids from
  the passed nodes.
- The adapter maps HTTP status → `FileSystemError` codes (409 → `name-collision`,
  404 → `not-found`, 403 → `permission-denied`, etc.).
