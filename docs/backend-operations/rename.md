# RENAME Document

> **Status: contract agreed; frontend pessimistic rename flow implemented, backend
> pending.** This is the operation-specific companion to the
> [backend endpoint overview](../backend-endpoints.md).

## Domain endpoint

    PATCH /projects/{projectId}/document-lists/{listKey}/documents/{documentId}?kind={kind}
    Content-Type: application/json

    {
      "name": "Renamed document.docx"
    }

- `listKey`: `execution` or `marketing`; required because the two lists may use
  different SharePoint sites.
- `documentId`: the file or folder's SharePoint `UniqueId` GUID.
- `kind`: `file` or `folder`; required because SharePoint exposes distinct by-id
  entry points.
- `name`: the requested decoded leaf name only, never a path. A file name includes its
  extension.
- Do not accept a SharePoint site URL, library id, access token, complete destination
  path, overwrite flag, or ETag from the frontend.

Document-list roots cannot be renamed.

Successful response:

    200 OK
    Content-Type: application/json

    {
      "kind": "folder",
      "listKey": "execution",
      "id": "unchanged-sharepoint-unique-id",
      "path": "/sites/project/Documents/Renamed folder",
      "name": "Renamed folder",
      "parentId": "parent-folder-guid",
      "itemCount": 4,
      "createdAt": "2026-07-20T08:00:00Z",
      "modifiedAt": "2026-07-24T14:30:00Z",
      "modifiedBy": "User Display Name"
    }

The response contains the canonical updated fields read from SharePoint after the
rename. A folder response also contains its canonical `parentId`. SharePoint's
`SP.File` resource does not expose `ParentFolder`, so the Angular adapter preserves
the renamed file's unchanged `parentId` from the source node.

## Required semantics

Rename changes only the leaf name:

- the file or folder remains in the same parent;
- `UniqueId`, `listKey`, `parentId`, creation time, file content, and folder contents
  remain unchanged;
- `Name` and `ServerRelativeUrl` change;
- SharePoint owns the resulting `TimeLastModified` and editor identity;
- an existing sibling with the requested name is a collision error;
- SharePoint must not generate `name (1)`, overwrite the sibling, or move the item.

The frontend is pessimistic: it changes no cached node until the backend returns the
canonical renamed node.

## Why `FileLeafRef`, not `MoveTo`

A SharePoint file or folder in a document library has an underlying list item.
`FileLeafRef` is its actual leaf name. Rename therefore updates the item's
`FileLeafRef` through `ListItemAllFields`.

Do not implement rename with `MoveTo` or `MoveToUsingPath`. Those methods combine
relocation and rename, require a complete destination path, and return no canonical
file/folder body. They remain candidates for the separate move operation.

Do not update `Title` automatically. `Title` is independent metadata and may
intentionally differ from the physical file/folder name.

Microsoft documents folder rename as a `MERGE` of `FileLeafRef`, and PnP uses the same
list-item update:

- [Working with folders and files with REST](https://learn.microsoft.com/en-us/sharepoint/dev/sp-add-ins/working-with-folders-and-files-with-rest)
- [PnP/PnPjs folder rename](https://pnp.github.io/pnpjs/sp/folders/#rename-a-folder)

## Backend resolution and guards

1. Validate `projectId`, `listKey`, `documentId`, `kind`, and `name`
   before contacting SharePoint.
2. Reject a blank name, `.`, `..`, path separators, and names rejected by the domain
   name-validation rules.
3. Resolve `(projectId, listKey)` through backend-owned project configuration to at
   least `{ siteUrl, libraryId, rootFolderId }`. This is not a SharePoint discovery
   request and may be served from the backend database/cache.
4. Reject `kind=folder` with `documentId === rootFolderId`.
5. Authorize the caller for rename in the project/document list.
6. Select the SharePoint by-id endpoint from `kind`. Do not issue a preliminary GET to
   rediscover the type, path, list-item id, OData entity type, or ETag.

The request does not contain `parentId`: rename does not change the parent, and
`documentId` already selects the SharePoint object.

## SharePoint request 1: rename

Folder:

    POST {siteUrl}/_api/web/GetFolderById('{documentId}')/ListItemAllFields
    Authorization: Bearer {cached access token}
    Accept: application/json;odata=nometadata
    Content-Type: application/json;odata=nometadata
    X-HTTP-Method: MERGE
    If-Match: *

    {
      "FileLeafRef": "Renamed folder"
    }

File:

    POST {siteUrl}/_api/web/GetFileById('{documentId}')/ListItemAllFields
    Authorization: Bearer {cached access token}
    Accept: application/json;odata=nometadata
    Content-Type: application/json;odata=nometadata
    X-HTTP-Method: MERGE
    If-Match: *

    {
      "FileLeafRef": "Renamed document.docx"
    }

Construct the body as JSON through the Feign DTO/serializer. Do not interpolate the
new name into an OData URL.

`If-Match: *` means that the backend does not perform a preliminary ETag lookup. It
does not authorize overwriting a sibling with the requested name; SharePoint still
reports a name collision.

The expected successful response is:

    204 No Content

An empty response body is normal. Do not treat the absence of content as a failure,
and do not expect `Prefer: return=representation` to provide the canonical node.

## SharePoint request 2: canonical read

Only after the rename returns a successful `204`, read the same object by its unchanged
`UniqueId`.

Folder:

    GET {siteUrl}/_api/web/GetFolderById('{documentId}')
        ?$select=UniqueId,Name,ServerRelativeUrl,ItemCount,TimeCreated,TimeLastModified,ParentFolder/UniqueId,ListItemAllFields/Editor/Title
        &$expand=ParentFolder,ListItemAllFields/Editor
    Authorization: Bearer {cached access token}
    Accept: application/json;odata=nometadata

File:

    GET {siteUrl}/_api/web/GetFileById('{documentId}')?$select=UniqueId,Name,ServerRelativeUrl,Length,TimeCreated,TimeLastModified,ListItemAllFields/Editor/Title&$expand=ListItemAllFields/Editor
    Authorization: Bearer {cached access token}
    Accept: application/json;odata=nometadata

This read is required by the current canonical-node contract. Without it, the backend
would have to calculate the path from possibly stale client state and would retain
stale `modifiedAt` / `modifiedBy` values.

For a folder, `$expand=ParentFolder` is required. Include
`ParentFolder/UniqueId` in `$select` and map the expanded value to the domain
`parentId`.

`SP.File` does not expose that navigation property. Do not add `ParentFolder` to the
file query and do not add another SharePoint request merely to resolve a parent that
cannot change during rename.

## Canonical response mapping

Folder:

    kind       <- constant "folder"
    listKey    <- domain route
    id         <- SharePoint UniqueId
    path       <- SharePoint ServerRelativeUrl
    name       <- SharePoint Name
    parentId   <- SharePoint ParentFolder.UniqueId
    itemCount  <- SharePoint ItemCount
    createdAt  <- SharePoint TimeCreated
    modifiedAt <- SharePoint TimeLastModified
    modifiedBy <- SharePoint ListItemAllFields.Editor.Title, when present

File:

    kind        <- constant "file"
    listKey     <- domain route
    id          <- SharePoint UniqueId
    path        <- SharePoint ServerRelativeUrl
    name        <- SharePoint Name
    parentId    <- not returned by the backend; preserve source node.parentId in Angular
    sizeBytes   <- SharePoint Length, parsed as a number
    createdAt   <- SharePoint TimeCreated
    modifiedAt  <- SharePoint TimeLastModified
    modifiedBy  <- SharePoint ListItemAllFields.Editor.Title, when present

The file response omits `parentId`; the Angular adapter adds the source file's
unchanged `parentId` while mapping the response to `FileNode`. This is safe because
rename cannot move the file. It also avoids trusting client relationship data in the
backend request or adding a third SharePoint call solely to translate the parent path
into a folder GUID.

Other optional properties that are not returned by this canonical read may be omitted
or preserved by the Angular adapter from the unchanged source node when the domain
model allows it. Never fabricate `modifiedAt`, `modifiedBy`, `Name`, or
`ServerRelativeUrl`.

## Existing authentication and call count

- Reuse the backend's existing authenticated Feign client and cached per-user,
  certificate-backed OAuth bearer-token interceptor.
- Do not add another token cache or authentication flow.
- Do not add form-digest caching, an `X-RequestDigest` header, or calls to
  `POST {siteUrl}/_api/contextinfo`.
- A successful rename performs exactly **two backend-to-SharePoint requests**:
  one `MERGE` followed by one canonical GET.
- A rejected/failed `MERGE` performs no canonical GET.
- Do not perform a preliminary metadata, type, path, ETag, or collision lookup.

## Post-write read failure

The rename is already committed when request 1 returns `204`. If the canonical GET
then fails:

1. Never automatically repeat the successful `MERGE`.
2. Retry only the idempotent GET according to the backend's existing transient-read
   retry policy and SharePoint `Retry-After` guidance.
3. If the GET still fails, log that the mutation succeeded but canonical hydration
   failed, including both SharePoint correlation details.
4. Return an error that causes the frontend to refresh/reload the parent listing.
   Do not claim that the rename was rolled back.

This is a partial-response failure, not a failed rename.

## Error mapping

- Invalid route/body input or invalid name -> HTTP 400 / `invalid-name`.
- Root-folder rename attempt -> HTTP 400 / `invalid-name`.
- SharePoint not-found (`-2147024894` or HTTP 404) -> HTTP 404 / `not-found`.
- SharePoint name collision (`-2147024713`, a collision-specific HTTP 409, or
  equivalent target-environment error) -> HTTP 409 / `name-collision`.
- SharePoint 401/403 -> HTTP 403 / `permission-denied`.
- SharePoint 429 -> propagate retry timing where available and map to the frontend's
  retryable `network` failure.
- Locked/checked-out file failures are not name collisions. Preserve their technical
  reason in backend logs and map them through the application's closest supported
  domain error until a dedicated lock error is introduced.
- Transport/unavailable failures before a confirmed `204` -> retryable `network`
  failure.
- Any unrecognized SharePoint failure -> `unknown`; retain technical details and
  SharePoint correlation ids in backend logs.
- On a failed `MERGE`, return no success node and leave frontend state unchanged.

## Frontend mapping

The Angular adapter extracts:

    projectId  <- ProjectDocuments input
    listKey    <- node.listKey
    documentId <- node.id
    kind       <- node.kind
    name       <- requested new name

For a file, the adapter maps the backend response with
`parentId: sourceNode.parentId`. For a folder, it uses the returned
`ParentFolder.UniqueId`. After mapping, `FileSystemStore` replaces the node and
repaths already-cached descendants when a folder was renamed. The node's stable
`UniqueId`, `listKey`, and parent relationship do not change.

Name collisions and invalid names remain inline errors. Initial or transient network
failures use the existing retry notification behavior.

## Backend acceptance checklist

- Both files and folders rename through `ListItemAllFields/FileLeafRef`.
- Root folders are rejected before SharePoint.
- The authenticated Feign client is reused.
- No context-info/form-digest, ETag lookup, type lookup, or collision lookup is added.
- A successful MERGE `204` is treated as success.
- The canonical GET runs only after a successful MERGE.
- The backend returns SharePoint's `UniqueId`, `Name`, `ServerRelativeUrl`,
  `TimeLastModified`, and editor identity.
- Folder `parentId` comes from `ParentFolder.UniqueId`; file `parentId` is preserved
  by the Angular adapter because `SP.File` has no `ParentFolder`.
- Name collisions never overwrite or auto-suffix.
- A failed canonical GET never causes the successful MERGE to be repeated.
