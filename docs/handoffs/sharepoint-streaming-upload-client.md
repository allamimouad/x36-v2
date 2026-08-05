# SharePoint Streaming Upload Client — Implementation Prompt

Implement a dedicated streaming HTTP client for the existing SharePoint file-upload
operation. Make the change carefully and keep it limited to the upload transport and
the directly required controller/service integration, configuration, error mapping,
and tests. Do not redesign unrelated SharePoint operations.

## Context

The application is a Spring Boot application using Spring MVC on Tomcat. Existing
SharePoint operations use a Spring Cloud OpenFeign client with a SharePoint-specific
Feign configuration and request interceptor. The interceptor obtains the current user
identifier, calls the existing `SharePointTokenService.getAccessToken(userId)`, and
adds the resulting OAuth bearer token.

The existing upload endpoint works, and the Angular frontend already sends the file as
one raw `application/octet-stream` request while observing upload progress. Preserve
that public endpoint and its response DTO exactly. The frontend must not know that the
backend-to-SharePoint transport has changed.

The current backend receives or converts the upload body to `byte[]` and sends it with
Feign. That must change because files can be as large as 250 MB and multiple users can
upload concurrently. Standard Spring Cloud OpenFeign encoding buffers the complete
request and may create additional copies.

The new backend-to-SharePoint upload must therefore use Apache HttpClient 5 classic
I/O with a streamed, non-repeatable `InputStream` entity. Feign must remain in place
for all existing non-upload SharePoint operations.

Before editing, inspect the real project and identify:

- the upload controller method and public route;
- the upload service/facade method;
- the existing SharePoint Feign upload method;
- the existing SharePoint Feign configuration and request interceptor;
- `SharePointTokenService` and the exact current-user-id fallback logic;
- the SharePoint site/list resolution flow;
- the existing SharePoint file response DTO and response envelope;
- the existing SharePoint-to-domain mapper;
- the existing exception types and HTTP error translation;
- existing HTTP client configuration and Maven dependencies;
- existing upload tests.

Reuse those structures and naming conventions. Do not create duplicate DTOs, mappers,
token services, site resolvers, exception hierarchies, or response contracts.

---

## 1. Scope and non-goals

This task must:

1. Preserve the existing frontend endpoint, parameters, raw request body, progress
   behavior, and successful response DTO.
2. Replace only the backend-to-SharePoint Feign upload transport with a dedicated
   streaming client.
3. Stream directly from Tomcat's inbound servlet `InputStream` to SharePoint.
4. Enforce a configurable maximum of **250 MB**.
5. Reuse the existing site resolution, authorization, access-token service, DTO,
   mapping, and exception translation.
6. Use one application-managed, pooled Apache HttpClient instance.
7. Disable automatic retries and redirects for the non-repeatable upload body.
8. Return success only after SharePoint returns and the response has been mapped.

This task must not:

- change the Angular frontend;
- change the public backend endpoint;
- use multipart unless the existing public endpoint already requires it;
- buffer the complete file in memory or on disk;
- use `byte[]`, `readAllBytes()`, `MultipartFile.getBytes()`, `ByteArrayOutputStream`,
  Base64, or `FormData` in the upload path;
- use Feign for the upload body;
- remove Feign from other SharePoint operations;
- implement `StartUpload`, `ContinueUpload`, `FinishUpload`, or `CancelUpload`;
- create an empty placeholder file;
- add an upload-session database table, scheduler, cleanup job, or load-balancer
  stickiness;
- automatically retry a failed upload;
- create one HTTP client or connection pool per request;
- introduce WebFlux or reactive HTTP clients;
- perform a preliminary SharePoint folder/file lookup;
- introduce a second SharePoint file DTO or mapper;
- refactor unrelated code.

The SharePoint Server 2016 farm setting will be verified later. For this implementation,
use 250 MB as the application limit, but make it configuration-driven so it can be
changed without recompiling.

---

## 2. Maven dependency

In the Maven module that directly imports Apache HttpClient 5, declare the direct
dependency:

```xml
<dependency>
    <groupId>org.apache.httpcomponents.client5</groupId>
    <artifactId>httpclient5</artifactId>
</dependency>
```

Do not specify a version when Spring Boot dependency management already controls it.
Do not use Apache HttpClient 4 packages (`org.apache.http.*`). All imports for the new
client must use HttpClient 5 packages (`org.apache.hc.*`).

If `httpclient5` is already declared directly in the affected module, reuse it and do
not add a duplicate dependency. Do not rely only on an accidental transitive
dependency when application source directly imports the library.

---

## 3. Upload-size configuration

Reuse an existing typed SharePoint/upload properties class if one exists. Otherwise,
add the smallest appropriately named property to the existing SharePoint properties
structure. Do not create an unrelated generic configuration framework.

Configure:

```yaml
sharepoint:
  upload:
    max-file-size: 250MB
```

Use Spring's `DataSize` if it matches the existing configuration style. The effective
byte limit for this task is:

```java
250L * 1024L * 1024L // 262,144,000 bytes
```

Use `long`, never `int`, for file sizes and `Content-Length`.

The controller/service must reject a declared size greater than the configured maximum
before opening the SharePoint request. Return the application's existing `413 Payload
Too Large` response/error code.

The implementation must also reject a request whose content length is unknown. Return
`411 Length Required` using the project's error-response conventions. The Angular
frontend sends a raw `File`, so the browser normally provides the request length.

Do not apply Spring multipart properties to this raw `application/octet-stream`
endpoint. Record in configuration/documentation that reverse proxies, load balancers,
Tomcat/IIS, and SharePoint must also permit the same request size and sufficiently long
timeouts; do not make unrelated deployment configuration changes in this task.

---

## 4. Preserve the public controller contract

Keep the existing route, path variables, query parameters, authorization annotations,
success status, and public response DTO. Change only how the raw body is obtained and
passed into the service.

Prefer the servlet request input stream for this Spring MVC/Tomcat application:

```java
@PostMapping(
        path = "<preserve-existing-upload-route>",
        consumes = MediaType.APPLICATION_OCTET_STREAM_VALUE
)
public ResponseEntity<ExistingFileResponse> upload(
        // preserve all existing route and query parameters,
        HttpServletRequest request
) throws IOException {
    long contentLength = request.getContentLengthLong();

    // Validate missing/negative length and the configured 250 MB maximum
    // before invoking SharePoint.

    ExistingDomainFile uploadedFile = documentService.upload(
            // preserve existing project/list/folder/name parameters,
            request.getInputStream(),
            contentLength
    );

    return ResponseEntity.status(HttpStatus.CREATED)
            .body(existingMapper.toResponse(uploadedFile));
}
```

Adapt names and return types to the real project. If validation and response mapping
currently belong to a service rather than the controller, keep those responsibilities
where they already live.

Do not change the endpoint to `MultipartFile`. Do not annotate or convert the body to
`byte[]`. Do not read the stream in the controller. The stream must remain open for the
complete synchronous service/client call and must not escape into background or async
work after the servlet request ends.

An empty file is valid when the existing API permits it: `Content-Length: 0` must be
distinguished from an unknown length (`-1`).

---

## 5. Service/facade integration

Update the existing upload method through the current controller -> service/facade ->
SharePoint client chain. Preserve current validation, project authorization,
`(projectId, listKey)` resolution, destination-folder semantics, mapping, and exception
translation.

The internal upload method should carry the stream and declared size without
converting them:

```java
ExistingDomainFile upload(
        String projectId,
        String listKey,
        UUID parentFolderId,
        String fileName,
        InputStream content,
        long contentLength
);
```

Adapt identifier types to the project. Resolve the absolute SharePoint site URI using
the existing list/site configuration path. Then call the new streaming client.

The service/facade remains responsible for:

- domain and permission checks;
- project/list/site resolution;
- validating folder id and decoded filename;
- validating declared upload size;
- calling the streaming transport;
- mapping the existing SharePoint response DTO to the existing domain model;
- translating transport/SharePoint errors through existing conventions.

The streaming client must not query the database, resolve projects/lists, or construct
domain objects.

---

## 6. Dedicated client API

Create a focused client in the existing SharePoint infrastructure/client package.
Follow the project's convention regarding interfaces: if infrastructure clients
normally have interfaces, add one; otherwise, do not create a one-implementation
interface merely for ceremony.

The effective responsibility and signature should resemble:

```java
public ExistingSharePointFileResponse upload(
        URI siteUrl,
        UUID parentFolderId,
        String fileName,
        InputStream content,
        long contentLength
);
```

Use the real folder-id and response-envelope types. Do not pass project ids, list keys,
properties objects, database entities, domain responses, or access tokens when those
belong to the existing surrounding layers or the configured authentication
interceptor.

Suggested name:

```text
SharePointStreamingUploadClient
```

The client must:

- require a non-null absolute site URI;
- require a valid destination folder id;
- require the already validated decoded filename;
- require a non-null `InputStream`;
- require `contentLength >= 0`;
- execute exactly one SharePoint request;
- deserialize SharePoint's small JSON response directly from the response stream;
- return the existing SharePoint response DTO/envelope;
- never map to the public frontend DTO itself.

---

## 7. SharePoint request

Preserve the working endpoint semantics from the existing Feign upload:

```http
POST {siteUrl}/_api/web/GetFolderById('{parentFolderId}')/Files/AddUsingPath(DecodedUrl='{escapedFileName}',Overwrite=false)
    ?$select=UniqueId,Name,ServerRelativeUrl,Length,TimeCreated,TimeLastModified,ListItemAllFields/Editor/Title
    &$expand=ListItemAllFields/Editor
Authorization: Bearer {existing per-user token}
Accept: application/json
Content-Type: application/octet-stream
Content-Length: {contentLength}

{streamed raw file bytes}
```

Use the existing Feign method's exact working OData route, `$select`, `$expand`, Accept
header, and response envelope when they differ from this illustration.

Use the project's existing safe URI/OData construction conventions. Validate the
logical filename before transport construction. Escape an apostrophe inside an OData
string literal as `''`, and let the URI builder perform transport encoding exactly
once. Do not concatenate an unvalidated raw filename into the URL. Preserve support
for names containing spaces, `#`, `%`, `+`, `&`, apostrophes, and Unicode to the extent
already supported by the existing `AddUsingPath` implementation.

Do not set `Overwrite=true`. Preserve `Overwrite=false` and the existing collision
behavior. Do not add `EnsureUniqueFileName=true`.

Do not perform a folder preflight, collision lookup, metadata lookup, or permission
lookup before this request.

---

## 8. Streamed request entity

Use Apache HttpClient 5 classic I/O and `BasicHttpEntity`:

```java
HttpPost request = new HttpPost(uploadUri);

request.setHeader(
        HttpHeaders.ACCEPT,
        MediaType.APPLICATION_JSON_VALUE
);

request.setEntity(
        new BasicHttpEntity(
                content,
                contentLength,
                ContentType.APPLICATION_OCTET_STREAM
        )
);
```

Use imports from `org.apache.hc.client5.*` and `org.apache.hc.core5.*`.

`BasicHttpEntity(InputStream, long, ContentType)` is streamed and non-repeatable. The
entity must retain the original servlet input stream; do not wrap it in a buffering
stream that can grow with the file size. Small fixed-size transport buffers are fine.

Do not manually set an inconsistent `Content-Length`; the entity's declared length
must be the validated inbound length.

Use a response-handler execution method so the connection is released reliably:

```java
return httpClient.execute(request, response -> {
    int status = response.getCode();
    HttpEntity entity = response.getEntity();

    if (status >= 200 && status < 300) {
        if (entity == null) {
            throw existingMissingResponseException();
        }

        try (InputStream responseBody = entity.getContent()) {
            return objectMapper.readValue(
                    responseBody,
                    ExistingSharePointFileResponse.class
            );
        }
    }

    throw translateExistingSharePointError(status, entity);
});
```

Adapt this to the installed HttpClient 5 version and existing SharePoint error parser.
Do not use deprecated `execute` overloads that leave response-resource management to
the caller. Reading the small SharePoint JSON/error response is allowed; buffering the
file request is not.

If execution throws, ensure the request/exchange is cancelled or aborted according to
the installed HttpClient 5 API and all response/connection resources are released.
Do not close the singleton `CloseableHttpClient` after an individual request.

---

## 9. Dedicated Apache client configuration

Create or extend the smallest SharePoint-specific HTTP configuration. Do not replace
the application's general HTTP clients and do not accidentally inject this client into
unrelated code.

Use a named bean and `@Qualifier` if the application contains or may contain another
`CloseableHttpClient`:

```java
@Configuration
public class SharePointStreamingHttpClientConfiguration {

    public static final String SHAREPOINT_STREAMING_HTTP_CLIENT =
            "sharePointStreamingHttpClient";

    @Bean(destroyMethod = "close")
    @Qualifier(SHAREPOINT_STREAMING_HTTP_CLIENT)
    public CloseableHttpClient sharePointStreamingHttpClient(
            SharePointStreamingAuthorizationInterceptor authorizationInterceptor
    ) {
        PoolingHttpClientConnectionManager connectionManager =
                PoolingHttpClientConnectionManagerBuilder.create()
                        .setMaxConnTotal(20)
                        .setMaxConnPerRoute(8)
                        .build();

        RequestConfig requestConfig = RequestConfig.custom()
                // Use existing configurable timeout conventions when present.
                // Values must permit a 250 MB upload on the expected network.
                .build();

        return HttpClients.custom()
                .setConnectionManager(connectionManager)
                .setDefaultRequestConfig(requestConfig)
                .disableAutomaticRetries()
                .disableRedirectHandling()
                .addRequestInterceptorLast(authorizationInterceptor)
                .build();
    }
}
```

This is a structural example, not permission to hard-code duplicate settings. First
inspect existing connection-pool and timeout configuration. Reuse approved values and
properties where they already exist. Otherwise introduce only the focused upload
settings needed by this client. Use sensible connection-acquisition/connect timeouts
and a long configurable response timeout suitable for a 250 MB upload. Do not use a
short default that will terminate valid uploads.

The client is synchronous by design because the servlet input stream is valid only
during the active Spring MVC request. A request occupies a Tomcat request thread while
it streams. Do not move execution to an unbounded executor.

Automatic retries must be disabled because the request entity is non-repeatable.
Redirect handling must be disabled so a redirect cannot attempt to replay the body;
treat unexpected 3xx responses as errors that reveal incorrect site configuration.

---

## 10. Authentication interceptor

Feign's `RequestInterceptor` cannot be reused directly because Apache HttpClient uses a
different interceptor API. Create an Apache HttpClient 5
`org.apache.hc.core5.http.HttpRequestInterceptor`, but mirror the existing SharePoint
Feign configuration's authentication semantics exactly.

Suggested shape:

```java
@Component
public class SharePointStreamingAuthorizationInterceptor
        implements HttpRequestInterceptor {

    private final SharePointTokenService tokenService;

    public SharePointStreamingAuthorizationInterceptor(
            SharePointTokenService tokenService
    ) {
        this.tokenService = tokenService;
    }

    @Override
    public void process(
            HttpRequest request,
            EntityDetails entity,
            HttpContext context
    ) throws HttpException, IOException {
        String userId = resolveUserIdUsingExistingFeignSemantics(request);
        String accessToken = tokenService.getAccessToken(userId);

        request.setHeader(
                HttpHeaders.AUTHORIZATION,
                "Bearer " + accessToken
        );
    }
}
```

Do not literally introduce `resolveUserIdUsingExistingFeignSemantics` without
implementing it. Inspect the existing Feign interceptor and reproduce/reuse its exact
logic:

1. Check the existing request-user-id header using the existing constant.
2. Use its first value when present.
3. Otherwise fall back to the existing `SecurityUtils.getCurrentUserId()` behavior.
4. Call the existing `SharePointTokenService.getAccessToken(userId)`.
5. Set exactly one `Authorization: Bearer ...` header.

Prefer reusing an existing small current-user resolver/helper when available. Do not
create a second token service or OAuth flow. Do not log the token. Do not send the
token, internal user id, or SharePoint configuration in error responses.

If the outgoing Apache request does not naturally contain the internal user-id header,
pass the already resolved user id in a typed `HttpContext` attribute or resolve it
through the exact existing security utility on the same synchronous request thread.
Do not rely on a header that is never added to the Apache request. Choose the smallest
integration consistent with the real code and cover the fallback behavior with tests.

Do not add a form digest, `_api/contextinfo`, `X-RequestDigest`, second access-token
lookup, or new authentication cache when the existing bearer-token flow already works.

---

## 11. Response and mapping

Deserialize the successful SharePoint response into the existing upload/listing file
DTO or response envelope. Do not create an upload-specific duplicate if an existing
DTO represents the same `SP.File` response.

Preserve the existing canonical mapping:

```text
id          <- SharePoint UniqueId
name        <- SharePoint Name
path        <- SharePoint ServerRelativeUrl
size        <- SharePoint Length
createdAt   <- SharePoint TimeCreated
modifiedAt  <- SharePoint TimeLastModified
modifiedBy  <- SharePoint ListItemAllFields.Editor.Title, when present
parentId    <- validated destination parentFolderId when SP.File omits it
```

The SharePoint response is authoritative. Do not reconstruct returned ids, paths,
lengths, or timestamps. Do not add a follow-up SharePoint GET solely to obtain data
already returned or to resolve `parentId`.

---

## 12. Error behavior

Use the project's existing SharePoint exception types, response parser, logging,
correlation-id extraction, and public error translation. Do not create a parallel error
format.

At minimum preserve/map:

- missing `Content-Length` -> `411 Length Required`;
- negative/invalid route or filename -> existing `400` invalid-input error;
- declared length greater than 250 MB -> `413 Payload Too Large`;
- SharePoint missing destination -> existing `404 not-found`;
- `Overwrite=false` collision -> existing `409 name-collision`;
- SharePoint `401/403` -> existing permission/authentication handling;
- SharePoint `429` -> existing retryable/network handling, but do not retry inside the
  streaming client;
- unexpected SharePoint `3xx` -> configuration/transport error, without replay;
- disconnect, timeout, or I/O failure -> existing network/cancel behavior;
- malformed or missing success JSON -> existing unknown/mapping error.

Log SharePoint request/correlation identifiers where existing code does so. Never log
the bearer token, file bytes, or full sensitive error bodies.

Cancellation remains best effort. When the browser aborts the inbound request, reading
Tomcat's input stream should fail/end and the outgoing Apache request must terminate
and release its connection. If SharePoint has already committed the file, the file may
still exist. Do not claim transactional cancellation.

A user retry starts a brand-new request from byte zero. The backend must not
automatically replay the non-repeatable stream.

---

## 13. Remove obsolete upload buffering

After the streaming path is integrated, remove upload-only code that is no longer
used, including as applicable:

- the upload method from the SharePoint Feign client;
- upload-specific Feign encoder configuration;
- `byte[]` upload parameters and conversions;
- the old 10 MiB guard and messages;
- `readAllBytes()` or `ByteArrayOutputStream` upload logic;
- dead upload-only imports, helpers, and tests based on complete-file buffering.

Do not remove Feign configuration needed by other SharePoint calls. Do not remove
shared DTOs, mappers, token services, or error parsing still used elsewhere.

Replace the old limit with the new configurable 250 MB limit everywhere the public
upload path validates or reports maximum size. Do not silently leave the frontend or
backend with contradictory 10 MiB validation if the frontend configuration lives in
the same repository and is part of the existing endpoint contract. If the frontend is
in a separate repository or outside this task, explicitly report that its configured
limit must also be changed to 250 MB; do not redesign it.

---

## 14. Tests

Add focused tests using the project's existing JUnit 5, Mockito, Spring MVC, and HTTP
testing conventions. Do not add a large dependency or allocate real 250 MB arrays in
tests.

At minimum test:

1. A valid raw upload preserves the existing public route and response contract.
2. The servlet `InputStream` and declared `long` length reach the streaming client
   without conversion to `byte[]`.
3. A missing/unknown content length returns `411` and never calls SharePoint.
4. A length of exactly `250 * 1024 * 1024` bytes is accepted by validation without
   allocating that amount in the test.
5. A length of `250 * 1024 * 1024 + 1` bytes returns `413` before opening the outbound
   request.
6. A zero-length file is handled according to the existing valid-empty-file contract.
7. The outbound request uses `POST`, `application/octet-stream`, the declared content
   length, and the existing Accept header.
8. The outbound entity is streaming and non-repeatable.
9. The request targets the existing `GetFolderById(...)/Files/AddUsingPath(...)` route
   with `Overwrite=false`.
10. Filenames with spaces, apostrophes, `#`, `%`, `+`, `&`, and Unicode are encoded
    according to the existing approved URI conventions.
11. The Apache authentication interceptor calls the existing token service using the
    same user-id resolution/fallback semantics as the Feign configuration.
12. Exactly one Bearer authorization header is sent and the token is not logged.
13. A successful SharePoint JSON response is deserialized into the existing response
    DTO and mapped through the existing mapper.
14. No follow-up SharePoint lookup occurs after a successful upload.
15. Collision, permission, throttling, and unknown errors use existing translation.
16. Automatic retry is disabled; one service invocation produces one outbound upload
    attempt.
17. Response resources/connections are released after both success and error.
18. The dedicated client is a singleton/application bean rather than created per
    request.

Use a small deterministic input stream or a counting/generating stream in unit tests.
Never construct a 250 MB `byte[]` merely to verify the size boundary.

Where practical, test the client against the project's existing local HTTP test server
or a lightweight mock server and assert the received bytes for a small payload. Do not
mock so deeply that the test cannot prove the request entity is streamed.

---

## 15. Verification and final response

After implementation:

1. Run the focused upload/client/controller tests.
2. Run all tests for the affected Maven module.
3. Compile/package the affected Maven module using the project's normal command.
4. Run formatting/static analysis when configured.
5. Search the upload path for obsolete buffering operations and the old 10 MiB limit.
6. Inspect the final Maven dependency tree if needed to confirm HttpClient 5 is used.
7. Do not claim a test passed unless it actually ran successfully.

In the final response, provide:

- the exact files changed;
- the responsibility of each new or changed class;
- the final controller method signature;
- the final service/facade upload signature;
- the complete streaming client implementation;
- the complete Apache client configuration;
- the complete authentication interceptor;
- how the 250 MB property is declared and enforced;
- confirmation that the original frontend endpoint and DTO are unchanged;
- confirmation that the request body is never converted to `byte[]`;
- confirmation that automatic retries and redirects are disabled;
- test and build commands with their real results;
- any remaining reverse-proxy, Tomcat, IIS, SharePoint, or timeout configuration that
  must be verified operationally.

Do not expand the task beyond the streaming upload transport. Implement the changes
now.
