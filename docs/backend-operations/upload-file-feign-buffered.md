# UPLOAD File with Feign

> **Status: backend contract agreed; backend and frontend pending.**
> This is the operation-specific companion to the
> [backend endpoint overview](../backend-endpoints.md).

## Implementation rule

This is one additional operation in an existing backend. Before writing code, inspect
the implemented create-folder, rename, and delete flows and extend the same:

- controller and service structure;
- `(projectId, listKey)` SharePoint configuration resolution;
- authorization checks;
- configured SharePoint Feign client;
- Feign request interceptor and token service;
- SharePoint response DTOs and domain mapping;
- validation, exception translation, and error response format.

Do not create a new route resolver, generic upload architecture, file mapper, token
provider, Feign configuration, or parallel error-handling system merely for this
operation. Add only the endpoint and Feign operation required for upload, using the
existing names and patterns found in the backend.

## Domain endpoint

    POST /projects/{projectId}/document-lists/{listKey}/documents/{parentFolderId}/files?name={encodedFileName}
    Content-Type: application/octet-stream
    Content-Length: {fileSize}

    {raw file bytes}

- `listKey`: `EXECUTION` or `MARKETING`; required because the two lists may use
  different SharePoint sites.
- `parentFolderId`: the destination folder's SharePoint `UniqueId` GUID.
- `name`: the decoded file name, including its extension.
- The request body is the file itself. It is not JSON, Base64, multipart, or
  `FormData`.
- Do not accept a SharePoint site URL, library id, path, access token, overwrite flag,
  or upload id from the frontend.

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

Return the backend's existing canonical file response shape. Do not introduce a second
upload-specific file DTO when an existing file/document DTO already represents these
fields.

## Required semantics

1. Validate the domain route, destination folder id, decoded file name, content type,
   and size using the backend's existing validation style.
2. Resolve and authorize `(projectId, listKey)` exactly as the implemented document
   operations already do.
3. Read the raw request body into a size-bounded `byte[]`.
4. Call SharePoint once through the existing authenticated Feign client.
5. Map SharePoint's returned file through the existing mapping conventions.
6. Return `201` only after SharePoint confirms success.

Do not create an empty SharePoint file first. Do not use `StartUpload`,
`ContinueUpload`, or `FinishUpload`. Do not add an upload session, database table,
scheduler, cleanup job, or load-balancer stickiness.

## Backend resolution and guards

Follow the same resolution and authorization path used by create folder, rename, and
delete:

1. Validate `projectId`, `listKey`, `parentFolderId`, and `name` before contacting
   SharePoint.
2. Reject blank or invalid file names, path separators, `.` and `..`, and any name
   rejected by the existing domain name rules.
3. Resolve the backend-owned SharePoint configuration for `(projectId, listKey)`.
4. Authorize upload to the selected project/document list.
5. Treat `parentFolderId` as the destination folder id. Do not add a preliminary
   SharePoint GET merely to rediscover its type or path.
6. Reject a known request size above **10 MiB (10,485,760 bytes)** before contacting
   SharePoint.
7. Also enforce the 10 MiB limit while reading because `Content-Length` may be absent
   or incorrect. Return `413 Payload Too Large` if the body exceeds the limit.

Use the existing request-size configuration and utilities where they already exist.
Do not introduce a reusable buffering abstraction solely to give this operation a new
class name.

## SharePoint request

Add the following operation to the existing authenticated SharePoint Feign client:

    POST {siteUrl}/_api/web/GetFolderById('{parentFolderId}')/Files/AddUsingPath(DecodedUrl='{escapedFileName}',Overwrite=false)
        ?$select=UniqueId,Name,ServerRelativeUrl,Length,TimeCreated,TimeLastModified,ListItemAllFields/Editor/Title
        &$expand=ListItemAllFields/Editor
    Authorization: Bearer {cached access token}
    Accept: application/json
    Content-Type: application/octet-stream
    Content-Length: {fileSize}

    {complete file bytes}

The Feign request body is the bounded `byte[]`. An empty file is valid: normalize an
absent inbound body to a non-null `new byte[0]` before calling Feign, and send it with
`Content-Length: 0`.

Use the existing Feign client's conventions for:

- selecting the configured SharePoint site;
- declaring dynamic OData paths;
- headers and response envelopes;
- deserializing `SP.File`;
- extracting SharePoint error and correlation information.

Do not create another Feign client if the existing one can receive this operation.

Escape an apostrophe in the logical file name as `''`, then let the backend's
established URI construction perform transport encoding. Never concatenate an
unvalidated raw file name into the OData URL.

Microsoft documents the ResourcePath-based `AddUsingPath` API in
[Supporting % and # in files and folders with the ResourcePath API](https://learn.microsoft.com/en-us/sharepoint/dev/solution-guidance/supporting-and-in-file-and-folder-with-the-resourcepath-api).
The [PnPjs SharePoint file documentation](https://pnp.github.io/pnpjs/sp/files/#adding-files)
also demonstrates `addUsingPath` with the file content and `Overwrite` option.

## SharePoint response mapping

Map the returned SharePoint file using the same mapping code or conventions already
used for file reads and other file mutations:

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

`SP.File` does not expose `ParentFolder`, but this operation cannot move the file.
Therefore the validated domain `parentFolderId` is the response `parentId`; do not add
a second SharePoint request solely to resolve it.

SharePoint's returned `UniqueId`, `Name`, `ServerRelativeUrl`, `Length`, and timestamps
are authoritative. Do not reconstruct them in Java.

## Existing authentication and call count

- Reuse the configured Feign client and its existing request interceptor.
- The interceptor continues obtaining and adding the cached per-user OAuth bearer
  token through the existing token service.
- Upload code must not obtain or add a second token.
- Do not add another OAuth flow, token cache, form digest, `X-RequestDigest`, or
  `_api/contextinfo` request.
- A successful upload performs exactly **one backend-to-SharePoint request**: the
  `Files/AddUsingPath` POST.
- Do not perform a preliminary folder, collision, metadata, or permission lookup.

## Why the first implementation is limited to 10 MiB

The normal Spring Cloud OpenFeign `SpringEncoder` writes a request through a
`ByteArrayOutputStream` and then assigns:

    request.body(outputMessage.getOutputStream().toByteArray(), charset);

See the official
[`SpringEncoder.java`](https://github.com/spring-cloud/spring-cloud-openfeign/blob/main/spring-cloud-openfeign-core/src/main/java/org/springframework/cloud/openfeign/support/SpringEncoder.java)
source.

Consequently, this operation buffers the complete file and the encoder may make an
additional byte-array copy. Changing only the Feign method parameter to `InputStream`
does not make the existing encoder stream.

The 10 MiB limit is therefore part of this implementation, not a SharePoint limit.
Concurrent uploads multiply heap usage, so retain the configured limit even though
SharePoint accepts larger files.

## Two Tomcat instances

No upload state is shared between requests because one upload is one HTTP request. The
load balancer selects one Tomcat instance, and that instance receives the body, calls
SharePoint, and returns the response.

Do not store upload state in JVM memory or in the database. No session affinity is
required.

## Progress, cancellation, and retry

- Browser progress measures transfer from Angular to Tomcat.
- After Tomcat has received the file, the frontend may show a finalizing state until
  the SharePoint call returns.
- Report completion only after the backend returns `201`.
- Cancelling aborts the browser request. If the SharePoint call already started, it
  may still finish and create the complete file.
- Retry sends the complete file again from byte zero. There is no resume support.

## Error mapping

Use the same exception translation and public error format as the implemented document
operations:

- invalid route, body, or name -> HTTP 400 / existing invalid-input code;
- missing destination folder -> HTTP 404 / `not-found`;
- existing file with `Overwrite=false` -> HTTP 409 / `name-collision`;
- SharePoint 401/403 -> HTTP 403 / `permission-denied`;
- request above the buffered limit -> HTTP 413;
- SharePoint 429 or transport failure -> existing retryable `network` failure;
- unrecognized SharePoint failure -> `unknown`, with technical and correlation details
  retained only in backend logs.

On failure, return no file node. Do not expose tokens, SharePoint configuration, or raw
Feign exception details.

## Backend acceptance checklist

- The implementation extends the existing controller/service/Feign patterns rather
  than introducing speculative architecture.
- One domain POST produces one SharePoint `Files/AddUsingPath` POST.
- The existing Feign client, request interceptor, token service, DTOs, mapping, and
  error handling are reused wherever they already apply.
- A valid file is returned with SharePoint's canonical id, name, path, size, and
  timestamps.
- `Overwrite=false` prevents replacement of an existing file. Do not send
  `EnsureUniqueFileName=true`; duplicate names must fail rather than receive a numeric
  suffix.
- A request above 10 MiB returns `413` without calling SharePoint.
- A request without a trustworthy `Content-Length` is still bounded while reading.
- No empty placeholder, chunk operation, upload session, database row, or scheduler is
  introduced.
- Two Tomcat instances require no shared upload state.
