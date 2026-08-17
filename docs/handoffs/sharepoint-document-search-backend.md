# SharePoint Recursive Document Search — Backend Implementation Context

Implement the backend endpoint described below in the backend repository. This prompt
is intentionally self-contained so it can be copied into another workspace.

The frontend and SharePoint capability investigation are complete. Implement the
agreed first version directly; do not restart the endpoint-selection investigation.

## Required outcome

Add this public endpoint:

```http
GET /projects/{projectId}/document-lists/{listKey}/documents/{folderId}/search?q={query}
```

Example:

```http
GET /projects/123/document-lists/EXECUTION/documents/8ac4.../search?q=contract
```

It searches file and folder **names only**, case-insensitively, inside the selected
folder and all of its descendants in exactly one configured document list.

The response is a JSON array of the same complete canonical file/folder nodes returned
by the normal document-listing endpoints:

```json
[
  {
    "kind": "file",
    "listKey": "EXECUTION",
    "id": "a3f91b7e-5fc8-41ff-a90c-e3624ba43a54",
    "name": "Contract 2026.docx",
    "path": "/sites/project/Execution Documents/Contracts/Contract 2026.docx",
    "parentId": "51ff8ae2-01bc-4dac-8857-86be4562c3c1",
    "sizeBytes": 184320,
    "createdAt": "2026-08-01T08:20:00Z",
    "modifiedAt": "2026-08-12T14:45:00Z",
    "modifiedBy": "Jane Doe",
    "onlineUrl": "https://sharepoint.example/.../Contract%202026.docx",
    "desktopUrl": "ms-word:ofe|u|https://sharepoint.example/.../Contract%202026.docx",
    "downloadUrl": "https://sharepoint.example/.../Contract%202026.docx?download=1"
  }
]
```

A folder result uses the existing canonical folder-node fields instead:

```text
kind, listKey, id, name, path, parentId, itemCount,
createdAt, modifiedAt, modifiedBy, webUrl
```

Use the exact casing and JSON conventions already used by the existing document-listing
endpoints. The frontend expects `kind` values compatible with its existing `file` and
`folder` discriminators and `listKey` values `EXECUTION` or `MARKETING`.

---

## Start by inspecting the backend

Before editing, inspect the existing implementations for:

- document-list root retrieval;
- folder children retrieval;
- path resolution;
- folder retrieval by SharePoint `UniqueId`;
- file/folder canonical DTO mapping;
- file `onlineUrl`, `desktopUrl`, and `downloadUrl` construction;
- folder `webUrl` construction;
- SharePoint paging, if another operation already implements it;
- validation, authorization, and exception mapping.

Use the real package names, DTOs, mapper configuration, client conventions, and method
names from the repository. Examples in this prompt describe behavior, not names that
must be copied blindly.

The SharePoint folder-by-ID operation already exists, although its method/class name
may differ. Find it by behavior and reuse it. Do **not** create a duplicate
`GetFolderById` client/facade operation merely because the name differs from this
prompt.

Preserve the established layering:

```text
authenticated SharePoint Feign client
    -> SharePoint/document facade
    -> MapStruct boundary
    -> document service
    -> MapStruct boundary
    -> REST controller
```

Mirror a completed document operation end to end. Do not collapse the facade into the
service, call Feign directly from the controller/service, or hand-map controller DTOs
when this codebase uses MapStruct at that boundary.

Use a dedicated search mapper for the different raw SharePoint list-item shape, but
reuse existing canonical node/link mapping helpers through the repository's normal
MapStruct composition style (`uses`, mapper configuration, and context parameters as
appropriate). Do not duplicate URL-building or timestamp-conversion logic in the
service.

---

## Public endpoint contract

### Request

```http
GET /projects/{projectId}/document-lists/{listKey}/documents/{folderId}/search?q={query}
```

- `projectId`: existing project identifier and authorization boundary.
- `listKey`: exactly one domain document list, `EXECUTION` or `MARKETING`.
- `folderId`: the SharePoint folder `UniqueId`; it may identify the list root.
- `q`: required, trimmed, minimum three characters.

Do not accept any of the following from the frontend:

- SharePoint site URL;
- SharePoint list/library GUID;
- server-relative scope path;
- paging URL, cursor, item ID, or skip token;
- access token;
- client-controlled result limit;
- `kind` filter;
- an instruction to search both lists.

This endpoint searches one list and one folder subtree per request. It is not the old
project-wide `/projects/{projectId}/documents/search` proposal.

### Validation and errors

- Trim `q`; reject missing or fewer-than-three-character queries with the project's
  normal `400 Bad Request` validation response.
- Resolve and authorize `projectId + listKey` through the existing backend-owned
  configuration flow.
- Reuse the existing not-found/error mapping for an unknown folder.
- If the folder exists on the SharePoint site but is outside the configured library,
  reject it using the existing not-found/ownership-safe response; do not reveal data
  from another library.
- Reuse the existing SharePoint permission, throttling, token-expiry, correlation-ID,
  and transport-error handling. Do not create search-specific authentication logic.

---

## Critical scope-resolution step

The request intentionally contains `folderId`, not a path. Java cannot filter the
subtree until the backend resolves that trusted ID to its canonical SharePoint path.

Before scanning the list, call the **existing** folder-by-ID operation and obtain at
least:

```text
UniqueId
ServerRelativeUrl
```

Its underlying SharePoint request is logically equivalent to:

```http
GET {configuredSiteUrl}/_api/web/GetFolderById('{folderId}')
    ?$select=UniqueId,ServerRelativeUrl
```

If the existing operation returns a richer canonical folder, reuse it rather than
adding a narrower duplicate call.

Let:

```text
scopePath       = resolved folder ServerRelativeUrl
libraryRootPath = configured/canonical document-library root ServerRelativeUrl
```

Normalize paths only for comparison:

- decoded SharePoint path values, not URL strings;
- normalized slash direction;
- no duplicate trailing slash except `/` itself;
- case-insensitive comparison using `Locale.ROOT`;
- preserve SharePoint's canonical decoded casing in returned DTOs.

Validate:

```text
scopePath == libraryRootPath
OR
scopePath starts with libraryRootPath + "/"
```

The slash boundary is mandatory. `/Contracts-old` is not inside `/Contracts`.

Never replace this resolution with a path supplied by Angular. The client path may be
stale or manipulated; the folder ID and backend-owned list configuration define the
trusted scope.

---

## SharePoint list-item scan

Use the ordinary document-library list-items collection that was verified on the
target farm:

```http
GET {configuredSiteUrl}/_api/web/lists(guid'{configuredLibraryId}')/items
```

Request the existing transport DTO's exact equivalents of these values:

```text
ID
UniqueId
FileLeafRef
FileRef
FileDirRef
FSObjType
Created
Modified
Editor/Title
File/Length
Folder/ItemCount
```

Expand the relationships required by the real SharePoint DTO, normally:

```text
Editor
File
Folder
```

Reuse already-existing projections and link generation required by the normal listing
mapper. Do not introduce a second definition of what constitutes a canonical
file/folder node.

Use a bounded SharePoint page size consistent with the verified request (up to 1000)
and a stable ID ordering if the endpoint/client already expresses it. The list may
contain more than the 5000-item view threshold; page size does not imply total size.

### Continuation paging

The ordinary `/items` response exposes SharePoint's continuation link/token. Follow it
iteratively until no next value remains.

- Never use recursion for the Java paging loop.
- Never calculate an offset or `lastId + pageSize`.
- Never accept a continuation value from Angular.
- The continuation originates only from the authenticated SharePoint response.
- Reuse an existing safe continuation/paging helper if present.
- If no helper exists, validate that the next value belongs to the configured
  SharePoint site and exact list-items operation, then carry its opaque continuation
  query through the same configured Feign client. Do not retarget the client from
  untrusted request data.
- Preserve the existing query projection across pages as required by the target farm's
  returned continuation.

Do not use any of the rejected alternatives:

- SharePoint Search REST;
- folder-scoped `POST GetItems` with recursive CAML;
- `RenderListDataAsStream` recursive search;
- one request per folder traversal;
- a new application-owned index;
- a threshold override.

---

## Java filtering

The search is name-only and recursive beneath `scopePath`. Do not search file content,
metadata values, editor names, or paths as query text.

Normalize the query once:

```java
String normalizedQuery = query.trim().toLowerCase(Locale.ROOT);
```

For each item row, use the canonical decoded `FileRef` and `FileLeafRef`:

```java
String scopePrefix = normalizedScopePath + "/";

boolean insideScope = normalizedFileRef.startsWith(scopePrefix);
boolean nameMatches = normalizedFileLeafRef.contains(normalizedQuery);
```

Only include a row when both conditions are true.

This includes all descendants while excluding the scope folder itself:

```text
scope: /sites/P/Execution Documents/Contracts

include:
  /sites/P/Execution Documents/Contracts/file.docx
  /sites/P/Execution Documents/Contracts/2026/file.docx

exclude:
  /sites/P/Execution Documents/Contracts
  /sites/P/Execution Documents/Contracts-old/file.docx
  /sites/P/Execution Documents/Finance/file.docx
```

Apply scope filtering before retaining a match. A zero-match query still scans every
page because the filename predicate is intentionally evaluated in Java.

---

## Canonical `parentId` without one request per result

The public node contract requires `parentId`, while a file list-item row gives the
parent path as `FileDirRef`; the target REST `SP.File` representation does not expose
`ParentFolder`.

During the same list scan, build a lookup for **every folder row**, not only matching
folders:

```text
normalized folder FileRef -> folder UniqueId
```

Seed the lookup with the known document-library root path/id and the resolved scope
path/id when appropriate. Retain matching rows until the scan completes, then resolve:

```text
result.parentId = folderIdByPath[normalize(result.FileDirRef)]
```

This supports a matching row that appears before its parent folder row in SharePoint's
page order. Do not assume parents always have lower list-item IDs.

Do not call SharePoint once per result or once per parent. If a non-root parent cannot
be resolved after the complete scan, treat that as an integration/mapping error using
the project's normal error handling; never fabricate a GUID or use the path as an ID.

---

## Mapping responsibilities

Keep SharePoint transport DTOs private to the integration/facade layer.

### SharePoint row normalization

Map the verified mixed list-item shape into an internal normalized representation:

```text
ID                 -> paging/logging only
UniqueId           -> id
FSObjType           -> file/folder discriminator
FileLeafRef         -> name
FileRef             -> canonical server-relative path
FileDirRef          -> canonical parent server-relative path
Created             -> createdAt
Modified            -> modifiedAt
Editor.Title        -> modifiedBy
File.Length         -> file sizeBytes (parse safely as long)
Folder.ItemCount    -> folder itemCount
```

Use the backend route/configuration for `listKey`; SharePoint does not own that domain
value.

### Public canonical node mapping

The result must contain the same canonical node information as normal listing
responses, because the frontend performs rename, delete, copy, online/local open, and
download directly from search results.

For files, reuse the existing helpers/mappers for:

```text
onlineUrl
desktopUrl
downloadUrl
```

For folders, reuse the existing helper/mapper for:

```text
webUrl
```

Do not manually rebuild these URLs in the search service or mapper.

Do not add search-specific path fields. `path` remains the canonical SharePoint
server-relative item path, exactly as it does for normal listing results. The frontend
already has the canonical document-library root node and derives a list-relative path
by removing that root path boundary from `path`.

MapStruct should perform structural conversion at the existing mapper boundaries.
Paging, authorization, scope checks, query matching, and lookup construction are
service/facade logic, not mapper logic.

---

## Response shape and result size

The Angular request sends no `limit`.

Return all matching canonical nodes as a plain JSON array. Do not add a response
wrapper, `totalMatches`, `truncated`, a new result cap, or a client-controlled limit.
The frontend uses the returned array length as the displayed count.

---

## Call count and performance shape

A successful search performs:

```text
1 existing folder-by-ID read
+ N ordinary list-item page reads
```

It performs no per-result, per-parent, or per-subfolder SharePoint calls.

Keep the paging loop iterative. Hold only what is needed for the final mapping:

- the folder path-to-ID lookup;
- retained matching normalized rows/results;
- counters and continuation state.

Use the backend's existing logging conventions. Useful non-sensitive diagnostics are:

```text
project/list identity (domain identifiers, not credentials)
folderId
page count
scanned row count
match count
duration
SharePoint correlation/request id on failure
```

Never log bearer tokens or continuation URLs containing sensitive routing/query data.
Avoid logging document names at normal production levels.

---

## Authentication and configuration — do not change

Authentication/token generation is already implemented.

- Reuse the existing authenticated Feign client and interceptor.
- Reuse the existing token cache and certificate-backed/user-context flow.
- Do not add token endpoints, token DTOs, another cache, or manual Authorization
  headers in the service.
- Do not add form-digest calls for these GET operations.
- Resolve SharePoint site/library configuration only through the existing
  `projectId + listKey` configuration component.
- Keep Feign base URLs/configuration in their existing configuration mechanism.

The other implementation prompts may use different class names. Inspect the backend
and follow its actual conventions.

---

## Frontend behavior this contract supports

The frontend is already implemented against:

```text
searchDocuments(projectId, scopeFolder, query)
```

Its adapter extracts:

```text
scopeFolder.listKey -> {listKey}
scopeFolder.id      -> {folderId}
query               -> q
```

Search results are transient and are not automatically inserted into the normal
entity cache.

- Folder double-click opens the folder.
- File double-click opens `onlineUrl`.
- Folder navigation and `Open File Location` derive the list-relative target from the
  canonical result `path` and the already-loaded canonical library-root `path`.
- Rename/delete/copy/open/download use the complete canonical node returned by search.
- Copy retains the complete source node until Paste.
- Back/Forward reruns the saved scope/query.

Do not change this public response into raw SharePoint list-item DTOs or require the
frontend to hydrate every selected result.

---

## Explicit non-goals

Do not implement or refactor:

- frontend code;
- authentication/token generation;
- project/list configuration ownership;
- existing mutation endpoints;
- SharePoint Search REST;
- CAML recursive search;
- `RenderListDataAsStream` search;
- per-folder recursive traversal;
- an application search index;
- client-driven pagination;
- search result caching;
- background synchronization;
- unrelated DTO/mapper/controller cleanup.

Do not rename existing APIs or reorganize packages merely to match names in this
prompt.

---

## Definition of done

The work is complete when:

1. The public folder-scoped endpoint exists with the exact agreed route.
2. The backend resolves `folderId` through the existing folder-by-ID operation before
   filtering.
3. The resolved path is verified to belong to the configured library.
4. All SharePoint `/items` pages are followed iteratively.
5. Java applies slash-bounded subtree filtering plus case-insensitive name matching.
6. Mixed file/folder rows map to complete canonical nodes with correct parent GUIDs.
7. The endpoint returns a plain array of the same canonical nodes used by normal
   document listing, with no search-specific DTO properties or response wrapper.
8. Existing layering, authentication, configuration, mappers, URL builders, and error
   handling are reused.
9. No rejected fallback strategy or unrelated refactor is introduced.

After implementation, report:

- files changed;
- actual existing classes/methods that were reused;
- public request/response shape;
- SharePoint call and paging flow;
- mapping decisions;
- any remaining blocker supported by concrete evidence.

Do not commit or push unless explicitly requested.
