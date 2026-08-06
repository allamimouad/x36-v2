# SharePoint Folder `webUrl` — Focused Implementation Prompt

Implement backend support for the frontend's **View in SharePoint (web)** button.
Keep this change narrowly focused. Do not redesign the existing mapper, URL builder,
SharePoint clients, list resolution, or document operations.

## Confirmed existing architecture

The project already has:

- `SharepointDocumentListingMapper`, an abstract MapStruct mapper;
- an injected `SharePointDocumentUrlBuilder urlBuilder` inside that mapper;
- an existing folder mapping method approximately like:

```java
public abstract DocumentListing.FolderNode spFolderToFolderNode(
        SPFolder folder,
        @Context SharepointList sharepointList,
        @Context String parentId
);
```

- an existing file mapping method using the same `SharepointList` and `parentId`
  contexts;
- existing builder methods for file `onlineUrl`, `desktopUrl`, and `downloadUrl`;
- `SharepointList`, which contains:
  - the SharePoint list/library name;
  - its associated `SharepointSite`;
- `SharepointSite`, which contains the SharePoint site name;
- `SPFolder.serverRelativeUrl()`, which contains the decoded canonical folder path.

The current mapper already maps folder values approximately as follows:

```java
@Mapping(source = "uniqueId", target = "id")
@Mapping(source = "name", target = "name")
@Mapping(source = "serverRelativeUrl", target = "path")
@Mapping(source = "itemCount", target = "itemCount")
@Mapping(source = "timeCreated", target = "createdAt")
@Mapping(
    source = "listItemAllFields.fieldValuesAsText.editor",
    target = "modifiedBy"
)
@Mapping(
    target = "modifiedAt",
    expression = "java(toOffsetDateTime(folder))"
)
@Mapping(target = "kind", constant = "FOLDER")
@Mapping(
    target = "listKey",
    expression = "java(sharepointList.getListType().name())"
)
@Mapping(
    target = "parentId",
    expression = "java(resolveParentId(folder, sharepointList, parentId))"
)
public abstract DocumentListing.FolderNode spFolderToFolderNode(
        SPFolder folder,
        @Context SharepointList sharepointList,
        @Context String parentId
);
```

Inspect the actual code and use its exact types and accessor names. The example above
describes the existing structure; do not duplicate the method.

---

## Main outcome

Every public `FolderNode` response must contain an optional absolute SharePoint browser
URL:

```json
{
  "kind": "FOLDER",
  "listKey": "EXECUTION",
  "id": "folder-guid",
  "path": "/sites/TestSite/Documents/Contracts/Vendors",
  "name": "Vendors",
  "parentId": "parent-guid",
  "itemCount": 5,
  "createdAt": "2026-08-06T10:00:00Z",
  "modifiedAt": "2026-08-06T10:00:00Z",
  "modifiedBy": "User Name",
  "webUrl": "https://sharepoint.example.com/sites/TestSite/Documents/Forms/AllItems.aspx?RootFolder=%2Fsites%2FTestSite%2FDocuments%2FContracts%2FVendors"
}
```

Use the exact JSON property name:

```text
webUrl
```

The frontend is already implemented. It enables the button when the current
`FolderNode.webUrl` is a valid absolute `http` or `https` URL and opens it in a new tab.
Do not modify the frontend.

---

## 1. Add `webUrl` to the existing folder DTO

Find the existing public `DocumentListing.FolderNode` record/class and add exactly one
optional property:

```java
String webUrl
```

Follow the real DTO's style and existing field order. Do not copy or recreate the
complete DTO merely from this prompt.

Do not:

- add `webUrl` to `FileNode`;
- rename existing fields;
- change `kind`, `listKey`, `parentId`, or timestamp types;
- create another folder response DTO;
- expose the SharePoint site/list model to the frontend.

The existing file-only fields remain unchanged:

```text
onlineUrl
desktopUrl
downloadUrl
```

---

## 2. Use only the context that already exists

The folder mapper already receives everything required:

```text
siteName               <- sharepointList.getSharepointSite().getSiteName()
listName               <- the existing list-name property on sharepointList
folderServerRelativeUrl <- folder.serverRelativeUrl()
```

Inspect `SharepointList` and use the real accessor for its list name, for example
`getListName()` or `getName()`. Do not guess the accessor without inspecting the class.

The list name in this application is assumed to be the document library URL segment
used between the site URL and `/Forms/AllItems.aspx`. Preserve its canonical value.
Do not lowercase or uppercase it.

Do not introduce:

- `SharePointDocumentMappingContext`;
- another MapStruct `@Context` object;
- another `SharepointList` lookup;
- a new list-resolution service;
- a new SharePoint list DTO;
- a `DefaultViewUrl` SharePoint query;
- a root-folder lookup;
- a database or configuration property for `webUrl`.

Keep both existing contexts exactly as they are:

```java
@Context SharepointList sharepointList
@Context String parentId
```

The separate `parentId` context is required by the existing parent-resolution logic.
Do not remove or replace it.

---

## 3. Extend the existing URL builder

Add one method to the existing `SharePointDocumentUrlBuilder`:

```java
public String buildFolderWebUrl(
        String siteName,
        String listName,
        String folderServerRelativeUrl
)
```

Use the existing project's exact naming conventions if they differ slightly, but keep
these three responsibilities and inputs.

The builder already knows how the configured SharePoint base URL and `siteName` become
the site's absolute URL because its existing file-link methods use the same site-name
input. Reuse that existing site URL construction. Do not implement a second base URL
resolver.

The new method must build:

```text
{absoluteSiteUrl}/{encodedListName}/Forms/AllItems.aspx
    ?RootFolder={encodedFolderServerRelativeUrl}
```

Example:

```text
siteName:
TestSite

listName:
Documents

folderServerRelativeUrl:
/sites/TestSite/Documents/Contracts/Vendors
```

Expected logical result:

```text
https://sharepoint.example.com/sites/TestSite/Documents/Forms/AllItems.aspx?RootFolder=%2Fsites%2FTestSite%2FDocuments%2FContracts%2FVendors
```

The target SharePoint Server 2016 environment has already been manually tested with
the `Forms/AllItems.aspx?RootFolder=...` format.

### Required builder behavior

1. Validate that `siteName`, `listName`, and `folderServerRelativeUrl` are not null or
   blank.
2. Reuse the existing site URL resolution already used for file links.
3. Add the list name as a URL path segment.
4. Add `Forms` and `AllItems.aspx` as path segments inside the builder.
5. Add or replace exactly one `RootFolder` query parameter.
6. Treat `folderServerRelativeUrl` as a decoded server-relative path.
7. Encode the complete result exactly once.
8. Preserve the scheme, host, optional port, and resolved site path.
9. Return the final absolute URL string.

Use Spring's existing `UriComponentsBuilder`. Follow the same correct encoding approach
already used by the current file URL builder.

An acceptable implementation shape is:

```java
public String buildFolderWebUrl(
        String siteName,
        String listName,
        String folderServerRelativeUrl
) {
    requireNotBlank(siteName, "siteName");
    requireNotBlank(listName, "listName");
    requireNotBlank(folderServerRelativeUrl, "folderServerRelativeUrl");

    URI siteUrl = resolveSiteUrl(siteName); // reuse the existing real helper

    return UriComponentsBuilder.fromUri(siteUrl)
            .replaceQuery(null)
            .fragment(null)
            .pathSegment(listName, "Forms", "AllItems.aspx")
            .queryParam("RootFolder", folderServerRelativeUrl)
            .build()
            .encode()
            .toUriString();
}
```

This is a structural example. Use the builder's actual existing helper names. Do not
create `resolveSiteUrl` or `requireNotBlank` duplicates if equivalent helpers already
exist.

Before using `.pathSegment(listName, ...)`, inspect the existing resolved site URL:

- If the existing site URL never has a trailing slash, the shown pattern is suitable.
- If it can have one, ensure the result does not contain an invalid double slash.
- If the existing builder already exposes a helper for safely adding decoded path
  segments, reuse it.

### Encoding requirements

- A list name containing spaces must be encoded once.
- Folder spaces must be encoded inside the `RootFolder` query value.
- `&` in a folder name must not start another query parameter.
- `+` in a folder name must not become a space.
- `#` in a supported folder name must not become a URL fragment.
- Unicode characters must produce a valid URL.
- `%20` must never become `%2520`.

Do not:

- use `URLEncoder`;
- concatenate `?RootFolder=` manually;
- concatenate the complete URL with `StringBuilder`;
- manually parse the scheme, host, query, or fragment;
- call `URI.create()` with a decoded path containing spaces;
- encode the complete URL twice;
- inject another properties class or service into the builder;
- perform an HTTP or database call from the builder;
- alter the working file URL methods unless compilation requires a minimal shared
  helper extraction.

---

## 4. Add one folder mapping

Update the existing `spFolderToFolderNode` mapping method. Add only the `webUrl`
mapping needed by this feature.

Conceptually:

```java
@Mapping(
    target = "webUrl",
    expression = "java(urlBuilder.buildFolderWebUrl(" +
        "sharepointList.getSharepointSite().getSiteName(), " +
        "sharepointList.getListName(), " +
        "folder.serverRelativeUrl()))"
)
```

Replace `getListName()` with the actual existing accessor after inspecting
`SharepointList`.

Do not change these existing mappings:

```java
@Mapping(
    target = "listKey",
    expression = "java(sharepointList.getListType().name())"
)
@Mapping(
    target = "parentId",
    expression = "java(resolveParentId(folder, sharepointList, parentId))"
)
```

This is especially important. The operation-provided `parentId` must remain correct;
do not replace it with a parent value taken from an unrelated or source folder.

Keep the existing injected builder:

```java
@Autowired
protected SharePointDocumentUrlBuilder urlBuilder;
```

Do not manually instantiate the builder and do not create another mapper.

Do not modify the existing file URL expressions for `onlineUrl`, `desktopUrl`, and
`downloadUrl` as part of this feature.

---

## 5. Folder-response coverage

Because the existing folder mapper is reused, first identify all its call sites.
Ensure `webUrl` is present whenever the backend returns a `FolderNode`, including as
applicable:

1. root document listing;
2. child document listing;
3. resolve-folder-by-path listing;
4. create-folder response;
5. rename-folder response;
6. move-folder response;
7. copy-folder response;
8. any get-folder response used by the frontend.

Prefer coverage through the existing shared mapper. Do not add separate manual
`webUrl` construction to every service method.

If some operation uses another existing folder mapping method, add the same builder
call there or route it through the existing common mapping helper. Do not redesign the
operation.

The URL must use the canonical returned `folder.serverRelativeUrl()`, especially after
create, rename, move, copy, or collision resolution. Do not build it from the requested
folder name.

For cross-list or cross-site folder results, the mapper must receive the destination
`SharepointList`; the URL must therefore use the destination site and list name.

---

## 6. Tests

Add focused tests for `SharePointDocumentUrlBuilder.buildFolderWebUrl`.

At minimum cover:

1. A normal nested folder.
2. The document-library root folder.
3. A list name containing spaces.
4. A folder path containing spaces.
5. A folder path containing `&`.
6. A folder path containing `+`.
7. Apostrophes and Unicode characters.
8. Characters supported by the farm that require query encoding.
9. A site URL with a trailing slash.
10. A site URL containing a non-default port.
11. A site resolved under `/sites`.
12. A site resolved under another managed path if the existing site resolver supports
    it.
13. Exactly one `RootFolder` query parameter.
14. No double encoding.
15. Null and blank `siteName` are rejected.
16. Null and blank `listName` are rejected.
17. Null and blank `folderServerRelativeUrl` are rejected.

Assert the final public URL string, not only private helper behavior.

Also add or update mapper tests proving:

- `webUrl` is populated on a folder response;
- the mapper passes the existing SharePoint site name;
- the mapper passes the existing SharePoint list name;
- the mapper passes `folder.serverRelativeUrl()`;
- `listKey` remains the uppercase `sharepointList.getListType().name()` value;
- `parentId` still comes from the existing `resolveParentId(...)` behavior;
- file mappings remain unchanged;
- a destination Sharepoint list is used for cross-list/cross-site folder results.

Do not make real SharePoint HTTP calls in URL-builder or mapper unit tests.

---

## 7. Restrictions

Do not:

- introduce a new mapping-context record;
- remove either existing `@Context` parameter;
- add a `DefaultViewUrl` lookup;
- add a root-folder lookup;
- add a SharePoint client method;
- add an HTTP call;
- add a database field;
- add a new configuration property;
- create another URL builder;
- create another mapper;
- create another folder DTO;
- refactor file URL generation;
- change parent-id resolution;
- change list-key casing;
- change endpoint routes;
- modify Angular code;
- modify upload, download, recycle-bin, delete, copy, authentication, or unrelated
  behavior.

The intended implementation is small:

1. add `webUrl` to the existing folder response;
2. add one method to the existing URL builder;
3. add one mapping to the existing folder mapper;
4. ensure all existing folder-returning paths use that mapping;
5. add focused tests.

---

## 8. Final verification and response

After implementation:

1. Run the focused builder and mapper tests.
2. Run compilation/tests for the affected Maven module.
3. Remove unused imports and dead code.
4. Show the exact files changed.
5. Show the final `FolderNode` DTO change.
6. Show the final `buildFolderWebUrl` method.
7. Show the exact `webUrl` MapStruct mapping.
8. List every folder-returning operation covered.
9. State the exact `SharepointList` accessor used for the list name.
10. Confirm that no new context, resolver, client call, database field, or configuration
    property was introduced.
11. Do not claim tests passed unless they actually ran successfully.

Implement the change now.
