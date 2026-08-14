# Backend REST Endpoints

> **Status: contract overview. The copy controller/service already exist; its public
> request DTO is being simplified. Other entries remain implementation guidance where
> their backend operation is pending.** The backend sits between the frontend and
> SharePoint. The frontend never sees SharePoint list GUIDs, credentials, or backend
> routing configuration. Nodes carry canonical decoded server-relative paths, and file
> DTOs may carry ready-to-use navigation links.

## Principles
- Read, create, rename, move, delete, and upload operations are list-scoped. Execution
  and Marketing may resolve to different SharePoint sites, so `projectId + listKey`
  selects the backend's configured `siteUrl` and document library for those operations.
- Copy is the path-based exception: its existing controller/service consumes complete
  source and destination `ServerRelativeUrl` parent paths, which already identify both
  SharePoint sites and document libraries.
- `listKey` is the domain key `'EXECUTION' | 'MARKETING'`; the frontend never receives
  list GUIDs, credentials, backend access tokens, or configured client details.
- Documents are addressed by SharePoint `UniqueId`. `kind` is additionally supplied for
  operations such as delete where SharePoint exposes separate file and folder APIs.
- Copy is also the deliberate exception to id-only addressing: its existing backend
  service already accepts source/destination context and returns the copied item. The
  controller passes canonical decoded paths already carried by the frontend nodes
  instead of adding unused ids or another SharePoint preflight read. It also passes the
  destination domain `listKey`, which SharePoint cannot return but the copied frontend
  node requires.
- Mutations return canonical SharePoint fields (Option A); delete returns 204. When
  mapping a renamed file, the Angular adapter preserves its unchanged `parentId`
  because SharePoint's `SP.File` resource does not expose `ParentFolder`.

## Retrieval (root by list, children by id, path resolve by list)
    GET /projects/{projectId}/document-lists/{listKey}/documents                   # root of the list
    GET /projects/{projectId}/document-lists/{listKey}/documents/{folderId}/children
    GET /projects/{projectId}/document-lists/{listKey}/documents/resolve-path?path=Contracts/2026

- `listKey` = `EXECUTION` | `MARKETING`. It selects the SharePoint site/library; the
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
    POST   /projects/{projectId}/documents/copy
    DELETE /projects/{projectId}/document-lists/{listKey}/documents/{documentId}?kind=file|folder

- Create addresses the parent folder in the URL and sends only the requested name.
  Creating directly inside a document list uses that list's root-folder id as
  `parentFolderId`; nested creation uses the current folder's id. Move identifies
  `targetListKey` because its destination may be on another SharePoint site. Copy is
  supported between the current project's document lists, including when they resolve
  to different SharePoint sites. The current adapter sends decoded source/target parent
  paths already present on the frontend nodes and sends `targetListKey` for the returned
  node's domain context. This path-based public contract still needs the backend
  project/list ownership hardening tracked in `docs/TODO.md` item 5. The backend
  compares the parent paths: a different-folder copy keeps `sourceName`, while a
  same-folder copy uses the ` - Copy` form before applying its existing `KeepBoth`
  collision handling.
- `move`/`copy` are action endpoints (not PATCH) because they do more than set a field
  (new path and parent relationship on the returned node; a cross-list move may also
  require copy+delete).

## Example bodies
    POST /projects/123/document-lists/EXECUTION/documents/parent-folder-guid/folders
    { "name": "New folder" }

    PATCH /projects/123/document-lists/EXECUTION/documents/file-guid?kind=file
    { "name": "New Name.docx" }

    POST /projects/123/document-lists/EXECUTION/documents/file-guid/move
    { "targetListKey": "MARKETING", "targetParentId": "folder-guid" }

    POST /projects/123/documents/copy
    {
      "kind": "file",
      "sourceParentPath": "/sites/project/Documents",
      "sourceName": "report.pdf",
      "targetListKey": "EXECUTION",
      "targetParentId": "folder-guid",
      "targetParentPath": "/sites/project/Documents/Target"
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
- [OPEN and DOWNLOAD file](backend-operations/file-links.md) — file DTO link mapping
  for Office Online, installed Office clients, and direct SharePoint download.
- [UPLOAD file with Feign](backend-operations/upload-file-feign-buffered.md) —
  bounded first implementation using the existing authenticated Feign client.
- [UPLOAD file with HTTP streaming](backend-operations/upload-file-http-streaming.md) —
  single-request `InputStream` relay for a future transport change.
- [VERIFY SharePoint search](backend-operations/verify-sharepoint-search.md) — ranked
  Postman capability checks for Search REST, list-view search, recursive CAML, OData,
  and canonical result hydration across both project document lists.
- [VERIFY SharePoint list-item search](backend-operations/verify-sharepoint-list-item-search.md)
  — preferred first-release candidate: mixed file/folder rows, canonical field mapping,
  continuation paging, more-than-5,000-item testing, Java name filtering, and backend
  acceptance criteria.
- [VERIFY folder-scoped list-item search](backend-operations/verify-sharepoint-folder-scoped-item-search.md)
  — copy-paste `GetItems`/CAML request for root or nested-folder recursive scope, using
  the farm-verified projections and explicit `ID > lastItemId` paging required because
  the target farm's POST response does not emit an OData next link.

## Frontend mapping
- `FileSystemApi.listDocumentRoot(projectId, listKey)` → the root GET;
  `FileSystemApi.listDocuments(projectId, parent)` → the children GET, with the adapter
  extracting `parent.listKey` and `parent.id` for the list-scoped route.
- Nodes carry the domain `listKey`; files may also carry ready-to-use open/download
  URLs, but never SharePoint routing configuration, list GUIDs, or credentials.
- Mutations stay node-based. Most adapters extract list keys and ids from the passed
  nodes; copy first requires matching source/destination list keys, then sends `kind`,
  the source parent path and name, and the target list key, parent id, and path to its
  project-scoped path-based endpoint.
- The copy response maps `listKey` from the requested `targetListKey` and `parentId`
  from `targetParentId`; SharePoint supplies the canonical copied fields. File responses
  include the real `sizeBytes`, and folder responses include the real `itemCount`.
- The adapter maps HTTP status → `FileSystemError` codes (409 → `name-collision`,
  423 → `locked`,
  404 → `not-found`, 403 → `permission-denied`, etc.).
