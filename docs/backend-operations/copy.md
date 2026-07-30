# COPY Document

> **Status: the controller and copy service already exist. The required backend
> change is to simplify the controller request body while preserving the existing
> copy and post-copy lookup logic.** This is the operation-specific companion to the
> [backend endpoint overview](../backend-endpoints.md).

## Scope

This task changes the public request DTO accepted by the existing copy controller.

The copy service already performs the SharePoint copy and the follow-up lookup needed
to return the created item. Reuse that service. Do not reimplement or duplicate its
copy request, `KeepBoth` handling, time/name filtering, latest-item lookup,
authentication, or SharePoint client calls.

The implementation may map the simplified controller DTO to the existing service
arguments and make the smallest necessary service-signature adaptation. Keep those
changes inside the existing controller/service/client/mapper structure. Do not create
a new service, SharePoint client, mapper, token cache, configuration flow, database
table, scheduler, or parallel copy implementation.

Keep the existing controller route and adapt its request DTO. Do not add a second
controller or a second copy endpoint.

## Domain endpoint

    POST /projects/{projectId}/documents/copy
    Content-Type: application/json

    {
      "kind": "file",
      "sourceParentPath": "/sites/project/Documents",
      "sourceName": "report.pdf",
      "targetListKey": "marketing",
      "targetParentId": "target-folder-guid",
      "targetParentPath": "/sites/project/Marketing/Target"
    }

- `kind`: `file` or `folder`. One value is sufficient because copying does not change
  the item's kind.
- `sourceParentPath`: the source parent folder's decoded canonical
  `ServerRelativeUrl`. It already identifies the source site and document library.
- `sourceName`: the source node's canonical leaf name, including its extension when it
  is a file.
- `targetListKey`: the destination domain list key, `execution` or `marketing`.
  SharePoint does not return this application-owned value, so the backend uses it to
  populate the copied node's response.
- `targetParentId`: the destination folder's id, retained because the existing service
  uses it for the canonical post-copy lookup and because it becomes the copied node's
  `parentId`.
- `targetParentPath`: the destination folder's decoded canonical
  `ServerRelativeUrl`. It already identifies the destination site and document
  library.

Replace the more complicated nested DTO:

    {
      "source": { "kind": "...", "id": "...", "path": "...", "name": "..." },
      "destination": { "kind": "...", "id": "...", "path": "...", "name": "..." }
    }

Do not retain the nested DTO as a second public contract unless backward compatibility
is an explicit requirement. Source/destination ids that the existing copy operation
does not use, the duplicated destination `kind`, the source list key already identified
by the full source path, and a destination name that merely repeats `sourceName` do not
belong in the new request. `targetListKey` is not redundant response metadata: the
complete paths identify SharePoint locations, but they do not produce the frontend's
application-owned destination list key.

There is no `targetName` in this requirement. The existing backend logic compares the
normalized `sourceParentPath` and `targetParentPath`:

- different parent folders -> use `sourceName` unchanged; do not add ` - Copy`;
- the same parent folder -> use the File-Explorer copy form, such as
  `report - Copy.pdf`;
- if the selected name already exists -> let the existing `KeepBoth` collision logic
  choose the next available name without overwriting anything.

The frontend must not make this choice or predict a numbered final name. Both parent
paths are already present in the request, and concurrent copies can make a frontend
prediction stale. The canonical response supplies the actual final name.

Do not add a source `documentId` merely for route consistency if the existing
path-based service does not use it. An unused id must not trigger a new SharePoint
lookup. If the existing service genuinely requires an internal id, preserve it only
inside the established service contract instead of exposing it in this public DTO.

The frontend must not send SharePoint credentials, access tokens, backend
configuration, OData filters, copy timestamps, ordering, or page sizes.

## Successful response

Return:

    201 Created
    Content-Type: application/json

File example:

    {
      "kind": "file",
      "listKey": "marketing",
      "id": "new-sharepoint-unique-id",
      "path": "/sites/project/Marketing/Target/report.pdf",
      "name": "report.pdf",
      "parentId": "target-folder-guid",
      "sizeBytes": 4096,
      "createdAt": "2026-07-30T10:30:00Z",
      "modifiedAt": "2026-07-30T10:30:00Z",
      "modifiedBy": "User Display Name"
    }

A folder response uses the existing folder-node response shape with `itemCount` in
place of `sizeBytes`.

Return the exact canonical result produced by the existing copy service. Do not
reconstruct the new id, final collision-resolved name, path, timestamps, or editor in
the controller.

Complete the domain response mapping as follows:

    kind       <- request.kind
    listKey    <- request.targetListKey
    parentId   <- request.targetParentId
    id         <- SharePoint UniqueId from the post-copy lookup
    path       <- SharePoint ServerRelativeUrl from the post-copy lookup
    name       <- SharePoint Name from the post-copy lookup
    createdAt  <- SharePoint TimeCreated from the post-copy lookup
    modifiedAt <- SharePoint TimeLastModified from the post-copy lookup
    modifiedBy <- SharePoint ListItemAllFields.Editor.Title, when present

For a file:

    sizeBytes <- SharePoint Length, parsed as a number

For a folder:

    itemCount <- SharePoint ItemCount

`contentType` and `downloadUrl` remain optional. Do not default a copied folder's
`itemCount` to `0`: a recursive copy may already contain files and folders. If the
existing post-copy query does not select a required canonical field, extend that
existing query rather than constructing the value in the controller.

## Controller responsibilities

The controller should only:

1. Bind and validate route/body values.
2. Delegate once to the existing copy service.
3. Map the simplified body to the source and destination arguments expected by that
   existing service.
4. Add the request-owned destination metadata (`targetListKey` and `targetParentId`)
   to the canonical copied result through the existing mapper/service return path.
5. Return its mapped canonical result as `201 Created`.
6. Let the existing global exception handling produce the public error response.

The controller must not:

- call SharePoint directly;
- implement name-suffix or ` - Copy` logic;
- construct OData filters;
- query the destination folder;
- select the most recently modified file/folder;
- acquire or refresh a SharePoint token;
- catch and flatten every exception into a generic `400`;
- retry a copy mutation after the existing service reports that the copy itself
  succeeded.

Keep controller code consistent with the already implemented create, rename, delete,
and upload methods. Use the existing request-validation and OpenAPI annotation style.

## Existing service contract

Inspect the existing copy service before changing any controller or DTO. Its current
logic is the source of truth for:

- building source and destination SharePoint URLs;
- native file-copy behavior;
- native folder-copy behavior, if already present;
- comparing the source and target parents and choosing whether to use the unchanged
  source name or the same-folder ` - Copy` form;
- `KeepBoth` collision behavior;
- recording copy start time;
- querying the destination parent by id;
- filtering by modification time and source/destination name prefix;
- ordering by most recent modification and taking the first result;
- mapping the copied SharePoint response.

Call that existing method rather than reproducing these steps in the controller.

If the service currently supports files only, add folder support to the same service
and existing authenticated SharePoint client. Do not introduce a folder-copy service
beside it.

If the service already accepts slightly different argument names or a consolidated
request object, prefer a small controller-to-service mapping over rewriting working
logic. Do not make the public DTO mirror an internal service object when those extra
fields are unused. Keep only one public copy route and one service implementation.

## Required behavior

- Copy leaves the source unchanged.
- The returned copy has a new SharePoint id.
- Copying between different folders keeps the source name and does not proactively add
  ` - Copy`.
- Copying into the current folder must behave like File Explorer, beginning with a
  name such as `report - Copy.pdf`.
- Repeated paste operations keep every copy with collision-resolved names.
- Existing destination items are not overwritten.
- Folder copy is recursive and preserves nested files, nested folders, and empty
  descendants.
- Copy can use the same source/destination list or different Execution and Marketing
  lists when supported by the configured SharePoint environment.
- The controller returns no success body when the existing service reports a failure.

## Error behavior

Preserve the existing exception translation:

- invalid route/body input -> HTTP 400;
- missing source or destination -> HTTP 404 / `not-found`;
- permission failure -> HTTP 403 / `permission-denied`;
- throttling or transport failure -> the existing retryable network error;
- unrecognized SharePoint failure -> the existing unknown-error response.

Do not expose tokens, internal site configuration, raw Feign exceptions, or
SharePoint-only diagnostic details in the public response.

The existing service performs a copy followed by a lookup of the newly created item.
If that lookup fails after copy succeeded, do not repeat the copy mutation. Preserve
the service's existing partial-success handling and make the frontend refresh the
destination when appropriate.

## Frontend mapping

The Angular adapter obtains the request values from the existing domain nodes:

    projectId        <- ProjectDocuments input
    kind             <- sourceNode.kind
    sourceParentPath <- decoded parent portion of sourceNode.path
    sourceName       <- sourceNode.name
    targetListKey    <- targetParent.listKey
    targetParentId   <- targetParent.id
    targetParentPath <- targetParent.path

The adapter does not send `sourceNode.id`, `sourceNode.listKey`, a destination `kind`,
or a destination name. The complete server-relative parent paths already identify
both SharePoint sites and document libraries for the copy call. The target list key is
sent only because the returned domain node requires it and SharePoint does not provide
it. Deriving `sourceParentPath` from `sourceNode.path` is a local path operation and
requires no backend lookup.

It maps the returned file/folder response through the existing frontend mapper.
`FileSystemStore` remains pessimistic: only after success does it insert the copied
node, update the target parent count, and invalidate the destination listing.

## Acceptance checklist

- The existing `POST /projects/{projectId}/documents/copy` route remains the only copy
  route and delegates once to the existing copy service.
- Its public request contains exactly `kind`, `sourceParentPath`, `sourceName`,
  `targetListKey`, `targetParentId`, and `targetParentPath`.
- The old nested source/destination DTO is replaced rather than extended.
- No new service, SharePoint client, mapper, or authentication flow is introduced.
- Working service internals are reused instead of rewritten from this document.
- No source list key, unused source id, duplicated destination kind/name, or new
  SharePoint preflight lookup is added to the public request.
- The response maps `listKey` from `targetListKey` and `parentId` from
  `targetParentId`.
- A copied file returns its canonical `sizeBytes`; a copied folder returns its real
  `itemCount` rather than a fabricated zero.
- The frontend does not calculate the final copied name.
- File copy returns the canonical copied file.
- Repeated same-folder file copy keeps every copy.
- Folder copy returns the canonical copied folder and preserves its complete subtree,
  including empty descendants.
- Execution-to-Marketing and Marketing-to-Execution copies are tested where the
  configured environment supports them.
- Spaces, apostrophes, `%`, and `#` are covered.
- A service failure is translated through the existing global error handling.
- A post-copy lookup failure never causes the controller to invoke copy a second time.
