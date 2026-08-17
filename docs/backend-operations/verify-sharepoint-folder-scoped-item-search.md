# SharePoint Folder-Scoped List-Item Search — Postman Check

> **Do not implement the paging strategy in this historical guide.** Target-farm
> testing after this file was published proved that native later-page paging works via
> `ListItemCollectionPosition.PagingInfo`, while the documented CAML
> `ID > lastItemId` workaround can raise the threshold or skip rows. Testing also
> proved that a real nested `FolderServerRelativeUrl + RecursiveAll` request is
> threshold-blocked even with `AllowIncrementalResults`; removing `RecursiveAll`
> succeeds but returns only direct children. Use
> [verify-sharepoint-render-list-data-folder-search.md](verify-sharepoint-render-list-data-folder-search.md)
> for the current next capability test. This file is retained only as investigation
> history until it is rewritten.
>
> **Status: root paging behavior partially verified; remaining target-farm checks pending.**
> The target farm has already confirmed that the document-library `/items` collection
> returns mixed file/folder rows, that `Editor/Title` works when selected and expanded,
> and that file size is available through expanded `File/Length`. A root-scoped
> `GetItems` request against a library with more than 5,000 items also succeeds with a
> paged row limit and fails without one. Unlike the ordinary `/items` OData collection,
> this farm's `POST GetItems` response exposes no `d.__next` or equivalent continuation,
> even with `RowLimit=1`; this guide therefore verifies explicit `ID`-cursor paging.

## Decision being tested

Use SharePoint's list `GetItems` operation with an `SP.CamlQuery`:

```http
POST {siteUrl}/_api/web/lists(guid'{libraryId}')/GetItems
```

The query combines:

- `FolderServerRelativeUrl` — the canonical folder that owns the search scope;
- `<View Scope='RecursiveAll'>` — include direct and nested descendants;
- paged, stable `ID` ordering with an explicit `ID > lastItemId` cursor;
- no SharePoint-side filename predicate;
- expanded `File`, `Folder`, and `Editor` properties.

The backend will filter `FileLeafRef` in Java only after this folder-scoping request is
confirmed on the real farm.

`GetFolderById('{folderId}')/Items` is not a SharePoint endpoint. `SP.Folder` exposes
separate `Files` and `Folders` collections, but no mixed `Items` collection. The mixed
query therefore remains a list operation and receives the folder as CAML scope.

## Values to prepare

Create these Postman environment variables:

```text
siteUrl
libraryId
libraryRootServerRelativeUrl
nestedFolderServerRelativeUrl
lastItemId
token
```

Example values:

```text
siteUrl
https://sharepoint.example.com/sites/project-execution

libraryRootServerRelativeUrl
/sites/project-execution/Execution Documents

nestedFolderServerRelativeUrl
/sites/project-execution/Execution Documents/Contracts
```

Use canonical decoded SharePoint paths. Do not replace spaces with `%20` inside the
JSON body; let the HTTP client encode the request transport.

## Test data

Use or create this disposable structure:

```text
Execution Documents
├── PdFolderScopeTarget
│   ├── PdScopeDirect.docx
│   └── Nested
│       └── PdScopeDeep.pdf
└── PdFolderScopeOutside
    └── PdScopeOutside.xlsx
```

Set:

```text
nestedFolderServerRelativeUrl =
/sites/project-execution/Execution Documents/PdFolderScopeTarget
```

## Request configuration

Method and endpoint:

```http
POST {{siteUrl}}/_api/web/lists(guid'{{libraryId}}')/GetItems
```

Headers:

```http
Authorization: Bearer {{token}}
Accept: application/json;odata=verbose
Content-Type: application/json;odata=verbose
```

Add these values in Postman's **Params** tab:

| Key | Value |
|---|---|
| `$select` | `ID,UniqueId,FileLeafRef,FileRef,FileDirRef,FSObjType,Created,Modified,File/Length,Folder/ItemCount,Editor/Title` |
| `$expand` | `File,Folder,Editor` |

Important projection rules already confirmed on the target farm:

- `Editor/Title` must appear in `$select` when `Editor` appears in `$expand`;
- `File/Length` must appear in `$select` when `File` appears in `$expand`;
- `File.Length` is the canonical byte size for a file;
- folders have no byte size; `Folder.ItemCount` is a child count, not bytes;
- SharePoint may serialize `File.Length` as a string, so the backend maps it to a
  non-negative Java `long`.

## Test 1 — Search a nested folder recursively

Paste this exact body:

```json
{
  "query": {
    "__metadata": {
      "type": "SP.CamlQuery"
    },
    "FolderServerRelativeUrl": "{{nestedFolderServerRelativeUrl}}",
    "ViewXml": "<View Scope='RecursiveAll'><Query><OrderBy><FieldRef Name='ID' Ascending='TRUE'/></OrderBy></Query><RowLimit Paged='TRUE'>1000</RowLimit></View>"
  }
}
```

Expected inclusions:

```text
PdScopeDirect.docx
Nested
PdScopeDeep.pdf
```

Expected exclusions:

```text
PdFolderScopeOutside
PdScopeOutside.xlsx
```

The selected `PdFolderScopeTarget` folder defines the scope and is normally not one of
its own returned descendants. If the product later requires the selected folder name
itself to match, the backend can compare the already-known current folder separately;
it must not add another SharePoint traversal.

Verify for the returned file rows:

```text
FSObjType = 0
File.Length contains the file size in bytes
Folder is null, absent, or empty according to the farm's response mode
```

Verify for the returned folder rows:

```text
FSObjType = 1
Folder.ItemCount contains the direct child count when returned
File is null, absent, or empty according to the farm's response mode
```

Keep the complete response, response time, status, and SharePoint correlation id.

## Test 2 — Use the document-library root as the scope

Use the same endpoint, params, headers, and projection. Change only the body value:

```json
{
  "query": {
    "__metadata": {
      "type": "SP.CamlQuery"
    },
    "FolderServerRelativeUrl": "{{libraryRootServerRelativeUrl}}",
    "ViewXml": "<View Scope='RecursiveAll'><Query><OrderBy><FieldRef Name='ID' Ascending='TRUE'/></OrderBy></Query><RowLimit Paged='TRUE'>1000</RowLimit></View>"
  }
}
```

Expected:

- direct children of the library root are returned;
- deeply nested files and folders are returned;
- both `PdFolderScopeTarget` and `PdFolderScopeOutside` subtrees are visible;
- the library root itself is the scope, not a returned child row;
- files retain `File.Length` and folders retain their `Folder` projection.

This proves that one backend operation can support both modes:

```text
root folder id   -> search the complete document list
nested folder id -> search only that folder subtree
```

## Test 3 — Prove that recursion matters

Repeat Test 1 temporarily without `Scope='RecursiveAll'`:

```json
{
  "query": {
    "__metadata": {
      "type": "SP.CamlQuery"
    },
    "FolderServerRelativeUrl": "{{nestedFolderServerRelativeUrl}}",
    "ViewXml": "<View><Query><OrderBy><FieldRef Name='ID' Ascending='TRUE'/></OrderBy></Query><RowLimit Paged='TRUE'>1000</RowLimit></View>"
  }
}
```

Record whether the direct file/folder rows remain and confirm that the deep PDF is not
returned. Restore `Scope='RecursiveAll'` for the candidate implementation.

## Test 4 — Paging within the selected subtree

Use a folder subtree containing more rows than the configured row limit, or temporarily
reduce the row limit to `2`. The bodies below use `nestedFolderServerRelativeUrl`; use
`libraryRootServerRelativeUrl` instead when repeating the same cursor test at the root.

The target farm has already established that `POST GetItems` does not serialize an
OData next link or CAML collection-position marker in the response. Do not look for
`d.__next`, do not use `$skip`, and do not copy the `/items` endpoint's `$skiptoken`.
Use the final returned `ID` as an explicit keyset cursor instead.

### Page 1

```json
{
  "query": {
    "__metadata": {
      "type": "SP.CamlQuery"
    },
    "FolderServerRelativeUrl": "{{nestedFolderServerRelativeUrl}}",
    "ViewXml": "<View Scope='RecursiveAll'><Query><OrderBy><FieldRef Name='ID' Ascending='TRUE'/></OrderBy></Query><RowLimit Paged='TRUE'>2</RowLimit></View>"
  }
}
```

Record the final `ID` in the response. For example, if the page returns IDs `41` and
`57`, set:

```text
lastItemId = 57
```

Use the actual final ID. Never calculate `firstId + rowLimit`, because deleted items
and other normal list activity leave gaps in SharePoint IDs.

### Page 2 and later

Send the same endpoint, headers, params, folder scope, ordering, and row limit. Add an
indexed `ID` greater-than predicate using the previous page's final ID:

```json
{
  "query": {
    "__metadata": {
      "type": "SP.CamlQuery"
    },
    "FolderServerRelativeUrl": "{{nestedFolderServerRelativeUrl}}",
    "ViewXml": "<View Scope='RecursiveAll'><Query><Where><Gt><FieldRef Name='ID'/><Value Type='Counter'>{{lastItemId}}</Value></Gt></Where><OrderBy><FieldRef Name='ID' Ascending='TRUE'/></OrderBy></Query><RowLimit Paged='TRUE'>2</RowLimit></View>"
  }
}
```

After every full page, replace `lastItemId` with that page's final returned `ID` and
repeat. Stop when the response contains fewer rows than the configured row limit. If a
page contains exactly the row limit, call once more; an empty response confirms the
end when the total happens to be an exact multiple of the page size.

Verify:

- page 2 starts with an `ID` greater than page 1's final `ID`;
- later pages remain within the same `FolderServerRelativeUrl` scope;
- no `ID` or `UniqueId` is duplicated across pages;
- ordering remains strictly increasing by `ID`;
- the complete distinct-row count is plausible for the selected subtree;
- no OData `$skip`, guessed numeric offset, or client-supplied cursor is used.

Retain the first, second, and final page responses. The production cursor is backend
state derived only from SharePoint's last returned row; Angular never supplies it.

## Test 5 — More-than-5,000-item behavior

Run Test 1 or Test 2 against a scoped subtree whose containing library has more than
5,000 items. If possible, also test a selected subtree with more than 5,000 descendants.

Already verified on the target farm for a root scope:

- the containing library has more than 5,000 items;
- omitting `RowLimit` raises the farm's list-view-threshold error;
- `<RowLimit Paged='TRUE'>1000</RowLimit>` returns the first 1,000 rows;
- `<RowLimit Paged='TRUE'>1</RowLimit>` returns one row;
- neither paged `GetItems` response contains `d.__next`, an OData next link,
  `ListItemCollectionPosition`, or `PagingInfo`.

Remaining pass criteria:

- every explicit `ID > lastItemId` page succeeds for the application bearer-token user;
- the farm threshold is not raised or bypassed with an administrator override;
- no item outside the selected folder appears;
- complete-scan call count and duration are acceptable;
- a zero-match Java filename filter is still acceptable, because it scans the complete
  selected subtree.

A row limit below 5,000 does not prove arbitrary server-side predicates are safe. The
candidate deliberately has no CAML `Contains` predicate; real-farm evidence still
decides whether the unfiltered folder-scoped scan is operationally acceptable.

## Test 6 — Permissions

Repeat a nested-folder request using a user who cannot access either the selected
folder or one protected descendant.

Verify:

- unauthorized names, paths, UUIDs, sizes, and editor names never appear;
- authorized descendants remain visible when item-level permissions permit them;
- a completely inaccessible scope returns a controlled 403/not-found behavior;
- the request uses the application's existing per-user OAuth bearer token.

## Result sheet

```text
Date:
Tester:
SharePoint version/header:
Site URL:
Library id/title:
Library root path:
Nested scope path:

Test 1 — Nested RecursiveAll
HTTP status:
Direct file returned?:
Nested folder returned?:
Deep file returned?:
Outside folder excluded?:
Outside file excluded?:
File.Length returned?:
Folder.ItemCount behavior:
Editor.Title returned?:
Response time:
SPRequestGuid:

Test 2 — Root RecursiveAll
HTTP status:
Both top-level subtrees returned?:
Deep rows returned?:
Root returned as a row?:
Response time:
SPRequestGuid:

Test 3 — Without RecursiveAll
Direct rows returned?:
Deep file excluded?:

Test 4 — Paging
Row limit:
Automatic continuation absent?:
Page 1 rows:
Page 1 final ID:
Page 2 rows:
Page 2 first/final ID:
Final page rows:
Duplicates?:
Outside-scope row?:

Test 5 — Threshold/performance
Library item count:
Scoped descendant count:
Pages:
Total scan time:
Threshold error?:
Zero-match scan time:

Test 6 — Permissions
Restricted user result:
Unauthorized metadata leaked?:

Recommended decision: adopt / reject / more evidence
Errors and retained response locations:
Open questions:
```

## Backend candidate after this passes

The public backend route remains folder-id based:

```http
GET /projects/{projectId}/document-lists/{listKey}/documents/{folderId}/search?q={query}
```

The backend flow is:

```text
projectId + listKey + folderId
        -> authorize project/list/folder scope
        -> obtain the canonical folder ServerRelativeUrl
        -> POST list/GetItems with FolderServerRelativeUrl + RecursiveAll
        -> order by ID and request a bounded first page
        -> request later pages with ID > the previous page's final ID
        -> match FileLeafRef in Java
        -> map File.Length only for file rows
        -> return lightweight domain search results
```

The frontend never sends a SharePoint site URL or library GUID. If it sends a cached
folder path to avoid a preliminary by-id lookup, the backend must validate that path
against the canonical project/list root and folder identity before using it. The final
id-versus-path request shape is decided only after the Postman capability succeeds.

## Official references

- [CamlQuery.FolderServerRelativeUrl](https://learn.microsoft.com/en-us/previous-versions/office/sharepoint-csom/ee536450(v=office.15))
- [SharePoint list-item operations and RecursiveAll](https://learn.microsoft.com/en-us/sharepoint/dev/sp-add-ins/complete-basic-operations-using-sharepoint-client-library-code)
- [CAML `Gt` query element](https://learn.microsoft.com/en-us/sharepoint/dev/schema/gt-element-query)
- [CAML `RowLimit` element](https://learn.microsoft.com/en-us/sharepoint/dev/schema/rowlimit-element-list)
- [SharePoint OData select, expand, and paging](https://learn.microsoft.com/en-us/sharepoint/dev/sp-add-ins/use-odata-query-operations-in-sharepoint-rest-requests)
- [SP.File.Length](https://learn.microsoft.com/en-us/previous-versions/office/sharepoint-visio/jj247161(v=office.15))
