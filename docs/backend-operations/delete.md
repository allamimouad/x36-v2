# DELETE Document

> **Status: contract agreed; frontend alignment implemented, backend pending.** This is the
> operation-specific companion to the [backend endpoint overview](../backend-endpoints.md).

## Domain endpoint

    DELETE /projects/{projectId}/document-lists/{listKey}/documents/{documentId}?kind={kind}

- `listKey`: `execution` or `marketing`; required because the two lists may use
  different SharePoint sites.
- `documentId`: the node's SharePoint `UniqueId` GUID.
- `kind`: `file` or `folder`; required because SharePoint has distinct by-id APIs.
- No request body. `path` is deliberately not sent or used for delete.

Successful response:

    204 No Content

## Backend resolution and guards

1. Validate `projectId`, `listKey`, `documentId`, and `kind` before contacting SharePoint.
2. Resolve `(projectId, listKey)` through backend-owned project configuration to at
   least `{ siteUrl, libraryId, rootFolderId }`. This is not a SharePoint discovery
   request and may be served from the backend database/cache.
3. Reject `documentId === rootFolderId`; document-list roots cannot be deleted.
4. Authorize the caller for the project/list delete operation.
5. Select the SharePoint file or folder API from `kind`. Do not issue a preliminary GET
   to rediscover the node type or path.

## SharePoint request

The target environment has been verified manually in Postman to support direct DELETE
against both `GetFileById` and `GetFolderById`.

File:

    DELETE {siteUrl}/_api/web/GetFileById('{documentId}')
    Authorization: Bearer {cached access token}
    Accept: application/json
    If-Match: *

Folder (SharePoint deletes the folder subtree; the backend must not walk it itself):

    DELETE {siteUrl}/_api/web/GetFolderById('{documentId}')
    Authorization: Bearer {cached access token}
    Accept: application/json
    If-Match: *

Implement these requests through the backend's existing authenticated Feign client,
the same client and configuration already used by the working SharePoint copy operation.
The existing Feign authentication interceptor supplies the cached per-user OAuth bearer
token. Do not hand-write SharePoint HTTP or authentication in the Angular feature.
Normalize any successful SharePoint delete response to the domain API's empty
`204 No Content`.

## Existing authentication and call count

- Authentication and token caching are existing backend infrastructure, not part of the
  delete implementation. Reuse the configured Feign client and its bearer-token
  interceptor; do not add another token cache or authentication flow.
- The working copy operation is the reference implementation for Feign client selection
  and authentication behavior.
- Do not add form-digest caching, an `X-RequestDigest` header, or calls to
  `POST {siteUrl}/_api/contextinfo`. The target environment's certificate-backed OAuth
  bearer flow already authorizes SharePoint mutations.
- A delete performs exactly **one backend-to-SharePoint request**: the direct DELETE
  above. The frontend-to-backend domain request is outside this SharePoint call count.
- Do not perform a preliminary metadata lookup. `kind` already selects the file or
  folder endpoint.

## Error mapping

- Invalid route/query input -> HTTP 400.
- SharePoint 401/403 -> HTTP 403 / `permission-denied`. Existing authentication
  infrastructure owns token acquisition and refresh behavior.
- SharePoint not-found (`-2147024894` or HTTP 404) -> HTTP 404 / `not-found`.
- SharePoint 429 -> propagate retry timing where available and map to the frontend's
  retryable `network` failure.
- Transport/unavailable failures -> retryable `network` failure.
- Any unrecognized SharePoint failure -> `unknown`; retain SharePoint correlation and
  technical details in backend logs, not in the user-facing message.
- On every failure, return no success response and leave frontend state unchanged.

## Frontend mapping

The frontend domain model now carries `listKey` on every file/folder node. The adapter
obtains all routing values from the project and selected node:

    projectId  <- ProjectDocuments input
    listKey    <- node.listKey
    documentId <- node.id
    kind       <- node.kind

`FileSystemStore` remains pessimistic: it removes the cached node/subtree and decrements
the parent count only after the backend returns 204. The real HTTP call in
`SharePointFileSystemApi` remains pending; its node-based delete signature already has
the required values.
