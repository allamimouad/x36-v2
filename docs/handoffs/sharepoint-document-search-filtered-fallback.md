# SharePoint Document Search — Filtered Fast Path with Threshold Fallback

Adjust the existing SharePoint document-search implementation to use a fast
server-filtered request with a threshold-specific fallback.

Start by inspecting the existing implementation. Make minimal changes and preserve
the current controller → service → MapStruct → facade → Feign-client architecture,
authentication, configuration resolution, exception mapping, DTO conventions, and URI
builder.

Do not redesign unrelated code, add tests, or commit/push.

## Public contract

Keep the existing endpoint and response unchanged:

```http
GET /projects/{projectId}/document-lists/{listKey}/documents/{folderId}/search?q={query}
```

Return the existing mixed file/folder DTO array.

Validation:

- Trim `q`.
- `q` must be non-empty.
- One-character and two-character searches are valid.
- Do not retain the previous three-character minimum.

## Architecture decision

The SharePoint query strategy and fallback belong in the facade.

The service remains responsible for:

- request/domain validation;
- project and list authorization/configuration;
- resolving `folderId` through the existing folder-by-ID operation;
- validating that the resolved scope belongs to the configured library;
- invoking one semantic facade search operation;
- mapping the returned integration models through the existing MapStruct boundary.

The service must not catch `FeignException`, inspect SharePoint error bodies, construct
OData filters, or manage SharePoint continuation URLs.

The facade owns:

- the fast SharePoint-filtered strategy;
- SharePoint continuation paging;
- recognition of the exact list-view-threshold failure;
- the complete-scan fallback;
- request-local folder-path-to-ID lookup construction.

The Feign client remains declarative and contains only HTTP operations. Do not put
fallback loops or exception-driven strategy selection inside the Feign interface.

## Fast strategy

First try a SharePoint-side filtered list-items query:

```http
GET {site}/_api/web/lists(guid'{listId}')/items
```

Use the equivalent of:

```text
$select=ID,UniqueId,FileLeafRef,FileRef,FileDirRef,FSObjType,Created,Modified,Editor/Title
$expand=Editor
$top=1000
$filter=substringof('{escapedQuery}',FileLeafRef)
        and
        (
          FileDirRef eq '{escapedScopePath}'
          or startswith(FileDirRef,'{escapedScopePath}/')
        )
```

The actual filter must be serialized as one valid OData expression.

Requirements:

- Match only the item's own `FileLeafRef`.
- Include matching files and matching folders.
- Search the complete scope subtree.
- Do not return every child merely because one ancestor folder matches.
- Preserve the slash boundary so similarly prefixed sibling folders are excluded.
- Escape OData string-literal apostrophes by doubling them.
- Build and encode the query through the project's existing URI-building conventions.
- Do not add `$orderby`.
- Do not expand `File` or `Folder`.
- Do not request `File/Length` or `Folder/ItemCount`.

Keep `$top=1000`. It is the requested page size, not a result cap.

Follow SharePoint's exact continuation URL until no continuation remains. Do not assume
omitting `$top` returns every result; SharePoint otherwise defaults to a smaller page,
commonly 100.

Reuse the existing dynamic continuation Feign operation based on an unannotated
`java.net.URI` parameter. Validate continuation URLs using the existing same-site/list
safety logic before following them.

## Threshold fallback

Wrap the complete fast strategy in threshold-specific handling.

If SharePoint returns the recognized list-view-threshold error, discard every partial
result and restart using the already implemented complete `/items` continuation scan
with Java scope/name filtering.

Conceptually:

```java
try {
    return searchWithSharePointFilter(...);
} catch (SharePointThresholdException exception) {
    return searchWithCompleteScanAndJavaFiltering(...);
}
```

Do not perform a preliminary `ItemCount` request.

Fallback only for the exact SharePoint list-view-threshold failure. Do not fallback
for:

- authentication or authorization failures;
- 404/not-found;
- throttling;
- token expiration;
- network failures;
- malformed filters;
- arbitrary HTTP 500 responses.

Identify the threshold response using the existing target-farm error body/code and
classify it before generic Feign/API exception conversion.

If a continuation request in the fast strategy raises the threshold error after
earlier filtered pages succeeded, discard those pages before starting the fallback.
Never merge partial fast results with fallback results.

The existing fallback must:

- request ordinary unfiltered `/items` pages with `$top=1000`;
- follow SharePoint's returned continuation exactly;
- build the folder `FileRef` → `UniqueId` lookup from all folder rows;
- apply slash-bounded scope matching and case-insensitive `FileLeafRef` matching in
  Java;
- return all matches;
- perform no per-folder recursive traversal.

## Parent-ID requirement in the fast strategy

Do not forget that filtered matching rows alone may be insufficient to resolve
`parentId`.

Example:

```text
Contracts/               does not match D0
Contracts/report-D0.pdf  matches D0
```

The matching response can contain `report-D0.pdf` without containing the `Contracts`
folder row. `FileDirRef` supplies the parent path but not its `UniqueId`.

For the fast strategy:

1. Seed the request-local folder lookup with:
   - library root path → library root `UniqueId`;
   - resolved scope path → request `folderId`.
2. Add every matching folder row returned by the filtered search:
   normalized `FileRef` → `UniqueId`.
3. Determine whether any matched row's `FileDirRef` is still unresolved.
4. Only when unresolved parent paths exist, issue a lightweight folder-only query for
   the scoped subtree:

   ```text
   $select=UniqueId,FileRef,FileDirRef,FSObjType
   $top=1000
   $filter=FSObjType eq 1
           and startswith(FileRef,'{escapedScopePath}/')
   ```

   Do not expand `Editor`, `File`, or `Folder` for this lookup.
5. Follow continuation for this folder-only query when present and add all returned
   folder rows to the lookup.
6. If this folder-only request raises the threshold error, discard the fast-strategy
   state and run the complete fallback.
7. After all required pages have been processed, resolve every result `parentId` from
   normalized `FileDirRef`.
8. If a parent remains unresolved, throw the project's normal integration/mapping
   exception. Do not fabricate an ID, use the path as an ID, set a random UUID, or
   silently skip the match.

Avoid one SharePoint request per result or per parent folder.

## Result mapping

Both strategies must return identical existing public file/folder DTO types.

Required search information remains:

- `kind`;
- `listKey`;
- `id` from `UniqueId`;
- `name` from `FileLeafRef`;
- canonical `path` from `FileRef`;
- canonical `parentId`;
- `createdAt` from `Created`;
- `modifiedAt` from `Modified`;
- `modifiedBy` from `Editor/Title`;
- existing file/folder operation URLs generated through the existing helpers.

Search deliberately omits:

- file `sizeBytes`;
- folder `itemCount`.

Do not fabricate zero values for omitted metadata.

Reuse the existing mappers and URL-building helpers. Do not expose SharePoint transport
DTOs or continuation details through the controller.

## Completion report

At completion, report only:

- files changed;
- where the threshold classification occurs;
- facade fast/fallback flow;
- how filtered continuation is followed;
- how parent IDs are resolved;
- confirmation that the public endpoint did not change.
