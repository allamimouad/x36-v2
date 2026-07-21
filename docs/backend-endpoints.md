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
  SharePoint site URLs, list GUIDs, credentials, or form digests.
- Documents are addressed by SharePoint `UniqueId`. `kind` is additionally supplied for
  operations such as delete where SharePoint exposes separate file and folder APIs.
- Mutations return the canonical affected node (Option A); delete returns 204.

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
    POST   /projects/{projectId}/document-lists/{listKey}/documents/folders
    PATCH  /projects/{projectId}/document-lists/{listKey}/documents/{documentId}
    POST   /projects/{projectId}/document-lists/{sourceListKey}/documents/{documentId}/move
    POST   /projects/{projectId}/document-lists/{sourceListKey}/documents/{documentId}/copy
    DELETE /projects/{projectId}/document-lists/{listKey}/documents/{documentId}?kind=file|folder

- Create and rename bodies remain as summarized below. Move/copy bodies also identify
  `targetListKey` because their destination may be on another SharePoint site. Their
  detailed SharePoint implementations will be documented when those operations are
  designed.
- `move`/`copy` are action endpoints (not PATCH) because they do more than set a field
  (new path and parent relationship on the returned node, plus a possible cross-list
  copy+delete).

## Example bodies
    POST /projects/123/document-lists/execution/documents/folders
    { "parentId": "folder-guid", "name": "New Folder" }

    PATCH /projects/123/document-lists/execution/documents/file-guid
    { "name": "New Name.docx" }

    POST /projects/123/document-lists/execution/documents/file-guid/move
    { "targetListKey": "marketing", "targetParentId": "folder-guid" }

    POST /projects/123/document-lists/execution/documents/file-guid/copy
    { "targetListKey": "marketing", "targetParentId": "folder-guid" }

## Operation implementation guides

Each operation gets a separate implementation file when its backend-to-SharePoint
design is agreed. The overview remains a compact route/index document.

- [DELETE document](backend-operations/delete.md) — complete contract and SharePoint
  implementation details.

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
