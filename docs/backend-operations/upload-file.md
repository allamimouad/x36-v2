# UPLOAD File

> **Status: focused backend contract agreed; backend and frontend pending.**
> Tomorrow's implementation is deliberately limited to one file of at most 10 MiB.
> Progress, cancellation, folder upload, chunk sessions, and multiple-file orchestration
> are outside this operation.
>
> For backend generation, this guide supersedes the generic Phase 6
> `StartUpload`/`ContinueUpload`/`FinishUpload` placeholder until those operations are
> verified against the target SharePoint farm.
>
> Run the separate
> [manual SharePoint chunk-upload verification](verify-sharepoint-chunk-upload.md)
> in Postman before changing this decision.

## Decision

Keep one domain endpoint whose body is the raw file:

    POST /projects/{projectId}/document-lists/{listKey}/documents/{parentFolderId}/files?name={encodedFileName}
    Content-Type: application/octet-stream
    Content-Length: {fileSize}

    {raw file bytes}

This is an ordinary HTTP POST. `application/octet-stream` only says that the body is
binary; it does not require WebSocket or another protocol. The browser can send its
`File` object directly as the request body.

Using a raw body now keeps the domain contract reusable: the first implementation may
buffer a bounded small file for Feign, while a later implementation can relay the same
request body to SharePoint as it arrives without changing the frontend endpoint.

- `listKey` is `execution` or `marketing`.
- `parentFolderId` is the destination folder's SharePoint `UniqueId`.
- `name` is the decoded file name transported as one URL-encoded query value.
- Do not accept a SharePoint URL, path, library id, or access token from the frontend.
- The temporary maximum is **10 MiB (10,485,760 bytes)**.
- The first implementation always uses no-overwrite behavior.

The backend must reject a known `Content-Length` above the limit before contacting
SharePoint. It must also enforce the limit while reading because a request may omit
`Content-Length` or use chunked transfer encoding. Return `413 Payload Too Large`.

## Successful response

    201 Created
    Content-Type: application/json

    {
      "kind": "file",
      "listKey": "execution",
      "id": "sharepoint-returned-unique-id",
      "path": "/sites/project/Documents/Contracts/report.pdf",
      "name": "report.pdf",
      "parentId": "parent-folder-guid",
      "sizeBytes": 245760,
      "createdAt": "2026-07-27T10:30:00Z",
      "modifiedAt": "2026-07-27T10:30:00Z",
      "modifiedBy": "User Name",
      "contentType": "application/pdf"
    }

Return the same canonical `File` DTO used by document listings. `parentId` is required,
not nullable: the frontend store uses it to associate the file with its parent and
maintain the folder view. For this operation, a successful upload proves that the file
was created in the route's `parentFolderId`, so the backend may map that route value
when SharePoint's file response does not expose its parent folder.

Do not invent `id`, `path`, `name`, size, or audit values. Map them from SharePoint's
created-file response; if that response is incomplete in the target environment, read
the created file canonically before returning.

## Tomorrow's bounded implementation

The current authenticated Feign path does **not** provide true request streaming.
Implement this first version explicitly as a small-file upload:

1. Resolve and authorize `(projectId, listKey)` using backend-owned configuration.
2. Validate `parentFolderId`, `name`, and the 10 MiB limit.
3. Read the raw servlet request into a bounded `byte[]`; stop and return 413 as soon as
   the body exceeds the limit. Do not call unbounded `readAllBytes()`.
4. Send that `byte[]` through the existing authenticated SharePoint Feign client.
5. Map the canonical SharePoint file to the response DTO and set `parentId` as described
   above.

The controller boundary must expose the request's `ServletInputStream`; do not declare
the incoming body as `byte[]` or `MultipartFile`. Otherwise Spring or multipart parsing
may materialize the body before the application can enforce its bounded read, and the
same endpoint cannot later become a live relay.

The candidate SharePoint REST call to verify in Postman against the actual on-prem farm
is:

    POST {siteUrl}/_api/web/GetFolderById('{parentFolderId}')/Files/Add(url='{fileName}',overwrite=false)
    Authorization: Bearer {cached access token}
    Accept: application/json
    Content-Type: application/octet-stream

    {raw file bytes}

Construct the OData file-name literal with the backend's established URI builder:
escape an apostrophe as `''`, then apply transport URL encoding exactly once. Reuse the
existing cached-token authentication and error extraction; do not add another token
flow, form digest, or `X-RequestDigest`.

The target farm must confirm the exact by-id `Files/Add` spelling and returned fields
before generation. Microsoft's documented upload pattern is the folder's `Files/Add`
operation with the file bytes in the POST body.

## What is and is not held in RAM

| Implementation | Incoming body | Outgoing body | Suitable for 1 GiB? |
|---|---|---|---|
| Classical Spring `MultipartFile` | Memory or a temporary file, depending on multipart configuration | Standard Feign still materializes the complete encoded request in a `byte[]` | No |
| Tomorrow's raw-body + Feign implementation | Tomcat exposes a stream, then our service deliberately creates a bounded `byte[]` | Feign buffers the complete body | No; reject above 10 MiB |
| Future raw-body relay + streaming HTTP client | Read progressively from Tomcat | Written progressively to SharePoint | Possible in principle, subject to SharePoint, proxy, and timeout limits |

`MultipartFile` does not automatically mean that the complete incoming file is in
heap: Spring documents that it may be stored in memory or temporarily on disk.
However, that does not solve the outbound Feign problem.

Spring Cloud OpenFeign's standard `SpringEncoder` serializes into a
`ByteArrayOutputStream` and calls `toByteArray()`. OpenFeign's request model then carries
the body as `byte[]`. Therefore passing `MultipartFile`, `Resource`, or `InputStream`
through the normal encoder does not create a live browser-to-SharePoint relay. A 1 GiB
upload through this path can exhaust the JVM heap.

## True relay streaming later

True relay streaming is compatible with Tomcat and still uses one normal HTTP request:

    browser File
        -> Tomcat ServletInputStream
        -> small reusable buffer
        -> streaming SharePoint request body

Tomcat exposes the request body through `HttpServletRequest.getInputStream()`. A simple
blocking implementation is valid, although it occupies one request thread and both
HTTP connections for the duration. Servlet asynchronous/non-blocking I/O is an optional
scalability improvement, not a requirement and not a WebSocket.

The outbound SharePoint call must use a client that accepts a one-shot stream, such as
Apache HttpClient's `InputStreamEntity` or Java `HttpClient.BodyPublishers.ofInputStream`.
That upload-specific client must reuse the existing token provider/cache; it must not
create a second authentication implementation. Standard Feign cannot be used for this
body.

This is why true relay streaming is not tomorrow's small change: Tomcat already
supports it, but replacing Feign for this operation and safely reusing authentication
needs an explicit backend design. A single relayed request also has no resume point: a
failure near the end starts the file again, and proxy/body limits plus connection
timeouts must be configured.

Do not generate SharePoint `StartUpload` / `ContinueUpload` / `FinishUpload` support for
the on-prem backend yet. Microsoft's large-upload guidance recommends those sliced
methods for SharePoint Online, while recommending stream-based upload for SharePoint
Server. If the target farm exposes compatible REST chunk methods, verify all of them in
Postman first; bounded chunks could then be sent safely through Feign one request at a
time.

## Error mapping

- Invalid or blank file name -> HTTP 400 / `invalid-name`.
- Body above 10 MiB -> HTTP 413.
- Missing destination folder -> HTTP 404 / `not-found`.
- Existing file with the same name -> HTTP 409 / `name-collision`.
- SharePoint 401/403 -> HTTP 403 / `permission-denied`.
- SharePoint 429 or transport failure -> retryable `network` failure.
- Any other failure -> `unknown`, with technical and SharePoint correlation details
  retained only in backend logs.

No `File` DTO is returned unless SharePoint has confirmed the upload.

## Acceptance checklist for tomorrow

- A small file is uploaded into both Execution and Marketing using their own `listKey`.
- A nested folder and a document-list root both work through `parentFolderId`.
- The response contains SharePoint's canonical id, path, name, size, and audit values.
- The response contains the non-null destination `parentId`.
- A duplicate name is not overwritten and maps to `name-collision`.
- Apostrophes, spaces, and non-ASCII file names are encoded once and arrive unchanged.
- A 10 MiB file succeeds; a 10 MiB + 1 byte body returns 413.
- An oversized request makes no SharePoint call.
- A 1 GiB file is rejected by this version rather than buffered.

## Verification sources

- [Tomcat `ServletRequest.getInputStream()`](https://tomcat.apache.org/tomcat-10.1-doc/servletapi/jakarta/servlet/ServletRequest.html)
- [Tomcat `ServletInputStream` and optional non-blocking `ReadListener`](https://tomcat.apache.org/tomcat-10.0-doc/servletapi/jakarta/servlet/ServletInputStream.html)
- [Spring Cloud OpenFeign `SpringEncoder` source](https://github.com/spring-cloud/spring-cloud-openfeign/blob/main/spring-cloud-openfeign-core/src/main/java/org/springframework/cloud/openfeign/support/SpringEncoder.java)
- [OpenFeign `Request.Body` source](https://github.com/OpenFeign/feign/blob/master/core/src/main/java/feign/Request.java)
- [Spring `MultipartFile` storage contract](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/multipart/MultipartFile.html)
- [Apache HttpClient streamed `InputStreamEntity`](https://hc.apache.org/httpcomponents-core-4.4.x/current/httpcore/apidocs/org/apache/http/entity/InputStreamEntity.html)
- [Java `BodyPublishers.ofInputStream`](https://docs.oracle.com/en/java/javase/19/docs/api/java.net.http/java/net/http/HttpRequest.BodyPublishers.html)
- [Microsoft SharePoint REST file-upload example](https://learn.microsoft.com/en-us/sharepoint/dev/sp-add-ins/upload-a-file-by-using-the-rest-api-and-jquery)
- [Microsoft large-file upload guidance](https://learn.microsoft.com/en-us/sharepoint/dev/solution-guidance/upload-large-files-sample-app-for-sharepoint)
