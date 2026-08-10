# Tomorrow's Postman Checklist — SharePoint File and Folder Search

This is a manual checklist for testing the real SharePoint farm.

Run the APIs in this order:

1. SharePoint Search REST GET — best first candidate.
2. SharePoint Search REST POST — likely backend implementation if GET works.
3. RenderListDataAsStream — first fallback.
4. Recursive CAML GetItems — second fallback.
5. OData list-item filtering — third fallback.
6. Folder traversal — capability check only, not a recommended search implementation.

For every request, write the result in the result sheet at the bottom. Keep one
successful response for a file, one for a folder, and every failed response.

## What we need to prove

The selected API must:

- search all folders recursively;
- search both files and folders;
- search names only, not text inside documents;
- search both Execution and Marketing;
- work when the two lists are on different SharePoint sites;
- return the name, full path, stable UniqueId, and file/folder kind;
- respect the permissions of the bearer-token user;
- support paging;
- perform acceptably on a realistic document library.

## Values to prepare

Use your existing bearer-token configuration. Prepare these Postman variables:

~~~text
executionSiteUrl
executionLibraryAbsoluteUrl
executionLibraryServerRelativeUrl
executionLibraryId
executionRootFolderId

marketingSiteUrl
marketingLibraryAbsoluteUrl
marketingLibraryServerRelativeUrl
marketingLibraryId
marketingRootFolderId

probePrefix = PdSearchProbe20260811
~~~

Example:

~~~text
executionSiteUrl
https://sharepoint.example.com/sites/project-execution

executionLibraryAbsoluteUrl
https://sharepoint.example.com/sites/project-execution/Execution Documents

executionLibraryServerRelativeUrl
/sites/project-execution/Execution Documents
~~~

Use SharePoint's canonical paths. Let Postman encode query parameters.

## Create the test data

Create these disposable items:

~~~text
EXECUTION
└── PdSearchProbe20260811ExecutionFolder
    ├── PdSearchProbe20260811ExecutionFile.docx
    └── Nested
        └── PdSearchProbe20260811DeepFile.txt

MARKETING
└── PdSearchProbe20260811MarketingFolder
    ├── PdSearchProbe20260811MarketingFile.xlsx
    └── Nested
        └── PdSearchProbe20260811DeepFolder
~~~

Also create:

~~~text
File name: unrelated-name.docx
Text inside the document: PdContentOnlyProbe20260811
~~~

This checks whether an API searches document contents when we want names only.

If convenient, also create:

~~~text
Director's PdSearchProbe20260811 Report.docx
PdSearchProbe20260811 Sales & Marketing.xlsx
PdSearchProbe20260811 Prévision 2026.pdf
PdSearchProbe20260811 (Final).txt
~~~

Write down when you create the items. Search REST uses an index, so they may not appear
immediately.

---

## Test 0 — Confirm the sites and SharePoint version

Run both:

~~~http
GET {{executionSiteUrl}}/_api/web?$select=Title,Url,Id
~~~

~~~http
GET {{marketingSiteUrl}}/_api/web?$select=Title,Url,Id
~~~

Check:

- both return 200;
- each response contains the expected site URL;
- record the MicrosoftSharePointTeamServices response header;
- record SPRequestGuid or request-id.

If this returns 401 or 403, fix authentication or permissions before testing search.

---

# API 1 — Search REST GET

This is the best API to test first.

## Test 1.1 — Basic endpoint

Request:

~~~http
GET {{executionSiteUrl}}/_api/search/query
~~~

Add these values in Postman's Params tab:

| Key | Value |
|---|---|
| querytext | 'Filename:PdSearchProbe20260811*' |
| rowlimit | 20 |
| trimduplicates | false |
| selectproperties | 'Title,Filename,Path,UniqueID,ParentId,IsContainer,IsDocument,FileExtension,Size,Created,LastModifiedTime,Author,Rank' |

Expected:

- HTTP 200;
- at least one probe result after SharePoint indexes the fixtures;
- results inside PrimaryQueryResult → RelevantResults;
- every result contains key/value cells.

Keep the complete response.

## Test 1.2 — Check fields for one file and one folder

Fill this table from the response:

| Field | File value | Folder value |
|---|---|---|
| Title | | |
| Filename | | |
| Path | | |
| UniqueID | | |
| ParentId | | |
| IsContainer | | |
| IsDocument | | |
| FileExtension | | |
| Size | | |
| Created | | |
| LastModifiedTime | | |
| Author | | |
| Rank | | |

The essential fields are Filename, Path, UniqueID, and a reliable file/folder
indicator. Missing ParentId is not automatically a failure.

## Test 1.3 — Files only

Use this querytext:

~~~text
'Filename:PdSearchProbe20260811* AND IsDocument:true'
~~~

Expected: probe files appear and probe folders do not.

## Test 1.4 — Folders only

Use:

~~~text
'Filename:PdSearchProbe20260811* AND IsContainer:true AND IsDocument:false'
~~~

Expected: probe folders appear and probe files do not.

## Test 1.5 — Files and folders together

Use:

~~~text
'Filename:PdSearchProbe20260811* AND (IsDocument:true OR IsContainer:true)'
~~~

Expected:

- files and folders both appear;
- the deeply nested file and folder appear;
- SharePoint pages, forms, and site assets do not appear.

If deep items are missing, wait for indexing and retry before marking the test failed.

## Test 1.6 — Prove it searches names only

Use:

~~~text
'Filename:PdContentOnlyProbe20260811*'
~~~

Expected: zero results. unrelated-name.docx must not appear.

Then run this diagnostic query:

~~~text
'PdContentOnlyProbe20260811'
~~~

If unrelated-name.docx appears now, full-text indexing works. Record that, but our
implementation must use Filename because our feature searches names only.

## Test 1.7 — Execution only

Use:

~~~text
'Filename:PdSearchProbe20260811* AND Path:"{{executionLibraryAbsoluteUrl}}" AND (IsDocument:true OR IsContainer:true)'
~~~

Expected:

- Execution results only;
- nested Execution results included;
- no Marketing or unrelated-library results.

## Test 1.8 — Marketing only

Run against:

~~~http
GET {{marketingSiteUrl}}/_api/search/query
~~~

Use:

~~~text
'Filename:PdSearchProbe20260811* AND Path:"{{marketingLibraryAbsoluteUrl}}" AND (IsDocument:true OR IsContainer:true)'
~~~

Expected:

- Marketing results only;
- nested Marketing results included;
- no Execution or unrelated-library results.

## Test 1.9 — Both lists in one query

Run this from the Execution search endpoint and then the Marketing search endpoint:

~~~text
'Filename:PdSearchProbe20260811* AND (Path:"{{executionLibraryAbsoluteUrl}}" OR Path:"{{marketingLibraryAbsoluteUrl}}") AND (IsDocument:true OR IsContainer:true)'
~~~

Write down exactly what happens:

- one endpoint returns both lists;
- each endpoint returns only its own list;
- including the other path causes an error;
- neither endpoint can see the other site.

If one request returns both lists, one SharePoint call may be enough. Otherwise, the
backend will make one request per list and combine the responses.

## Test 1.10 — Paging

Use a query returning at least six results:

~~~text
Page 1: startrow=0, rowlimit=2
Page 2: startrow=2, rowlimit=2
Page 3: startrow=4, rowlimit=2
~~~

Keep trimduplicates=false.

Check:

- no duplicate UniqueID across pages;
- no expected result missing;
- RowCount and TotalRows make sense;
- repeating the same page gives the same order.

## Test 1.11 — Permission check

Run the combined query with:

1. A user who can access both lists.
2. A user who cannot access one list or one protected folder.

Expected:

- the restricted user never receives the unauthorized name, path, or id;
- authorized results still appear.

This test is required.

## Test 1.12 — Index delay

Measure:

~~~text
Create file time:
File first appears:
Delay:

Create folder time:
Folder first appears:
Delay:

Rename time:
New name first appears:
Old name disappears:

Move time:
New Path first appears:

Delete time:
Result disappears:
~~~

This delay is the main disadvantage of Search REST.

## Test 1.13 — Special names

Search the special fixtures. Record whether these work:

- spaces;
- apostrophe;
- ampersand;
- parentheses;
- accented characters;
- case differences;
- long names.

Keep the exact query and SharePoint response for every failure.

---

# API 2 — Search REST POST

Test POST after Search REST GET works.

## Test 2.1 — First POST body

~~~http
POST {{executionSiteUrl}}/_api/search/postquery
~~~

Body:

~~~json
{
  "request": {
    "__metadata": {
      "type": "Microsoft.Office.Server.Search.REST.SearchRequest"
    },
    "Querytext": "Filename:PdSearchProbe20260811* AND (IsDocument:true OR IsContainer:true)",
    "StartRow": 0,
    "RowLimit": 20,
    "TrimDuplicates": false,
    "SelectProperties": {
      "results": [
        "Title",
        "Filename",
        "Path",
        "UniqueID",
        "ParentId",
        "IsContainer",
        "IsDocument",
        "FileExtension",
        "Size",
        "Created",
        "LastModifiedTime",
        "Author",
        "Rank"
      ]
    }
  }
}
~~~

Expected: HTTP 200 and the same logical results as GET.

## Test 2.2 — Only if the first body is rejected

Try:

~~~json
{
  "__metadata": {
    "type": "Microsoft.Office.Server.Search.REST.SearchRequest"
  },
  "Querytext": "Filename:PdSearchProbe20260811* AND (IsDocument:true OR IsContainer:true)",
  "StartRow": "0",
  "RowLimit": "20",
  "TrimDuplicates": "false",
  "SelectProperties": {
    "results": [
      "Title",
      "Filename",
      "Path",
      "UniqueID",
      "ParentId",
      "IsContainer",
      "IsDocument",
      "FileExtension",
      "Size",
      "LastModifiedTime",
      "Author",
      "Rank"
    ]
  }
}
~~~

Record which body works and keep the complete response or error. If GET works but both
POST bodies fail, record it without rejecting Search REST; the generated client may
serialize the POST differently.

---

# API 3 — RenderListDataAsStream

This is the first fallback. Call it once for Execution and once for Marketing.

## Test 3.1 — Execution

~~~http
POST {{executionSiteUrl}}/_api/web/GetList(@listUrl)/RenderListDataAsStream
~~~

Params:

| Key | Value |
|---|---|
| @listUrl | '{{executionLibraryServerRelativeUrl}}' |
| InplaceSearchQuery | PdSearchProbe20260811 |
| InplaceFullListSearch | true |

Body:

~~~json
{
  "parameters": {
    "AddRequiredFields": true,
    "DatesInUtc": true,
    "RenderOptions": 34,
    "ViewXml": "<View Scope='RecursiveAll'><ViewFields><FieldRef Name='FileLeafRef'/><FieldRef Name='FileRef'/><FieldRef Name='FSObjType'/><FieldRef Name='UniqueId'/><FieldRef Name='ContentTypeId'/><FieldRef Name='Created'/><FieldRef Name='Modified'/><FieldRef Name='Editor'/><FieldRef Name='File_x0020_Size'/></ViewFields><RowLimit Paged='TRUE'>50</RowLimit></View>"
  }
}
~~~

If RenderOptions 34 fails, retry with RenderOptions 2.

## Test 3.2 — Marketing

Repeat with marketingSiteUrl and marketingLibraryServerRelativeUrl.

## Test 3.3 — Check

Verify:

- files appear;
- folders appear;
- deeply nested results appear;
- name, full path, unique id, and kind are returned;
- the content-only token does not match unrelated-name.docx;
- paging information such as NextHref is returned when needed;
- permissions are respected;
- changes appear faster than Search REST;
- no list-view-threshold error occurs;
- response time is acceptable.

Test matching with:

~~~text
PdSearchProbe20260811
PdSearch
SearchProbe
20260811
~~~

Write down whether matching is exact, prefix, word, or contains.

---

# API 4 — Recursive CAML GetItems

This is the second fallback.

## Test 4.1 — Execution

~~~http
POST {{executionSiteUrl}}/_api/web/lists(guid'{{executionLibraryId}}')/GetItems
~~~

Body:

~~~json
{
  "query": {
    "__metadata": {
      "type": "SP.CamlQuery"
    },
    "ViewXml": "<View Scope='RecursiveAll'><Query><Where><Contains><FieldRef Name='FileLeafRef'/><Value Type='Text'>PdSearchProbe20260811</Value></Contains></Where><OrderBy><FieldRef Name='FileLeafRef' Ascending='TRUE'/><FieldRef Name='ID' Ascending='TRUE'/></OrderBy></Query><ViewFields><FieldRef Name='ID'/><FieldRef Name='UniqueId'/><FieldRef Name='FileLeafRef'/><FieldRef Name='FileRef'/><FieldRef Name='FSObjType'/><FieldRef Name='ContentTypeId'/><FieldRef Name='Created'/><FieldRef Name='Modified'/><FieldRef Name='Editor'/><FieldRef Name='File_x0020_Size'/></ViewFields><RowLimit Paged='TRUE'>50</RowLimit></View>"
  }
}
~~~

## Test 4.2 — Marketing

Repeat with marketingSiteUrl and marketingLibraryId.

## Test 4.3 — Check

Verify:

- files and folders are both returned;
- deeply nested items are returned;
- matching is case-insensitive and behaves like contains;
- required fields are present;
- paging works;
- permissions are respected;
- changes appear immediately;
- no list-view-threshold error occurs;
- response time is acceptable on a realistic library.

Keep the exact error and correlation id for a list-view-threshold failure.

---

# API 5 — OData list-item filter

This is the third fallback and a compatibility test.

## Test 5.1 — Execution

~~~http
GET {{executionSiteUrl}}/_api/web/lists(guid'{{executionLibraryId}}')/items
~~~

Params:

| Key | Value |
|---|---|
| $select | ID,UniqueId,FileLeafRef,FileRef,FSObjType,ContentTypeId,Created,Modified,Editor/Title,File_x0020_Size |
| $expand | Editor |
| $filter | substringof('PdSearchProbe20260811',FileLeafRef) |
| $orderby | FileLeafRef asc,ID asc |
| $top | 50 |

## Test 5.2 — Marketing

Repeat with marketingSiteUrl and marketingLibraryId.

## Test 5.3 — Check

Verify:

- nested files and folders are returned;
- contains matching works and is case-insensitive;
- required fields are returned;
- SharePoint provides a next link or $skiptoken;
- permissions are respected;
- no list-view-threshold error occurs;
- response time is acceptable.

Do not use ordinary $skip. Test the continuation returned by SharePoint.

---

# API 6 — Folder traversal capability check

This is not a recommended search implementation.

Execution:

~~~http
GET {{executionSiteUrl}}/_api/web/GetFolderById('{{executionRootFolderId}}')?$select=UniqueId,Name,ServerRelativeUrl,ItemCount,Folders/UniqueId,Folders/Name,Folders/ServerRelativeUrl,Files/UniqueId,Files/Name,Files/ServerRelativeUrl,Files/Length&$expand=Folders,Files
~~~

Marketing:

~~~http
GET {{marketingSiteUrl}}/_api/web/GetFolderById('{{marketingRootFolderId}}')?$select=UniqueId,Name,ServerRelativeUrl,ItemCount,Folders/UniqueId,Folders/Name,Folders/ServerRelativeUrl,Files/UniqueId,Files/Name,Files/ServerRelativeUrl,Files/Length&$expand=Folders,Files
~~~

Check that direct child files and folders include UniqueId, name, and path.

Do not walk the complete production tree. Full traversal would require too many calls.

---

# Optional — Load one result by UniqueId

If Search REST returns UniqueID, test one file and one folder.

File:

~~~http
GET {{executionSiteUrl}}/_api/web/GetFileById('{{searchResultUniqueId}}')?$select=UniqueId,Name,ServerRelativeUrl,Length,TimeCreated,TimeLastModified,ListItemAllFields/Editor/Title&$expand=ListItemAllFields/Editor
~~~

Folder:

~~~http
GET {{executionSiteUrl}}/_api/web/GetFolderById('{{searchResultUniqueId}}')?$select=UniqueId,Name,ServerRelativeUrl,ItemCount,TimeCreated,TimeLastModified,ListItemAllFields/Editor/Title&$expand=ListItemAllFields/Editor
~~~

Expected: the canonical object loads from the UniqueID returned by search.

---

# Which API should win?

1. Use Search REST if it returns files and folders from both lists, returns usable
   fields, respects permissions, pages correctly, and its index delay is acceptable.
2. Use RenderListDataAsStream if Search REST is too stale or lacks usable fields and
   list-view search performs reliably.
3. Use recursive CAML if the first two fail and CAML passes realistic-size, threshold,
   permission, and paging tests.
4. Consider OData only if it proves better than CAML on the real farm.
5. Do not choose recursive folder traversal for project-wide search.

# Result sheet

~~~text
Date:
Tester:
MicrosoftSharePointTeamServices header:
Execution and Marketing on same site/farm?:

API 1 — Search REST GET
Basic status:
Files returned?:
Folders returned?:
Deep file returned?:
Deep folder returned?:
Filename-only confirmed?:
Execution Path scope works?:
Marketing Path scope works?:
One query returns both lists?:
UniqueID returned?:
Path returned?:
ParentId returned?:
IsContainer returned?:
IsDocument returned?:
Other missing fields:
Paging works?:
Permission test:
Create indexing delay:
Rename indexing delay:
Move indexing delay:
Delete indexing delay:
Special names:
Typical response time:
Errors and SPRequestGuid:

API 2 — Search REST POST
Status:
Working body: wrapped / unwrapped / neither
Same results as GET?:
Errors and SPRequestGuid:

API 3 — RenderListDataAsStream
Execution status:
Marketing status:
Files/folders/deep items?:
Name matching behavior:
Required fields returned?:
Paging works?:
Permission test:
Immediate consistency?:
Threshold result:
Typical response time:
Errors and SPRequestGuid:

API 4 — Recursive CAML GetItems
Execution status:
Marketing status:
Files/folders/deep items?:
Contains/case behavior:
Required fields returned?:
Paging works?:
Permission test:
Immediate consistency?:
Threshold result:
Typical response time:
Errors and SPRequestGuid:

API 5 — OData filter
Execution status:
Marketing status:
Nested files/folders?:
Contains/case behavior:
Required fields returned?:
Paging works?:
Permission test:
Threshold result:
Typical response time:
Errors and SPRequestGuid:

API 6 — Folder traversal
Execution root status:
Marketing root status:
Required child fields returned?:

Recommended API:
Reason:
Questions remaining:
~~~

## Official references

- [SharePoint Search REST API](https://learn.microsoft.com/en-us/sharepoint/dev/general-development/sharepoint-search-rest-api-overview)
- [SharePoint KQL syntax](https://learn.microsoft.com/en-us/sharepoint/dev/general-development/keyword-query-language-kql-syntax-reference)
- [SharePoint Server managed properties](https://learn.microsoft.com/en-us/sharepoint/technical-reference/crawled-and-managed-properties-overview)
- [SharePoint list-item REST APIs](https://learn.microsoft.com/en-us/sharepoint/dev/sp-add-ins/working-with-lists-and-list-items-with-rest)
