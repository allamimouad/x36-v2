# Backend REST Endpoints — Suggestion (keep in mind)

> **Status: suggestion / not implemented.** Proposed REST contract between the Angular
> frontend and our backend. The backend sits between the frontend and SharePoint and
> maps these domain routes to SharePoint operations. The frontend never sees SharePoint
> list GUIDs/URLs — only `projectId`, `listKey` (`'execution' | 'marketing'`), and
> document ids (`UniqueId`).

## Principles
- **Reads are list-scoped** — a root has no parent id, so the list must be named.
- **Writes are by document id** at the project level — ids are unique within the
  project's SharePoint site, so the backend resolves the list itself, and cross-list
  move "just works."
- Mutations return the canonical affected node (Option A); delete returns 204.

## Retrieval (root by list, children by id)
    GET /projects/{projectId}/document-lists/{listKey}/documents     # root of the list
    GET /projects/{projectId}/documents/{folderId}/children          # direct children, by id

- `listKey` = `execution` | `marketing`. It appears **only** on the root read — a root
  has no parent id, so the list must be named. Once you have a folder, its children are
  fetched **by id**, consistent with the by-id mutations below (no `listKey` needed).
- **Response** (both) = the `DocumentListing` shape: `{ currentFolder, folders, files }`
  — includes the folder's own metadata, not just its children.

## Mutations (by document id, project-level)
    POST   /projects/{projectId}/documents/folders            { parentId, name }   -> FolderNode
    PATCH  /projects/{projectId}/documents/{documentId}        { name }             -> FileSystemNode   (rename)
    POST   /projects/{projectId}/documents/{documentId}/move   { targetParentId }   -> FileSystemNode
    POST   /projects/{projectId}/documents/{documentId}/copy   { targetParentId }   -> FileSystemNode
    DELETE /projects/{projectId}/documents/{documentId}                             -> 204 No Content

- No `listKey` in write routes — the document id (and `targetParentId` for move/copy)
  identify everything; a cross-list move just references a source id + a target in the
  other list.
- `move`/`copy` are action endpoints (not PATCH) because they do more than set a field
  (new path and parent relationship on the returned node, plus a possible cross-list
  copy+delete).

## Example bodies
    POST /projects/123/documents/folders
    { "parentId": "folder-guid", "name": "New Folder" }

    PATCH /projects/123/documents/file-guid
    { "name": "New Name.docx" }

    POST /projects/123/documents/file-guid/move
    { "targetParentId": "folder-guid" }

    POST /projects/123/documents/file-guid/copy
    { "targetParentId": "folder-guid" }

## Frontend mapping
- `FileSystemApi.listDocumentRoot(projectId, listKey)` → the root GET;
  `FileSystemApi.listDocuments(projectId, parentId)` → the children-by-id GET.
- `listKey` lives only on the root read and on the two UI tree sections — **not** on the
  node model (nodes stay generic; a node's list is derived by walking to its root).
- Mutations stay node-based; the adapter extracts `id` / `parentId` / `targetParentId`
  from the passed nodes — no `listKey` on write calls.
- The adapter maps HTTP status → `FileSystemError` codes (409 → `name-collision`,
  404 → `not-found`, 403 → `permission-denied`, etc.).
