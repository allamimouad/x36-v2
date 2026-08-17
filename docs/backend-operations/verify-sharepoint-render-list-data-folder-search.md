# SharePoint `RenderListDataAsStream` Folder Search — Postman Verification

> **Status: target-farm capability test; not yet an implementation decision.**
> Run this guide against the same library and nested folder that produced the
> list-view-threshold error with `POST .../GetItems`, `FolderServerRelativeUrl`, and
> `Scope='RecursiveAll'`.
>
> Microsoft documents this endpoint's folder, CAML-view, and paging parameters, but
> does not promise that it bypasses the list-view threshold. The target-farm result is
> decisive.

## Why this test exists

The target farm has established the following:

- the document library contains more than 5,000 items;
- root-scoped `GetItems` with `RecursiveAll`, a paged row limit, and `ID` ordering
  works;
- native later-page paging works through
  `ListItemCollectionPosition.PagingInfo = Paged=TRUE&p_ID=<last actual ID>`;
- a valid nested `FolderServerRelativeUrl` plus `RecursiveAll` fails with the
  list-view-threshold error;
- `AllowIncrementalResults=true` does not fix that recursive nested-folder request;
- removing `RecursiveAll` makes the nested-folder request work, but returns only the
  selected folder's direct children and therefore does not satisfy subtree search.

Walking every folder from Java would require at least one SharePoint request per
folder. This guide tests whether `RenderListDataAsStream` can retrieve or search the
complete selected subtree with paged requests whose count depends on returned rows,
not on the number of folders.

## What this test must prove

The endpoint is a viable backend candidate only if it can:

1. scope results to one real nested folder;
2. include files and folders at every depth;
3. exclude sibling and outside subtrees;
4. return lightweight identity/name/path/kind fields;
5. page deterministically beyond the first response;
6. operate when the containing library and selected subtree exercise the 5,000-item
   threshold;
7. preserve the calling user's SharePoint permissions;
8. complete within an acceptable measured time.

The initial request intentionally asks for lightweight list fields only. Do not add
`Editor`, file-size expansion, or other expensive projections until recursive scope
and paging work. Search results can be hydrated only after they match or when the user
selects one.

## Postman variables

Create these environment variables:

```text
siteUrl
libraryServerRelativeUrl
libraryRootServerRelativeUrl
nestedFolderServerRelativeUrl
searchProbe
renderPaging
token
```

Example values:

```text
siteUrl
https://sharepoint.example.com/sites/project-execution

libraryServerRelativeUrl
/sites/project-execution/Execution Documents

libraryRootServerRelativeUrl
/sites/project-execution/Execution Documents

nestedFolderServerRelativeUrl
/sites/project-execution/Execution Documents/PdRenderScopeTarget

searchProbe
PdRenderProbe20260817
```

Use decoded server-relative paths in JSON. Do not use an absolute URL for either
folder variable, do not replace spaces with `%20` in the body, and do not duplicate
the site prefix.

## Disposable test structure

Use or create this structure:

```text
Execution Documents
├── PdRenderScopeTarget
│   ├── PdRenderProbe20260817Direct.docx
│   ├── UnrelatedDirect.txt
│   └── Nested
│       ├── PdRenderProbe20260817Deep.pdf
│       └── DeepLevel2
│           └── PdRenderProbe20260817VeryDeep.xlsx
└── PdRenderScopeOutside
    └── PdRenderProbe20260817Outside.docx
```

The outside file deliberately contains the search text. A correctly folder-scoped
request must never return it.

## Endpoint and headers

Use the documented `GetList(@listUrl)` form:

```http
POST {{siteUrl}}/_api/web/GetList(@listUrl)/RenderListDataAsStream
```

Add this Postman query parameter for every request:

| Key | Value |
|---|---|
| `@listUrl` | `'{{libraryServerRelativeUrl}}'` |

The single quotes are part of the parameter value. Let Postman URL-encode the
transport value.

Headers:

```http
Authorization: Bearer {{token}}
Accept: application/json;odata=nometadata
Content-Type: application/json;odata=nometadata
```

Do not add OData `$select` or `$expand` parameters. This endpoint obtains its fields
from CAML `ViewFields`.

## Test 0 — Confirm the endpoint with direct children

This control has no recursive scope. It should return only the selected folder's
direct files and direct child folders.

```json
{
  "parameters": {
    "RenderOptions": 2,
    "DatesInUtc": true,
    "FolderServerRelativeUrl": "{{nestedFolderServerRelativeUrl}}",
    "ViewXml": "<View><Query><OrderBy><FieldRef Name='ID' Ascending='TRUE'/></OrderBy></Query><ViewFields><FieldRef Name='ID'/><FieldRef Name='UniqueId'/><FieldRef Name='FileLeafRef'/><FieldRef Name='FileRef'/><FieldRef Name='FileDirRef'/><FieldRef Name='FSObjType'/></ViewFields><RowLimit Paged='TRUE'>20</RowLimit></View>"
  }
}
```

Verify:

- HTTP 200;
- `PdRenderProbe20260817Direct.docx` is present;
- `Nested` is present as a folder row;
- the deep PDF and spreadsheet are absent;
- the outside folder and outside file are absent;
- the response contains a row collection and recognizable values for ID, unique id,
  name, path, parent path, and file/folder kind.

Record the actual property names because rendered-list responses may not use the same
JSON shape or primitive serialization as `GetItems`.

If Test 0 fails because the endpoint or payload is unavailable on this SharePoint
version, stop and retain the complete HTTP status, response body, SharePoint version
header, and correlation id.

## Test 1 — Critical nested recursive probe

Use the same endpoint, `@listUrl` parameter, and headers. Add only
`Scope='RecursiveAll'`:

```json
{
  "parameters": {
    "RenderOptions": 2,
    "DatesInUtc": true,
    "FolderServerRelativeUrl": "{{nestedFolderServerRelativeUrl}}",
    "ViewXml": "<View Scope='RecursiveAll'><Query><OrderBy><FieldRef Name='ID' Ascending='TRUE'/></OrderBy></Query><ViewFields><FieldRef Name='ID'/><FieldRef Name='UniqueId'/><FieldRef Name='FileLeafRef'/><FieldRef Name='FileRef'/><FieldRef Name='FileDirRef'/><FieldRef Name='FSObjType'/></ViewFields><RowLimit Paged='TRUE'>20</RowLimit></View>"
  }
}
```

This is the decisive first test.

Pass criteria:

- HTTP 200 without a list-view-threshold error;
- the direct document is present;
- `Nested` and `DeepLevel2` are present as folder rows;
- the deep PDF and very-deep spreadsheet are present;
- the outside folder and outside file are absent;
- no unexpected full-library rows appear;
- response time and SharePoint correlation id are recorded.

If this request raises the same threshold error as `GetItems`, record the failure and
skip Tests 3–5. `RenderListDataAsStream` has not solved the recursive folder problem
on this farm.

## Test 2 — Root recursive control

Repeat Test 1 with only this change:

```json
"FolderServerRelativeUrl": "{{libraryRootServerRelativeUrl}}"
```

Expected:

- both target and outside subtrees appear;
- direct and deep rows appear;
- the response remains paged;
- the request does not fail merely because the library has more than 5,000 items.

This separates a general endpoint failure from the nested recursive query-plan
failure already observed with `GetItems`.

## Test 3 — Paging the selected subtree

Run this test only if Test 1 succeeds. Temporarily reduce the row limit to `2` so the
first response must page:

```json
{
  "parameters": {
    "RenderOptions": 2,
    "DatesInUtc": true,
    "FolderServerRelativeUrl": "{{nestedFolderServerRelativeUrl}}",
    "ViewXml": "<View Scope='RecursiveAll'><Query><OrderBy><FieldRef Name='ID' Ascending='TRUE'/></OrderBy></Query><ViewFields><FieldRef Name='ID'/><FieldRef Name='UniqueId'/><FieldRef Name='FileLeafRef'/><FieldRef Name='FileRef'/><FieldRef Name='FileDirRef'/><FieldRef Name='FSObjType'/></ViewFields><RowLimit Paged='TRUE'>2</RowLimit></View>"
  }
}
```

Search the complete JSON response for a continuation value such as `NextHref`,
`Paging`, `Paged=TRUE`, or `p_ID`. Record its exact property name and value.

If the response contains a value such as:

```text
?Paged=TRUE&p_ID=23
```

set `renderPaging` to the opaque paging portion without the leading question mark:

```text
Paged=TRUE&p_ID=23
```

Do not calculate an ID, add the row limit, or rewrite other name/value pairs returned
by SharePoint.

Send page two with the exact response-derived value:

```json
{
  "parameters": {
    "RenderOptions": 2,
    "DatesInUtc": true,
    "FolderServerRelativeUrl": "{{nestedFolderServerRelativeUrl}}",
    "Paging": "{{renderPaging}}",
    "ViewXml": "<View Scope='RecursiveAll'><Query><OrderBy><FieldRef Name='ID' Ascending='TRUE'/></OrderBy></Query><ViewFields><FieldRef Name='ID'/><FieldRef Name='UniqueId'/><FieldRef Name='FileLeafRef'/><FieldRef Name='FileRef'/><FieldRef Name='FileDirRef'/><FieldRef Name='FSObjType'/></ViewFields><RowLimit Paged='TRUE'>2</RowLimit></View>"
  }
}
```

Verify:

- page two succeeds;
- no ID or unique id is duplicated between pages;
- the page remains inside `nestedFolderServerRelativeUrl`;
- later pages use only the immediately preceding response's opaque paging value;
- an absent continuation or a short final page terminates the loop according to the
  response behavior observed on this farm.

This endpoint's `Paging` contract is separate from `GetItems`. Do not use CAML
`ID > lastId`, OData `$skip`, or `GetItems.ListItemCollectionPosition` here.

If the first full page exposes no continuation, retain the complete response. Do not
invent one from the final ID; paging is not verified until SharePoint provides the
endpoint-specific value.

## Test 4 — Optional in-place filename search

First establish that Tests 1 and 3 work. Then test whether this endpoint can reduce
the rows server-side without escaping the folder scope.

Restore the row limit to `20`. Add this Postman query parameter:

| Key | Value |
|---|---|
| `InplaceSearchQuery` | `{{searchProbe}}` |

Do not add `InplaceFullListSearch` on the first attempt. Keep the Test 1 body exactly
the same.

Verify:

- the direct, deep, and very-deep matching rows appear;
- `PdRenderProbe20260817Outside.docx` does not appear;
- `UnrelatedDirect.txt` does not appear;
- files and folders can both match when their names contain the probe;
- a full response page exposes usable continuation data;
- the request remains below the threshold.

Then repeat with these separate values and record the behavior:

```text
PdRenderProbe
RenderProbe20260817
20260817
```

This establishes whether matching is token, prefix, word, or substring based. Do not
promise substring search until the target farm demonstrates it.

Finally, run a negative-control request with:

| Key | Value |
|---|---|
| `InplaceSearchQuery` | `{{searchProbe}}` |
| `InplaceFullListSearch` | `true` |

If this causes the outside file to appear, `InplaceFullListSearch=true` overrides or
widens the selected-folder scope and must not be used for folder search.

Treat this server-side search as a separate capability from recursive enumeration. If
the name-search semantics, freshness, folder behavior, or paging are unreliable, the
backend can still page the successful lightweight recursive rows and filter
`FileLeafRef` case-insensitively in Java. That costs one request per returned page,
not one request per folder.

## Test 5 — Add richer fields only after the lean query passes

If Tests 1 and 3 succeed, add these fields to `ViewFields` one group at a time:

```xml
<FieldRef Name='Created'/>
<FieldRef Name='Modified'/>
<FieldRef Name='Editor'/>
<FieldRef Name='File_x0020_Size'/>
<FieldRef Name='ContentTypeId'/>
```

Repeat the recursive first-page and second-page tests after each addition. Record the
exact rendered representation and whether threshold behavior or response time changes.

Do not assume that `File_x0020_Size` from this endpoint is equivalent to the canonical
expanded `File/Length` already verified through list-item REST. If size or editor is
missing or unreliable, keep the search result lightweight and hydrate only matched or
selected rows through the canonical file/folder API.

## Test 6 — Realistic threshold, performance, and permissions

Repeat the accepted request with a production-candidate row limit of `1000` against:

- a library containing more than 5,000 items;
- the real nested folder that failed with `GetItems + RecursiveAll`;
- if available, a selected subtree containing more than 5,000 descendants.

Page until completion and record:

```text
library item count:
estimated/known scoped descendant count:
row limit:
pages:
distinct rows:
total duration:
slowest page:
threshold errors:
429/503 responses:
duplicates:
outside-scope rows:
```

Repeat with the application's real per-user bearer token and a protected descendant.
Verify that unauthorized names, paths, IDs, sizes, editor values, and counts never
appear. A successful administrator test does not prove the application-user behavior.

## Result sheet

```text
Date:
Tester:
SharePoint version/header:
Site URL:
Library path:
Nested folder path:
Library item count:

Test 0 — Direct-folder control
HTTP status:
Direct file/folder returned?:
Deep row excluded?:
Outside row excluded?:
Actual row collection/property names:
Response time:
SPRequestGuid:

Test 1 — Nested RecursiveAll
HTTP status:
Threshold error?:
Direct file returned?:
Nested folders returned?:
Deep/very-deep files returned?:
Outside rows excluded?:
Response time:
SPRequestGuid:

Test 2 — Root RecursiveAll
HTTP status:
Both subtrees returned?:
Threshold error?:
Response time:

Test 3 — Paging
Row limit:
Continuation property/value:
Page 1 IDs:
Page 2 IDs:
Later/final page behavior:
Duplicates or missing rows?:
Outside-scope rows?:

Test 4 — In-place search
HTTP status:
Exact/prefix/word/substring behavior:
Files returned?:
Folders returned?:
Deep matches returned?:
Outside match excluded without InplaceFullListSearch?:
Behavior with InplaceFullListSearch=true:
Paging works?:

Test 5 — Rich fields
Created/Modified representation:
Editor representation:
Size representation:
Threshold/performance change?:

Test 6 — Production-size and permissions
Pages/distinct rows:
Total/slowest duration:
Threshold or throttling errors:
Restricted-user result:
Unauthorized metadata leaked?:

Recommended decision: adopt / reject / more evidence
Retained response locations:
Open questions:
```

## Decision rules

Adopt this endpoint as the first-release folder-search source only when all mandatory
tests pass on the target farm:

```text
nested recursive scope
    + mixed files/folders
    + opaque continuation paging
    + no outside rows
    + real-user permission trimming
    + acceptable measured latency/load
```

Possible outcomes:

- **Recursive enumeration and in-place search pass:** use SharePoint's filtered,
  paged response and hydrate only selected results when necessary.
- **Recursive enumeration passes but in-place search fails:** page lightweight subtree
  rows and filter names in Java. Calls scale with subtree rows/page size, not folders.
- **Nested recursive enumeration fails at the threshold:** reject this endpoint for
  the problem. Compare the already-working root scan plus Java path/name filtering
  against Search REST's faster but eventually consistent index.
- **Paging or permission behavior is unclear:** collect more evidence; do not implement
  from the first successful page alone.

## Official reference

Microsoft documents `RenderListDataAsStream`, its `GetList(@listUrl)` REST form,
`FolderServerRelativeUrl`, `Paging`, `ViewXml`, and `SPRenderListDataOptions` here:

- [Working with lists and list items with REST](https://learn.microsoft.com/en-us/sharepoint/dev/sp-add-ins/working-with-lists-and-list-items-with-rest#retrieve-items-as-a-stream)
