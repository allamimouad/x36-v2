# Upload File — Single-Request Feign Implementation

> **Status: backend implementation contract.**
>
> Implement one simple upload request using the existing authenticated SharePoint
> Feign client. The complete file is held in backend memory, so this implementation
> must enforce a conservative file-size limit.

## Required outcome

Upload one file with:

- one browser-to-backend HTTP request;
- one backend-to-SharePoint `Files/Add` HTTP request;
- no upload session;
- no database table;
- no scheduler;
- no `StartUpload`, `ContinueUpload`, or `FinishUpload`;
- no empty-file creation before the real upload.

The SharePoint file is created by the request containing the complete file body. The
backend returns success only after SharePoint returns the completed file.

## Domain endpoint

```http
POST /projects/{projectId}/document-lists/{listKey}/documents/{parentFolderId}/files?name={encodedFileName}
Content-Type: application/octet-stream
Content-Length: {fileSize}

{raw file bytes}
```

The request body is the file itself. Do not use JSON, Base64, multipart form data, or
`FormData`.

Route meaning:

- `projectId` identifies the project.
- `listKey` identifies the configured document list, for example `execution` or
  `marketing`.
- `parentFolderId` is the destination folder's SharePoint `UniqueId`.
- `name` is one URL-encoded file name.

The frontend must never provide a SharePoint site URL, library id, server-relative
path, access token, or SharePoint upload id.

## Complete flow

```text
Angular sends the File as one raw request body
                    |
                    v
Spring controller reads it into a bounded byte[]
                    |
                    v
Service resolves and authorizes project/list/folder
                    |
                    v
Existing Feign client calls SharePoint Files/Add
                    |
                    v
Existing Feign RequestInterceptor adds the bearer token
                    |
                    v
SharePoint returns the completed SP.File
                    |
                    v
Backend maps it to the domain File DTO and returns 201
```

The two Tomcat instances need no shared upload state. A load balancer selects one
instance for this single HTTP request, and that instance performs the complete
SharePoint call before returning.

## Controller

Keep the controller limited to HTTP concerns:

```java
@PostMapping(
    value = "/projects/{projectId}/document-lists/{listKey}"
        + "/documents/{parentFolderId}/files",
    consumes = MediaType.APPLICATION_OCTET_STREAM_VALUE,
    produces = MediaType.APPLICATION_JSON_VALUE
)
public ResponseEntity<FileDto> uploadFile(
    @PathVariable String projectId,
    @PathVariable String listKey,
    @PathVariable UUID parentFolderId,
    @RequestParam("name") String fileName,
    HttpServletRequest request
) throws IOException {
    long declaredSize = request.getContentLengthLong();
    byte[] content = boundedUploadReader.read(
        request.getInputStream(),
        declaredSize,
        bufferedUploadMaxBytes
    );

    FileDto result = uploadFileService.upload(
        projectId,
        listKey,
        parentFolderId,
        fileName,
        content
    );

    return ResponseEntity.status(HttpStatus.CREATED).body(result);
}
```

`boundedUploadReader` must:

1. reject a known `Content-Length` above `bufferedUploadMaxBytes` before reading;
2. read at most `bufferedUploadMaxBytes + 1` bytes;
3. return `413 Payload Too Large` if the stream exceeds the limit;
4. reject an empty body unless zero-byte files are explicitly allowed;
5. never use an unbounded `readAllBytes()`.

Use an initial maximum of **10 MiB (10,485,760 bytes)** unless a lower value is
required by the available Tomcat heap and expected concurrency. Do not claim support
for very large files with this implementation.

## Service

The service owns validation, authorization, routing, and response mapping:

```java
@Service
public class UploadFileService {
    private final SharePointRouteResolver routeResolver;
    private final SharePointUploadClient sharePointClient;
    private final SharePointFileMapper fileMapper;

    public FileDto upload(
        String projectId,
        String listKey,
        UUID parentFolderId,
        String fileName,
        byte[] content
    ) {
        SharePointRoute route = routeResolver.resolve(projectId, listKey);
        authorizeWrite(route, parentFolderId);
        String safeName = validateAndEscapeFileName(fileName);

        SharePointFileResponse response = sharePointClient.addFile(
            route.sharePointTarget(),
            parentFolderId,
            safeName,
            content
        );

        return fileMapper.toDomain(response, projectId, listKey, parentFolderId);
    }
}
```

Adapt the route argument to the established Feign targeting mechanism. If the
application already selects a configured Feign client per SharePoint site, keep that
mechanism.

## Feign client

Add one raw-body operation to the existing SharePoint Feign client:

```java
@PostMapping(
    value = "/_api/web/GetFolderById('{parentFolderId}')"
        + "/Files/Add(url='{fileName}',overwrite=false)",
    consumes = MediaType.APPLICATION_OCTET_STREAM_VALUE,
    produces = MediaType.APPLICATION_JSON_VALUE
)
SharePointFileResponse addFile(
    /* existing SharePoint target argument, if required */,
    @PathVariable("parentFolderId") UUID parentFolderId,
    @PathVariable("fileName") String escapedFileName,
    @RequestBody byte[] content
);
```

The final signature must follow the existing client's conventions for the target site,
OData headers, and response envelope. The required SharePoint operation is:

```http
POST {siteUrl}/_api/web/GetFolderById('{parentFolderId}')/Files/Add(url='{escapedFileName}',overwrite=false)
Content-Type: application/octet-stream

{complete file bytes}
```

Escape the file name as an OData string value and then URL-encode it using the
application's existing URI builder. Never concatenate an unvalidated raw file name
into the SharePoint URL.

Microsoft documents `Files/Add` with the complete binary file in the POST body in
[Working with folders and files with REST](https://learn.microsoft.com/en-us/sharepoint/dev/sp-add-ins/working-with-folders-and-files-with-rest).

## Authentication

Reuse the existing Feign configuration exactly as it is:

- the existing `RequestInterceptor` obtains the access token from the existing token
  service;
- the interceptor adds the `Authorization: Bearer ...` header;
- the upload service does not request or add a second token;
- do not introduce another OAuth flow, token cache, form digest, or
  `_api/contextinfo` call.

## Why this is buffered

Spring Cloud OpenFeign does not relay the servlet `InputStream` directly to the network
with its normal Spring encoder. Its `SpringEncoder` writes the body to a
`ByteArrayOutputStream` and assigns this to Feign with:

```java
request.body(outputMessage.getOutputStream().toByteArray(), charset);
```

See the official
[`SpringEncoder.java`](https://github.com/spring-cloud/spring-cloud-openfeign/blob/main/spring-cloud-openfeign-core/src/main/java/org/springframework/cloud/openfeign/support/SpringEncoder.java)
source.

Therefore:

- changing the Feign method parameter from `byte[]` to `InputStream` does not make this
  path a live stream;
- the controller has one complete byte array, and the encoder may create another copy;
- simultaneous uploads multiply the heap requirement;
- the configured maximum and concurrency must remain conservative.

## Progress, cancellation, and retry

The browser can report upload progress while sending the request to Tomcat. That
percentage measures browser-to-backend transfer, not bytes accepted by SharePoint.

When Tomcat has received the complete body, the UI should show a finalizing state while
the Feign call is running. Report completion only when the backend returns `201`.

If the user cancels:

- Angular aborts its HTTP request;
- no database state or cleanup job exists;
- if the SharePoint call has already started, cancellation is best effort and the call
  may still finish;
- if it finishes, the complete file can appear in SharePoint.

A retry starts the complete file again from byte zero. There is no resume support.

## Response and errors

On success:

```http
201 Created
Content-Type: application/json

{
  "id": "sharepoint-file-unique-id",
  "listKey": "execution",
  "parentId": "destination-folder-id",
  "name": "report.pdf",
  "path": "/configured/library/report.pdf",
  "size": 123456,
  "modifiedAt": "2026-07-29T10:15:30Z",
  "modifiedBy": "..."
}
```

Return the application's established canonical `FileDto`; the example only shows the
expected meaning.

Map failures consistently:

- `400` invalid file name, list key, or request;
- `401`/`403` authentication or authorization failure;
- `404` unknown route or destination folder;
- `409` a file with the same name already exists;
- `413` configured buffered-upload limit exceeded;
- `502` SharePoint rejected the operation or returned an unusable response;
- `504` SharePoint timed out.

Never return an access token, SharePoint site URL, or internal Feign exception details.

## Acceptance checks

- A normal file is created with its exact bytes and canonical name.
- A second upload with the same name returns `409` and does not overwrite.
- A request above the configured limit returns `413` without calling SharePoint.
- A request without `Content-Length` is still bounded while reading.
- The existing Feign interceptor supplies authentication; the upload code contains no
  duplicate token flow.
- No empty SharePoint file is explicitly created before `Files/Add`.
- No database row, scheduler, upload id, or chunk endpoint is introduced.
- Two parallel requests can be handled by different Tomcat instances without shared
  state.
