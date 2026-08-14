# SharePoint Folder-Scoped List-Item Search — Postman Check

> **Status: exact request prepared; target-farm verification pending.**
> The target farm has already confirmed that the document-library `/items` collection
> returns mixed file/folder rows, that `Editor/Title` works when selected and expanded,
> and that file size is available through expanded `File/Length`. This check verifies
> the final missing capability: restricting recursive results to one selected folder,
> including using the document-library root as the selected folder.

## Decision being tested

Use SharePoint's list `GetItems` operation with an `SP.CamlQuery`:

```http
POST {siteUrl}/_api/web/lists(guid'{libraryId}')/GetItems
```

The query combines:

- `FolderServerRelativeUrl` — the canonical folder that owns the search scope;
- `<View Scope='RecursiveAll'>` — include direct and nested descendants;
- paged, stable `ID` ordering;
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
reduce the row limit to a small value such as `2`.

Verify:

- the first response exposes a continuation marker/link in the farm's response shape;
- the continuation returns the next rows within the same folder scope;
- no row outside `FolderServerRelativeUrl` appears on later pages;
- no `ID` or `UniqueId` is duplicated across pages;
- ordering stays stable by `ID`;
- ordinary `$skip` is not used.

Retain the first and second page responses. The backend implementation must use the
farm's actual continuation representation rather than inventing its format.

## Test 5 — More-than-5,000-item behavior

Run Test 1 or Test 2 against a scoped subtree whose containing library has more than
5,000 items. If possible, also test a selected subtree with more than 5,000 descendants.

Pass criteria:

- the first page succeeds for the application bearer-token user;
- every continuation succeeds;
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
Continuation representation:
Page 1 rows:
Page 2 rows:
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
        -> follow the verified SharePoint continuation
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
- [SharePoint OData select, expand, and paging](https://learn.microsoft.com/en-us/sharepoint/dev/sp-add-ins/use-odata-query-operations-in-sharepoint-rest-requests)
- [SP.File.Length](https://learn.microsoft.com/en-us/previous-versions/office/sharepoint-visio/jj247161(v=office.15))
