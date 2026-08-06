# UPLOAD File with HTTP Streaming

> **Status: backend transport contract; backend and frontend pending.**
> This is the operation-specific companion to the
> [backend endpoint overview](../backend-endpoints.md).

## Implementation rule

This operation belongs in an existing backend. Inspect the implemented create-folder,
rename, and delete flows and retain their:

- domain controller and service structure;
- `(projectId, listKey)` configuration resolution;
- authorization;
- token service and token cache;
- SharePoint DTOs and domain mapping;
- validation, exception translation, and public error format.

Do not create replacement routing, mapping, authentication, or error-handling
architectures for upload.

The only transport-specific addition is a direct streaming SharePoint request because
the normal Spring Cloud OpenFeign encoder buffers request bodies. Keep that addition
focused on executing this upload request; it must reuse the backend's existing
configuration and token provider.

## Domain endpoint

    POST /projects/{projectId}/document-lists/{listKey}/documents/{parentFolderId}/files?name={encodedFileName}
    Content-Type: application/octet-stream
    Content-Length: {fileSize}

    {raw file bytes}

- `listKey`: `EXECUTION` or `MARKETING`.
- `parentFolderId`: the destination folder's SharePoint `UniqueId` GUID.
- `name`: the decoded file name, including its extension.
- The request body is the file itself, not JSON, Base64, multipart, or `FormData`.
- Do not accept SharePoint routing information, credentials, an overwrite flag, or an
  upload id from the frontend.

Successful response:

    201 Created
    Content-Type: application/json

    {
      "kind": "file",
      "listKey": "EXECUTION",
      "id": "sharepoint-returned-unique-id",
      "path": "/sites/project/Documents/report.pdf",
      "name": "report.pdf",
      "parentId": "parent-folder-guid",
      "sizeBytes": 123456,
      "createdAt": "2026-07-29T10:15:30Z",
      "modifiedAt": "2026-07-29T10:15:30Z",
      "modifiedBy": "User Display Name"
    }

Return the backend's existing canonical file response shape.

## Required semantics

1. Validate the route, destination, decoded file name, content type, and declared size
   using existing backend rules.
2. Resolve and authorize `(projectId, listKey)` through the same path as the implemented
   document operations.
3. Obtain the servlet request `InputStream` without converting it to `byte[]`.
4. Use that stream as the body of one outgoing SharePoint `Files/AddUsingPath` request.
5. Reuse the existing token service to add the bearer token to that request.
6. Map the returned `SP.File` through existing mapping conventions.
7. Return `201` only after SharePoint confirms success.

Do not create an empty file first. Do not use `StartUpload`, `ContinueUpload`, or
`FinishUpload`. Do not add an upload session, database table, scheduler, cleanup job,
or load-balancer stickiness.

## Backend resolution and guards

Follow the same guards used by the implemented document operations:

1. Validate `projectId`, `listKey`, `parentFolderId`, and `name`.
2. Reject blank or invalid file names, path separators, `.` and `..`.
3. Resolve backend-owned SharePoint configuration for `(projectId, listKey)`.
4. Authorize upload to the selected document list.
5. Treat `parentFolderId` as the destination folder id without a preliminary
   SharePoint lookup.
6. Require a known `Content-Length` for the first streaming implementation and return
   `411 Length Required` when it is unavailable.
7. Reject a declared size above the backend's configured SharePoint maximum before
   opening the outgoing request.

A browser sending a `File` or `Blob` as the raw request body normally supplies its
length automatically. The frontend must not attempt to set the restricted
`Content-Length` header itself.

## SharePoint request

Send:

    POST {siteUrl}/_api/web/GetFolderById('{parentFolderId}')/Files/AddUsingPath(DecodedUrl='{escapedFileName}',Overwrite=false)
        ?$select=UniqueId,Name,ServerRelativeUrl,Length,TimeCreated,TimeLastModified,ListItemAllFields/Editor/Title
        &$expand=ListItemAllFields/Editor
    Authorization: Bearer {cached access token}
    Accept: application/json
    Content-Type: application/octet-stream
    Content-Length: {fileSize}

    {streamed file bytes}

Microsoft documents the ResourcePath-based `AddUsingPath` API in
[Supporting % and # in files and folders with the ResourcePath API](https://learn.microsoft.com/en-us/sharepoint/dev/solution-guidance/supporting-and-in-file-and-folder-with-the-resourcepath-api).
The [PnPjs SharePoint file documentation](https://pnp.github.io/pnpjs/sp/files/#adding-files)
also demonstrates `addUsingPath` with the file content and `Overwrite` option.

Escape the logical file name using the same OData and URI construction already used by
the backend. Never concatenate an unvalidated raw name.

## Streaming transport

Use Apache HttpClient 5 or the backend's already-approved streaming HTTP client.
Apache's
[`BasicHttpEntity`](https://hc.apache.org/httpcomponents-core-5.4.x/current/httpcore5/apidocs/org/apache/hc/core5/http/io/entity/BasicHttpEntity.html)
is a streamed, non-repeatable entity backed by an `InputStream`.

The essential operation is:

    InputStream content = servletRequest.getInputStream();
    request.setEntity(new BasicHttpEntity(
        content,
        contentLength,
        ContentType.APPLICATION_OCTET_STREAM
    ));

Fit these lines into the backend's existing controller/service structure. Do not
introduce speculative route-resolver or mapper classes around them.

Use one application-managed pooled HTTP client, not one new client per upload. Execute
the outgoing request synchronously while the servlet request is open. Always close the
outgoing response and abort/close the outgoing request after errors or disconnects.

Never call `readAllBytes()`, `MultipartFile.getBytes()`, or copy the content into a
`ByteArrayOutputStream`.

## Existing authentication

The Feign request interceptor cannot intercept an Apache HttpClient request. Reuse the
existing token service behind that interceptor:

1. obtain the same cached per-user bearer token used by existing SharePoint calls;
2. add `Authorization: Bearer ...` to the streaming request;
3. retain the existing refresh and error behavior.

Do not create another OAuth flow, token cache, certificate configuration, form digest,
`X-RequestDigest`, or `_api/contextinfo` request.

## SharePoint response mapping

Use the existing file DTOs and mapping code or conventions:

    kind        <- constant "file"
    listKey     <- domain route
    id          <- SharePoint UniqueId
    path        <- SharePoint ServerRelativeUrl
    name        <- SharePoint Name
    parentId    <- domain route parentFolderId
    sizeBytes   <- SharePoint Length, parsed as a number
    createdAt   <- SharePoint TimeCreated
    modifiedAt  <- SharePoint TimeLastModified
    modifiedBy  <- SharePoint ListItemAllFields.Editor.Title, when present

Do not create an upload-specific file mapper or a second SharePoint GET merely to
resolve `parentId`.

## Call count and two Tomcat instances

A successful upload performs exactly one backend-to-SharePoint request. No preflight
folder, metadata, collision, or permission request is added.

The load balancer selects one Tomcat instance for the single incoming HTTP request.
That instance relays the stream and returns the result. No shared upload state,
database row, or session affinity is required.

## Retry, cancellation, and progress

The streaming request body is non-repeatable. Disable automatic HTTP retries for this
operation. A user retry sends a new browser request and restarts the complete file from
byte zero.

Angular progress measures how much of the file it has sent to Tomcat. Because Tomcat
relays the same stream while receiving it, data flows toward SharePoint during that
request. Completion is still reported only after SharePoint succeeds and the backend
returns `201`.

When Angular cancels, the servlet read should fail or end early and the outgoing
request must be aborted. Cancellation remains best effort if SharePoint has already
committed the file.

## Error mapping

Use the same exception translation and public error format as existing document
operations:

- invalid route, request, or name -> HTTP 400 / existing invalid-input code;
- missing `Content-Length` -> HTTP 411;
- missing destination -> HTTP 404 / `not-found`;
- existing file with `Overwrite=false` -> HTTP 409 / `name-collision`;
- SharePoint 401/403 -> HTTP 403 / `permission-denied`;
- declared size above the configured maximum -> HTTP 413;
- SharePoint 429 or transport failure -> existing retryable `network` failure;
- unrecognized SharePoint failure -> `unknown`, with technical and correlation details
  retained only in backend logs.

Return no file node on failure and never expose authentication or routing details.

## Backend acceptance checklist

- Existing controller/service, routing, authorization, DTO, mapping, and error patterns
  are retained.
- The only new transport behavior is the focused streaming SharePoint call.
- The servlet `InputStream` is relayed without a complete-file `byte[]`.
- One domain POST produces one SharePoint `Files/AddUsingPath` POST.
- `Overwrite=false` prevents replacement of an existing file. Do not send
  `EnsureUniqueFileName=true`; duplicate names must fail rather than receive a numeric
  suffix.
- The existing token service supplies authentication.
- Automatic replay of the non-repeatable request is disabled.
- SharePoint's canonical id, name, path, size, and timestamps are returned.
- Browser disconnect closes the outgoing request and response resources.
- No empty placeholder, chunk operation, upload session, database row, or scheduler is
  introduced.
- Two Tomcat instances require no shared upload state.
