# SharePoint List-Item Search — Postman Verification and Backend Candidate

> **Status: preferred first-release candidate; target-farm verification in progress.**
> Search REST did not behave as expected in the initial manual checks and did not
> expose a convenient canonical document shape. This guide verifies the simpler
> document-library list-item approach before the backend contract is finalized.
>
> Do not implement the backend from assumptions alone. Retain the completed result
> sheet and representative file, folder, paging, permission, threshold, and error
> responses from the target farm.
>
> The mixed-row projection has now been partially verified: `Editor/Title` works when
> selected and expanded, and file size works through expanded `File/Length`. The
> folder-scoped `POST GetItems` variant has a focused copy-paste guide in
> [verify-sharepoint-folder-scoped-item-search.md](verify-sharepoint-folder-scoped-item-search.md).
> Target-farm testing established that this POST response does not expose the ordinary
> `/items` collection's `d.__next`, even with a one-row CAML page; the focused guide now
> uses explicit, indexed `ID > lastItemId` keyset paging instead.

## Recommendation to verify

Use the SharePoint document-library **list items** endpoint. A document library stores
both files and folders as list items, so one endpoint can enumerate both kinds:

```http
GET {siteUrl}/_api/web/lists(guid'{libraryId}')/items
```

For the first backend implementation:

1. page through the selected configured project library without a server-side name filter;
2. follow SharePoint's continuation URL/token;
3. normalize each returned row;
4. apply case-insensitive filename matching in Java;
5. keep rows inside the requested scope path and map matches to canonical application nodes;
6. return those nodes with list-relative item and parent paths for navigation.

This is a delivery-oriented candidate, not a claim that list-item scanning scales
indefinitely. The performance and threshold tests below decide whether it is safe for
the real project libraries.

## Why not `/Files` or `/Folders`?

The folder collections are useful for browsing one known folder:

```http
GET {siteUrl}/_api/web/GetFolderById('{folderId}')/Files
GET {siteUrl}/_api/web/GetFolderById('{folderId}')/Folders
```

They are not the preferred project-wide search source because:

- `/Files` returns files only;
- `/Folders` returns folders only;
- each call is scoped to one folder's direct children;
- recursively traversing the hierarchy requires many calls and complicated failure
  handling.

The library `/items` collection mixes file and folder rows and is therefore the API
to verify first.

## What the list-item row can provide

Request these SharePoint fields and verify their exact target-farm representation:

| SharePoint field | Meaning | Domain mapping |
|---|---|---|
| `ID` | Integer list-item id, useful for stable paging order | Backend implementation detail |
| `UniqueId` | Stable SharePoint GUID | `id` |
| `FileLeafRef` | File or folder name | `name` |
| `FileRef` | Full server-relative item path | `path` |
| `FileDirRef` | Full server-relative parent path | parent lookup + navigation path |
| `FSObjType` | File/folder discriminator (`0` file, `1` folder) | `kind` |
| `File/Length` | Canonical file size in bytes; requires expanding `File` | `sizeBytes` for files |
| `File_x0020_Type` | File extension | `extension` |
| `Folder/ItemCount` | Direct child count for a folder; requires expanding `Folder` | `itemCount` |
| `Created` | Creation timestamp | `createdAt` |
| `Modified` | Modification timestamp | `modifiedAt` |
| `Editor/Title` | Last modifier's display name | `modifiedBy` |

The list fields above are SharePoint document-library internal names. `FileLeafRef`
contains only the item name, while `FileRef` contains the full server-relative path.
`File` and `Folder` are related REST resources. The target farm does expose the schema
field `File_x0020_Size`, but it does not project that field reliably through this OData
collection. Use `File/Length`, which has been manually verified, as the canonical size.

The public search row **is** a complete `FolderNode` or `FileNode`. Build a
`serverRelativePath -> UniqueId` folder lookup while scanning the list so `FileDirRef`
can map to the canonical `parentId` without a request per result. Reuse the normal
mapping/link-building helpers for `itemCount`, `contentType`, `webUrl`, `onlineUrl`,
`desktopUrl`, and `downloadUrl`; do not expose the raw SharePoint item DTO.

## Proposed domain search result

The backend should isolate Angular from SharePoint's list-row shape:

```json
{
  "listKey": "EXECUTION",
  "id": "a3f91b7e-5fc8-41ff-a90c-e3624ba43a54",
  "kind": "file",
  "name": "Contract 2026.docx",
  "path": "/sites/project/Execution Documents/Contracts/Contract 2026.docx",
  "parentId": "51ff8ae2-01bc-4dac-8857-86be4562c3c1",
  "listRelativePath": "Contracts/Contract 2026.docx",
  "parentListRelativePath": "Contracts",
  "sizeBytes": 184320,
  "contentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "createdAt": "2026-08-01T08:20:00Z",
  "modifiedAt": "2026-08-12T14:45:00Z",
  "modifiedBy": "Jane Doe",
  "onlineUrl": "https://sharepoint.example/.../Contract%202026.docx",
  "desktopUrl": "ms-word:ofe|u|https://sharepoint.example/.../Contract%202026.docx",
  "downloadUrl": "https://sharepoint.example/.../Contract%202026.docx?download=1"
}
```

- `listKey` is supplied by the domain route/configuration, not by SharePoint.
- `listRelativePath` and `parentListRelativePath` are derived by the backend from the
  configured library root and canonical `FileRef`/`FileDirRef` values.
- Folder results use the normal `FolderNode` shape and omit file-only fields.
- Never fabricate a missing UUID, path, or kind.

### Selection behavior

- Double-clicking a **folder** navigates to `listKey + listRelativePath` through the existing
  path-resolution flow.
- Double-clicking a **file** opens its `onlineUrl`. `Open File Location` in the context
  menu navigates to `listKey + parentListRelativePath`.
- Item operations use the complete result node directly. Search results remain
  transient and are not inserted into the normal entity cache.

---

# Postman verification

## Values to prepare

Use the existing bearer-token configuration and create these environment variables:

```text
executionSiteUrl
executionLibraryId
executionLibraryServerRelativeUrl

marketingSiteUrl
marketingLibraryId
marketingLibraryServerRelativeUrl

probePrefix = PdItemSearchProbe20260813
```

Use canonical decoded SharePoint values. Let Postman encode query parameters.

## Test data

Create disposable files and folders in both project libraries:

```text
EXECUTION
└── PdItemSearchProbe20260813ExecutionFolder
    ├── PdItemSearchProbe20260813ExecutionFile.docx
    └── Nested
        └── PdItemSearchProbe20260813DeepFile.txt

MARKETING
└── PdItemSearchProbe20260813MarketingFolder
    ├── PdItemSearchProbe20260813MarketingFile.xlsx
    └── Nested
        └── PdItemSearchProbe20260813DeepFolder
```

Also identify or create a library containing more than 5,000 total items. Testing only
against a small library cannot validate the proposed threshold strategy.

## Test 0 — Confirm both sites and libraries

Execution:

```http
GET {{executionSiteUrl}}/_api/web/lists(guid'{{executionLibraryId}}')
    ?$select=Id,Title,ItemCount,RootFolder/UniqueId,RootFolder/ServerRelativeUrl
    &$expand=RootFolder
```

Marketing:

```http
GET {{marketingSiteUrl}}/_api/web/lists(guid'{{marketingLibraryId}}')
    ?$select=Id,Title,ItemCount,RootFolder/UniqueId,RootFolder/ServerRelativeUrl
    &$expand=RootFolder
```

Headers:

```http
Authorization: Bearer {{token}}
Accept: application/json;odata=verbose
```

Verify HTTP 200, the expected library title and root path, and record `ItemCount`, the
`MicrosoftSharePointTeamServices` header, and `SPRequestGuid`/request id.

## Test 1 — Mixed file/folder item projection

Run against Execution first:

```http
GET {{executionSiteUrl}}/_api/web/lists(guid'{{executionLibraryId}}')/items
```

Add these values in Postman's **Params** tab:

| Key | Value |
|---|---|
| `$select` | `ID,UniqueId,FileLeafRef,FileRef,FileDirRef,FSObjType,File_x0020_Type,Created,Modified,File/Length,Folder/ItemCount,Editor/Title` |
| `$expand` | `File,Folder,Editor` |
| `$orderby` | `ID asc` |
| `$top` | `1000` |

Headers:

```http
Authorization: Bearer {{token}}
Accept: application/json;odata=verbose
```

Then repeat with `marketingSiteUrl` and `marketingLibraryId`.

Verify:

- HTTP 200;
- file rows and folder rows are both present;
- deeply nested rows appear without manually expanding folders;
- every row has a usable name, path, UUID, and kind;
- `File.Length` and extension are usable for file rows;
- folder rows have no byte size; `Folder.ItemCount` is a child count when available;
- timestamps are UTC-compatible;
- `Editor.Title` is present when the user field can be expanded;
- the response contains no document bytes.

Keep one complete file row and one complete folder row from each list.

The target farm has already confirmed the projection rules that OData requires:
`Editor/Title` must be selected when `Editor` is expanded, and `File/Length` must be
selected when `File` is expanded. Expanding a relationship without selecting a target
field is invalid. `File.Length` may be serialized as a string; parse it as a
non-negative Java `long`.

### If a selected field is rejected

Do not guess silently. Run the unprojected diagnostic request:

```http
GET {{executionSiteUrl}}/_api/web/lists(guid'{{executionLibraryId}}')/items?$top=1
```

Keep the complete error and the diagnostic row. Record which internal name differs on
the target farm. If the list row does not expose the real file/folder `UniqueId`, test
the canonical by-id/file-folder navigation properties before changing the domain id
contract. The application requires SharePoint's stable file/folder GUID, not merely
the integer list-item `ID`.

## Test 2 — Prove the kind mapping

From Test 1, compare at least one known file and folder:

| Check | File | Folder |
|---|---|---|
| `FileLeafRef` equals visible name | | |
| `FileRef` opens/resolves the expected object | | |
| `FileDirRef` equals expected parent path | | |
| `FSObjType` value | expected `0` | expected `1` |
| `UniqueId` present | | |
| Size behavior | | |

Optionally test server-side kind filters as capability checks:

```text
$filter=FSObjType eq 0
$filter=FSObjType eq 1
```

These filters are not needed by the proposed production scan; Java can classify the
already returned rows.

## Test 3 — Canonical UUID hydration

Use the `UniqueId` returned by Test 1.

File:

```http
GET {{executionSiteUrl}}/_api/web/GetFileById('{{fileUniqueId}}')
    ?$select=UniqueId,Name,ServerRelativeUrl,Length,TimeCreated,TimeLastModified,ListItemAllFields/Editor/Title
    &$expand=ListItemAllFields/Editor
```

Folder:

```http
GET {{executionSiteUrl}}/_api/web/GetFolderById('{{folderUniqueId}}')
    ?$select=UniqueId,Name,ServerRelativeUrl,ItemCount,TimeCreated,TimeLastModified,ListItemAllFields/Editor/Title
    &$expand=ListItemAllFields/Editor
```

Verify that name, path, kind, UUID, metadata, and capability links agree with the
list-item mapping. This is a diagnostic comparison for the canonical search mapper,
not a per-result hydration step in the production algorithm.

## Test 4 — Paging

This test describes the ordinary OData `GET .../items` endpoint used in this broader
guide. It does not describe the folder-scoped `POST .../GetItems` operation. The latter
has no next link on the target farm and must follow the explicit ID-cursor test in
`verify-sharepoint-folder-scoped-item-search.md`.

In an `application/json;odata=verbose` response, SharePoint normally returns the next
page as `d.__next`. Other metadata modes may use an OData next-link property.

1. Call page 1 with `$orderby=ID asc&$top=1000`.
2. Call the exact continuation URL returned by SharePoint.
3. Continue until no continuation remains.
4. Do not manufacture an ordinary `$skip` value.

Record for every page:

```text
Page number:
HTTP status:
First ID:
Last ID:
Row count:
Continuation present?:
Response time:
SPRequestGuid:
```

Verify:

- IDs increase across page boundaries;
- no duplicate `ID` or `UniqueId` appears;
- nested files and folders remain present;
- the final distinct-row count is reasonable compared with library `ItemCount`;
- repeating the scan gives stable results when the library is unchanged.

## Test 5 — More-than-5,000-item threshold

This test is mandatory. Run the unfiltered, ordered, paged Test 1 request against a
library containing more than 5,000 items.

Pass criteria:

- page 1 succeeds rather than returning the list-view-threshold error;
- every continuation page succeeds;
- the scan completes without changing the farm's threshold configuration;
- no query runs as an administrator/auditor threshold override;
- total call count and wall-clock duration are acceptable;
- the same bearer-token user used by the application performs the test.

Important distinction: a page size below 5,000 does not automatically make every
query threshold-safe. The threshold concerns how many rows SharePoint must process.
This candidate avoids a name predicate and uses a stable ID ordering, but only the
real-farm test proves that the exact request plan works in this environment.

## Test 6 — Server-side name filtering diagnostic

This is diagnostic only; it is not the proposed production request.

```text
$filter=substringof('PdItemSearchProbe20260813',FileLeafRef)
```

Run it against a small library and then the more-than-5,000-item library. Record:

- matching behavior and case behavior;
- whether files and folders are both returned;
- whether nested items are returned;
- whether the large library raises a threshold error;
- query duration and correlation id.

Even if this succeeds once, do not assume arbitrary `$filter` expressions are safe.
Indexed-column selectivity, filter order, operator choice, library size, and farm
configuration affect threshold behavior.

## Test 7 — Java-equivalent name behavior

After retrieving all pages, verify the intended backend match locally/manually against
`FileLeafRef`:

- trim the user query;
- reject fewer than 3 characters;
- compare case-insensitively with `Locale.ROOT` semantics;
- match the item name only, not document content or other metadata;
- include both files and folders;
- preserve canonical casing in the result;
- support spaces, apostrophes, ampersands, parentheses, accents, and long names.

Record whether accent-insensitive matching is a product requirement. Do not add accent
folding implicitly: it can cause surprising matches and must be consistent between the
backend and UI.

## Test 8 — Permissions

Repeat the complete scan with:

1. a user authorized for both project lists;
2. a user denied access to one list;
3. if applicable, a user denied access to a protected folder or item.

Pass criteria:

- unauthorized names, paths, and UUIDs never appear;
- authorized results still appear;
- a completely inaccessible list produces a controlled per-list permission result;
- the backend continues using the current user's existing cached OAuth bearer token;
- no service/admin identity is introduced to bypass SharePoint permission trimming.

## Test 9 — Mutation freshness

Because list items read the library rather than a search crawl index, verify expected
freshness directly:

```text
Create file visible immediately?:
Create folder visible immediately?:
Rename old name disappears immediately?:
Rename new name visible immediately?:
Move new path visible immediately?:
Delete result disappears immediately?:
```

Keep any response demonstrating unexpected staleness.

## Test 10 — Realistic performance

Measure both libraries separately and together:

```text
Execution item count:
Execution pages:
Execution full-scan time:

Marketing item count:
Marketing pages:
Marketing full-scan time:

Combined rows scanned:
Combined matches:
Combined backend-equivalent time:
Peak response/page size:
Concurrent users tested:
```

Test at least a common query and a query with zero matches. A zero-match query still
requires a complete scan, so it exposes the worst-case cost of Java-side filtering.

---

# Backend candidate contract

Only adopt this section after the Postman checks pass.

## Domain endpoint

```http
GET /projects/{projectId}/documents/search?q={query}&kind={all|file|folder}&limit={limit}
```

Suggested rules:

- `q` is required, trimmed, and at least 3 characters;
- `kind` defaults to `all`;
- `limit` has a small backend-owned maximum, for example 100;
- both `EXECUTION` and `MARKETING` are searched independently when available;
- one unavailable list does not discard results from the other;
- never silently return an incomplete scan as if it were complete.

Example response:

```json
{
  "results": [],
  "totalMatches": 0,
  "truncated": false,
  "lists": {
    "EXECUTION": { "status": "searched" },
    "MARKETING": { "status": "searched" }
  }
}
```

If a safety timeout or scan ceiling is introduced, expose an explicit incomplete/error
status. Do not silently label the first matches in ID order as the complete result set.

## Backend algorithm

For the route-selected domain list:

1. authorize `projectId` and resolve backend-owned `(projectId, listKey)` configuration;
2. create the first SharePoint request using the verified projection, `ID asc`, and a
   bounded page size: `/items` for a whole-list scan or `GetItems` for CAML folder
   scope;
3. send it through the existing authenticated Feign client;
4. page iteratively: follow SharePoint's continuation for `/items`, or use the final
   returned ID as `ID > lastItemId` for the target-farm `GetItems` response;
5. normalize each row and match only `FileLeafRef` in Java;
6. collect at most the public result limit while continuing far enough to know whether
   the response is truncated;
7. map matches to canonical nodes, add list-relative navigation paths, and return them.

Implementation constraints:

- use an iterative loop, not recursive Java calls;
- do not accept SharePoint site URLs, library ids, or continuation URLs from Angular;
- if following an absolute `/items` next link, validate it against the configured
  site/library or extract the opaque continuation token and rebuild the known endpoint;
- for `GetItems`, derive `lastItemId` only from the previous SharePoint page; never
  accept a paging cursor from Angular or manufacture an offset;
- escape and encode query parameters through the existing URI builder;
- cancel superseded searches where the client/backend stack supports cancellation;
- apply only a small, bounded retry policy to idempotent GET failures;
- log page count, scanned-row count, match count, duration, and SharePoint correlation
  ids without logging bearer tokens or sensitive document names unnecessarily;
- do not run this operation on every keystroke.

## Frontend behavior

- submit search on Enter or after an explicit action; do not scan both libraries on
  every key event;
- require at least 3 characters;
- show a search-specific loading state;
- render the canonical result nodes in a search-specific view with name, kind,
  location/list, modified date, and optional size;
- double-click opens a folder result or a file's online application; locating a file is
  an explicit context-menu action;
- clearly show partial-list failures or an explicit incomplete-scan state;
- expose normal item actions from search without inserting the rows into the entity cache.

## When this candidate must be rejected

Do not adopt a full list scan if real measurements show unacceptable latency, request
volume, SharePoint load, timeout frequency, or concurrent-user behavior. Do not hide
those problems behind a larger threshold or administrator override.

If rejected, return to the alternatives in this order:

1. `RenderListDataAsStream` if its real-farm in-place search is recursive,
   permission-trimmed, fresh, pageable, and threshold-safe;
2. SharePoint Search REST with the necessary crawl/search-schema ownership and
   canonical by-id hydration;
3. an application-owned index only with an explicit synchronization and permission
   model.

Recursive `/Files` and `/Folders` traversal is not the fallback for project-wide
search.

# Result sheet

```text
Date:
Tester:
SharePoint version/header:
Execution site/library:
Marketing site/library:

Test 0 — Configuration
Execution status/title/item count/root:
Marketing status/title/item count/root:

Test 1 — Mixed list items
Execution status:
Marketing status:
File row retained?:
Folder row retained?:
Deep file returned?:
Deep folder returned?:
Rejected/missing fields:

Test 2 — Kind mapping
File FSObjType:
Folder FSObjType:
Files-only diagnostic:
Folders-only diagnostic:

Test 3 — UUID hydration
File hydration status/match:
Folder hydration status/match:

Test 4/5 — Paging and threshold
Library item count:
Page size:
Pages:
Distinct rows:
Duplicates:
Threshold error?:
Full-scan duration:
Errors and SPRequestGuid:

Test 6 — Server name filter diagnostic
Small-library result:
Large-library result:
Threshold error?:

Test 7 — Java matching
Case behavior:
Special-name behavior:
Accent requirement:

Test 8 — Permissions
Both-list user:
Restricted-list user:
Restricted-item/folder user:

Test 9 — Freshness
Create:
Rename:
Move:
Delete:

Test 10 — Performance
Execution pages/time:
Marketing pages/time:
Combined pages/time:
Zero-match time:
Concurrent-user result:

Recommended decision: adopt / reject / more evidence
Reason:
Open questions:
Representative response locations:
```

# References

- [Working with SharePoint lists and list items using REST](https://learn.microsoft.com/en-us/sharepoint/dev/sp-add-ins/working-with-lists-and-list-items-with-rest)
- [SharePoint base data fields](https://learn.microsoft.com/en-us/openspecs/sharepoint_protocols/ms-wssts/bac496c6-c19e-4243-94e0-4f92477b6e82)
- [SharePoint Server 2016/2019 boundaries and limits](https://learn.microsoft.com/en-us/sharepoint/install/software-boundaries-limits-2019)
- [Filtering large SharePoint lists and indexed-column behavior](https://support.microsoft.com/en-us/sharepoint/data-and-lists/use-filtering-to-modify-a-sharepoint-view)
- [Working with the List View Threshold](https://support.microsoft.com/en-us/sharepoint/lists/data-and-lists/working-with-the-list-view-threshold-limit-for-all-versions-of-sharepoint)
