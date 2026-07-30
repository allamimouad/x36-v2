# COPY Document

> **Status: controller integration pending; the backend already contains a service
> that copies a SharePoint item and retrieves the created result.** This is the
> operation-specific companion to the
> [backend endpoint overview](../backend-endpoints.md).

## Scope

This task exposes the existing copy capability through the backend's existing document
controller.

The copy service already performs the SharePoint copy and the follow-up lookup needed
to return the created file. Reuse that service. Do not reimplement or duplicate its
copy request, `KeepBoth` handling, time/name filtering, latest-item lookup,
authentication, or SharePoint client calls.

The implementation may make small adaptations to the existing service method
signature, request DTO, or response mapping when required by the public controller
contract. Keep those changes inside the existing controller/service/client/mapper
structure. Do not create a new service, SharePoint client, mapper, token cache,
configuration flow, database table, scheduler, or parallel copy implementation.

If an equivalent controller route already exists, adapt it rather than adding a
duplicate.

## Domain endpoint

    POST /projects/{projectId}/document-lists/{sourceListKey}/documents/copy
    Content-Type: application/json

    {
      "kind": "file",
      "sourcePath": "/sites/project/Documents/report.pdf",
      "sourceName": "report.pdf",
      "targetListKey": "marketing",
      "targetParentId": "target-folder-guid",
      "targetParentPath": "/sites/project/Marketing/Target"
    }

- `sourceListKey`: `execution` or `marketing`; it supplies the source list context.
- `kind`: `file` or `folder`.
- `sourcePath`: the source node's decoded canonical path.
- `sourceName`: the source node's canonical leaf name, including its extension when it
  is a file.
- `targetListKey`: the destination list context. It may equal `sourceListKey`.
- `targetParentId`: the destination folder's id.
- `targetParentPath`: the destination folder's decoded canonical path.

Do not add a source `documentId` merely for route consistency if the existing
path-based service does not use it. An unused id must not trigger a new SharePoint
lookup. If the existing service genuinely requires an id, preserve that established
parameter instead of adding a second competing contract.

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

## Controller responsibilities

The controller should only:

1. Bind and validate route/body values.
2. Delegate once to the existing copy service.
3. Pass the source and destination context expected by that existing service.
4. Return its mapped canonical result as `201 Created`.
5. Let the existing global exception handling produce the public error response.

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
- same-folder copy naming;
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
logic. Keep only one public copy route and one service implementation.

## Required behavior

- Copy leaves the source unchanged.
- The returned copy has a new SharePoint id.
- Copying between different folders initially keeps the source name.
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
    sourceListKey    <- sourceNode.listKey
    kind             <- sourceNode.kind
    sourcePath       <- sourceNode.path
    sourceName       <- sourceNode.name
    targetListKey    <- targetParent.listKey
    targetParentId   <- targetParent.id
    targetParentPath <- targetParent.path

It maps the returned file/folder response through the existing frontend mapper.
`FileSystemStore` remains pessimistic: only after success does it insert the copied
node, update the target parent count, and invalidate the destination listing.

## Acceptance checklist

- The new/existing controller route delegates to the existing copy service.
- No new service, SharePoint client, mapper, or authentication flow is introduced.
- Working service internals are reused instead of rewritten from this document.
- No unused source id or new SharePoint preflight lookup is added.
- File copy returns the canonical copied file.
- Repeated same-folder file copy keeps every copy.
- Folder copy returns the canonical copied folder and preserves its complete subtree,
  including empty descendants.
- Execution-to-Marketing and Marketing-to-Execution copies are tested where the
  configured environment supports them.
- Spaces, apostrophes, `%`, and `#` are covered.
- A service failure is translated through the existing global error handling.
- A post-copy lookup failure never causes the controller to invoke copy a second time.
