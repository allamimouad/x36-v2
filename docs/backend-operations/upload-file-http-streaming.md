# Upload File — Single-Request HTTP Streaming Implementation

> **Status: backend implementation contract.**
>
> Relay the browser request body to SharePoint as a stream. The complete file must
> never be materialized as a backend `byte[]`.

## Required outcome

Upload one file with:

- one browser-to-backend HTTP request;
- one backend-to-SharePoint `Files/Add` HTTP request;
- a direct `InputStream` relay with bounded working memory;
- no upload session;
- no database table;
- no scheduler;
- no `StartUpload`, `ContinueUpload`, or `FinishUpload`;
- no empty-file creation before the real upload.

The incoming servlet stream becomes the outgoing SharePoint request entity. SharePoint
creates the file from the complete body and returns the completed file.

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
Tomcat exposes HttpServletRequest.getInputStream()
                    |
                    v
Service resolves and authorizes project/list/folder
                    |
                    v
Apache HttpClient uses that InputStream as its request entity
                    |
                    v
Existing token provider supplies the bearer token
                    |
                    v
SharePoint Files/Add reads the stream and returns SP.File
                    |
                    v
Backend maps it to the domain File DTO and returns 201
```

The two Tomcat instances need no shared upload state. The load balancer chooses one
instance for the incoming request; the outgoing SharePoint request remains attached to
that same request and instance until it finishes.

## Dependency

Use Apache HttpClient 5 for this upload operation:

```xml
<dependency>
    <groupId>org.apache.httpcomponents.client5</groupId>
    <artifactId>httpclient5</artifactId>
</dependency>
```

Use the version managed by the application's Spring Boot dependency management where
available.

Apache's
[`BasicHttpEntity`](https://hc.apache.org/httpcomponents-core-5.4.x/current/httpcore5/apidocs/org/apache/hc/core5/http/io/entity/BasicHttpEntity.html)
is a streamed, non-repeatable entity backed by an `InputStream`; its documented
`isStreaming()` result is `true`.

## Controller

The controller passes the servlet stream to the service without reading it into a byte
array:

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
    long contentLength = request.getContentLengthLong();
    if (contentLength < 0) {
        throw new LengthRequiredException();
    }

    FileDto result = uploadFileService.upload(
        projectId,
        listKey,
        parentFolderId,
        fileName,
        contentLength,
        request.getInputStream()
    );

    return ResponseEntity.status(HttpStatus.CREATED).body(result);
}
```

Require a known length for the first implementation. A browser sending a `File` or
`Blob` as the raw XMLHttpRequest body supplies its length automatically. Enforce the
configured SharePoint maximum before opening the outgoing request and return `413` when
it is exceeded.

The service and HTTP client execute synchronously within this controller call. Do not
return from the controller while another thread is still using the servlet stream.

## Service

The service owns validation, authorization, routing, and response mapping:

```java
@Service
public class UploadFileService {
    private final SharePointRouteResolver routeResolver;
    private final SharePointStreamingClient sharePointClient;
    private final SharePointFileMapper fileMapper;

    public FileDto upload(
        String projectId,
        String listKey,
        UUID parentFolderId,
        String fileName,
        long contentLength,
        InputStream content
    ) {
        SharePointRoute route = routeResolver.resolve(projectId, listKey);
        authorizeWrite(route, parentFolderId);
        String safeName = validateAndEscapeFileName(fileName);

        SharePointFileResponse response = sharePointClient.addFile(
            route,
            parentFolderId,
            safeName,
            contentLength,
            content
        );

        return fileMapper.toDomain(response, projectId, listKey, parentFolderId);
    }
}
```

## Streaming SharePoint client

Create one focused client component. It reuses the existing route resolver and token
provider but does not use a Feign encoder for the request body.

```java
@Component
public class SharePointStreamingClient {
    private final CloseableHttpClient httpClient;
    private final TokenService tokenService;
    private final ObjectMapper objectMapper;

    public SharePointFileResponse addFile(
        SharePointRoute route,
        UUID parentFolderId,
        String escapedFileName,
        long contentLength,
        InputStream content
    ) {
        URI uri = buildFilesAddUri(
            route.siteUrl(),
            parentFolderId,
            escapedFileName
        );

        HttpPost request = new HttpPost(uri);
        request.setHeader(HttpHeaders.AUTHORIZATION,
            "Bearer " + tokenService.getAccessToken());
        request.setHeader(HttpHeaders.ACCEPT, "application/json;odata=verbose");
        request.setEntity(new BasicHttpEntity(
            content,
            contentLength,
            ContentType.APPLICATION_OCTET_STREAM
        ));

        return httpClient.execute(request, response -> {
            ensureSuccessfulStatus(response);
            return objectMapper.readValue(
                response.getEntity().getContent(),
                SharePointFileResponse.class
            );
        });
    }
}
```

Adapt the token-service method and SharePoint response type to their established
interfaces. The important behavior is:

- use the existing token provider and cache;
- obtain the same per-user access token used by authenticated SharePoint calls;
- set the bearer header on the Apache request;
- do not create another authentication flow or token cache.

The Feign `RequestInterceptor` cannot intercept an Apache HttpClient request. Reuse the
token provider behind that interceptor, not the Feign interceptor itself.

Use one application-managed, pooled `CloseableHttpClient`; do not create a client per
file.

## SharePoint request

The client sends:

```http
POST {siteUrl}/_api/web/GetFolderById('{parentFolderId}')/Files/Add(url='{escapedFileName}',overwrite=false)
Authorization: Bearer {existingAccessToken}
Accept: application/json;odata=verbose
Content-Type: application/octet-stream
Content-Length: {fileSize}

{streamed file bytes}
```

Escape the file name as an OData string value and then URL-encode it with a URI builder.
Never concatenate an unvalidated raw file name into the SharePoint URL.

Microsoft documents `Files/Add` with the binary file in the POST body in
[Working with folders and files with REST](https://learn.microsoft.com/en-us/sharepoint/dev/sp-add-ins/working-with-folders-and-files-with-rest).

## Retry behavior

`BasicHttpEntity` is non-repeatable because it wraps the live servlet stream. Configure
this operation with no automatic HTTP retry. A transparent retry would find the stream
already consumed and could create an ambiguous result.

After any failure, a user retry sends a new browser request and restarts the complete
file from byte zero. There is no resume support.

## Progress and cancellation

Angular can report upload progress while sending the request to Tomcat. Because Tomcat
is simultaneously relaying the stream to SharePoint, that progress is closer to the
real end-to-end transfer than a fully buffered call. Completion is still reported only
after SharePoint returns success and the backend returns `201`.

If the user cancels:

- Angular aborts the incoming HTTP request;
- the servlet read normally fails or reaches an incomplete body;
- the outgoing Apache request must be closed/aborted;
- no database state or cleanup job exists;
- cancellation remains best effort if SharePoint has already committed the request.

The HTTP client response and request resources must always be closed, including on
client disconnect, timeout, parsing error, and SharePoint error.

## Memory and timeout rules

- Never convert the upload `InputStream` to `byte[]`.
- Never use `readAllBytes()`, `ByteArrayOutputStream`, `MultipartFile.getBytes()`, or a
  buffering request entity.
- Do not log request bodies.
- Keep servlet, reverse-proxy, load-balancer, and SharePoint timeouts long enough for
  the maximum supported file at the slowest accepted connection speed.
- Keep server request-size limits aligned with the supported SharePoint maximum.
- Apply a concurrency limit if required to protect sockets and SharePoint, even though
  heap usage stays bounded.

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
- `411` missing `Content-Length`;
- `413` configured maximum exceeded;
- `499` only if the existing platform already uses it for a client-disconnected
  request; otherwise do not invent a new public status;
- `502` SharePoint rejected the operation or returned an unusable response;
- `504` SharePoint timed out.

Never return an access token, SharePoint site URL, or internal HTTP-client details.

## Acceptance checks

- A normal file is created with its exact bytes and canonical name.
- A file larger than the available JVM heap can be relayed without heap growth
  proportional to file size.
- A second upload with the same name returns `409` and does not overwrite.
- The outgoing request has the declared `Content-Length` and raw octet-stream body.
- The existing token provider supplies authentication; no duplicate OAuth flow exists.
- An automatic retry cannot replay the non-repeatable entity.
- Disconnecting the browser closes the outgoing request and all resources.
- No empty SharePoint file is explicitly created before `Files/Add`.
- No database row, scheduler, upload id, or chunk endpoint is introduced.
- Two parallel requests can be handled by different Tomcat instances without shared
  state.
