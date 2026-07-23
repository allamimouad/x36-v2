# CREATE Folder

> **Status: contract agreed; frontend server-first flow implemented, backend pending.**
> This is the operation-specific companion to the
> [backend endpoint overview](../backend-endpoints.md).

## Domain endpoint

    POST /projects/{projectId}/document-lists/{listKey}/documents/{parentFolderId}/folders
    Content-Type: application/json

    {
      "name": "New folder"
    }

- `listKey`: `execution` or `marketing`; required because the two lists may use
  different SharePoint sites.
- `parentFolderId`: the destination parent folder's SharePoint `UniqueId` GUID.
- `name`: the requested decoded folder name. The New folder UI sends exactly
  `New folder`.
- Do not accept a SharePoint site URL, library id, path, access token, or
  `EnsureUniqueFileName` flag from the frontend.

Successful response:

    201 Created
    Content-Type: application/json

    {
      "kind": "folder",
      "listKey": "execution",
      "id": "sharepoint-returned-unique-id",
      "path": "/sites/project/Documents/New folder (1)",
      "name": "New folder (1)",
      "parentId": "parent-folder-guid",
      "itemCount": 0,
      "createdAt": "2026-07-24T10:30:00Z",
      "modifiedAt": "2026-07-24T10:30:00Z"
    }

The response is the canonical persisted folder returned by SharePoint. In particular,
the backend must not assume that the persisted name equals the requested name.

## Required semantics

Folder creation is server-first and collision-safe:

1. The frontend requests the default name `New folder`.
2. SharePoint creates the folder and atomically selects a unique name.
3. If the requested name already exists, SharePoint may return `New folder (1)`,
   `New folder (2)`, and so on.
4. The backend returns that canonical SharePoint folder.
5. Only after success does the frontend insert the folder and start inline rename.

Do not perform an existence check, list the parent's children, calculate a numeric
suffix in Java, retry with another name, or use the legacy `Folders/Add` endpoint.
Those approaches add calls and introduce a race between checking and creating.

## Backend resolution and guards

1. Validate `projectId`, `listKey`, `parentFolderId`, and `name` before contacting
   SharePoint.
2. Reject a blank name and names rejected by the domain name-validation rules.
3. Resolve `(projectId, listKey)` through backend-owned project configuration to at
   least `{ siteUrl, libraryId, rootFolderId }`. This is not a SharePoint discovery
   request and may be served from the backend database/cache.
4. Authorize the caller for folder creation in that project/document list.
5. Treat `parentFolderId` as a folder id. Do not issue a preliminary SharePoint GET
   merely to rediscover its type or path.

The parent node must come from the same list-scoped hierarchy represented by
`(projectId, listKey)`. Preserve the backend's existing list-scoping and authorization
invariant, but do not invent an additional SharePoint preflight request solely for this
operation.

There is no special route for creating directly inside a document list. A SharePoint
document library exposes a root folder, and the frontend represents that root as a
`FolderNode` whose `id` is the root folder's SharePoint `UniqueId`:

    list root     -> parentFolderId = rootFolder.id
    nested folder -> parentFolderId = currentFolder.id

Both cases use the same domain endpoint and the same SharePoint request.

The fixed UI name contains no apostrophe. If this domain endpoint is reused with an
arbitrary name, construct the OData string literal with the backend's established URI
builder: escape a literal apostrophe as `''`, then let the HTTP client perform transport
percent-encoding. Do not pre-encode the logical `DecodedUrl` value as a SharePoint path.

## SharePoint request

Use the parent's folder collection and SharePoint's `AddUsingPath` bound function:

    POST {siteUrl}/_api/web/GetFolderById('{parentFolderId}')/Folders/AddUsingPath(DecodedUrl='New folder',EnsureUniqueFileName=true)
    Authorization: Bearer {cached access token}
    Accept: application/json
    Content-Type: application/json

There is no SharePoint request body.

The SharePoint REST service metadata exposes the folder overload as:

    AddUsingPath(
        this: Collection(SP.Folder),
        DecodedUrl: Edm.String,
        EnsureUniqueFileName: Edm.Boolean,
        Overwrite: Edm.Boolean
    ) -> SP.Folder

For this workflow:

- send `EnsureUniqueFileName=true`;
- omit `Overwrite` entirely;
- do not call the legacy `Folders/Add`;
- do not send `If-Match`;
- do not add an `X-RequestDigest`.

The metadata can be inspected through the
[SharePoint REST API Metadata Explorer](https://s-kainet.github.io/sp-rest-explorer/#/_api/web/Folders/AddUsingPath).
The explorer is third-party, but it is generated from SharePoint Online's official
`GET /_api/$metadata` service document. The target SharePoint environment has also
been manually verified to create numeric-suffixed folders with
`EnsureUniqueFileName=true`.

Implement the request through the backend's existing authenticated Feign client, using
the working copy and delete operations as local examples for client selection and
error extraction. The Feign authentication interceptor supplies the bearer token.

## SharePoint response mapping

Map SharePoint's returned `SP.Folder` directly to the domain `FolderNode`:

    kind       <- constant "folder"
    listKey    <- domain route
    id         <- SharePoint UniqueId
    path       <- SharePoint ServerRelativeUrl
    name       <- SharePoint Name
    parentId   <- parentFolderId from domain route
    itemCount  <- SharePoint ItemCount (a new folder is normally 0)
    createdAt  <- SharePoint TimeCreated
    modifiedAt <- SharePoint TimeLastModified
    modifiedBy <- SharePoint value when already present; otherwise omit

`UniqueId`, `Name`, and `ServerRelativeUrl` are authoritative. Never reconstruct the
id, path, or name from `parentFolderId` and the requested name. In particular, returning
`name: "New folder"` when SharePoint created `New folder (1)` breaks the immediate
inline-rename workflow.

Do not add a second SharePoint GET just to enrich optional response properties. If the
create response does not include optional `modifiedBy`, omit it. `itemCount` may safely
be normalized to `0` for the newly created empty folder if the response omits it.

## Existing authentication and call count

- Authentication and token caching are existing backend infrastructure, not part of
  folder creation. Reuse the configured Feign client and its cached per-user,
  certificate-backed OAuth bearer-token interceptor.
- Do not add another token cache or authentication flow.
- Do not add form-digest caching, an `X-RequestDigest` header, or calls to
  `POST {siteUrl}/_api/contextinfo`.
- A create performs exactly **one backend-to-SharePoint request**: the
  `AddUsingPath` POST above. The frontend-to-backend domain request is outside this
  SharePoint call count.
- Do not perform a preliminary metadata, parent, or collision lookup.

## Error mapping

- Invalid route/body input or an invalid folder name -> HTTP 400 / `invalid-name`
  where applicable.
- Missing parent -> HTTP 404 / `not-found`.
- SharePoint 401/403 -> HTTP 403 / `permission-denied`. Existing authentication
  infrastructure owns token acquisition and refresh behavior.
- SharePoint 429 -> propagate retry timing where available and map to the frontend's
  retryable `network` failure.
- Transport/unavailable failures -> retryable `network` failure.
- Any unrecognized SharePoint failure -> `unknown`; retain SharePoint correlation and
  technical details in backend logs, not in the user-facing message.
- A collision with the requested default name is not an error:
  `EnsureUniqueFileName=true` resolves it and the canonical suffixed folder is returned.
- On every actual failure, return no success object. The pessimistic frontend has not
  inserted anything and therefore needs no rollback.

## Frontend mapping

The adapter obtains the routing and request values from the project and parent node:

    projectId <- ProjectDocuments input
    listKey   <- parent.listKey
    parentFolderId <- parent.id
    name      <- "New folder"

`FileSystemStore` remains pessimistic. After the backend returns the canonical
`FolderNode`, it inserts that exact node, increments the parent's `itemCount`, focuses
the new folder, and enters inline rename with the returned name selected.

If the user cancels inline rename, the already-persisted default folder remains. If
the user submits another name, that is a separate rename operation. The create
operation must not wait for the rename result.

## Backend acceptance checklist

- One domain POST produces one SharePoint POST.
- The authenticated Feign client is reused.
- No context-info/form-digest request is introduced.
- No preliminary existence or parent lookup is introduced.
- `AddUsingPath` receives `EnsureUniqueFileName=true` and no `Overwrite`.
- Repeated requests create distinct folders with SharePoint-selected names.
- The response uses SharePoint's returned `UniqueId`, `Name`, and
  `ServerRelativeUrl`.
- A SharePoint failure produces no `FolderNode`.
