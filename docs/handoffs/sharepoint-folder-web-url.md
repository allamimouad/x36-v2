# SharePoint Current-Folder Web URL — Implementation Prompt

Implement backend support for the frontend's **View in SharePoint (web)** button.
Make the change carefully and keep it limited to the folder web URL, the folder DTO,
the existing SharePoint list-resolution/mapping context, mapper integration, and the
directly relevant tests. Do not redesign unrelated document operations.

## Confirmed behavior and environment

The target environment is SharePoint Server 2016. The following browser URL behavior
has been manually tested successfully in the real environment:

```text
{absoluteDefaultViewUrl}?RootFolder={encodedFolderServerRelativeUrl}
```

Example inputs:

```text
siteUrl:
https://sharepoint.example.com/sites/MMAAE00001

defaultViewServerRelativeUrl:
/sites/MMAAE00001/Shared Documents/Forms/AllItems.aspx

rootFolderServerRelativeUrl:
/sites/MMAAE00001/Shared Documents

folderServerRelativeUrl:
/sites/MMAAE00001/Shared Documents/Contracts/Vendors
```

Expected root URL:

```text
https://sharepoint.example.com/sites/MMAAE00001/Shared%20Documents/Forms/AllItems.aspx
```

Expected nested-folder URL:

```text
https://sharepoint.example.com/sites/MMAAE00001/Shared%20Documents/Forms/AllItems.aspx?RootFolder=%2Fsites%2FMMAAE00001%2FShared%20Documents%2FContracts%2FVendors
```

The exact escaping produced by the installed Spring version must be asserted in tests.

SharePoint provides both required server-relative values:

- `SP.List.DefaultViewUrl` is the server-relative URL of the list's configured default
  view.
- `SP.Folder.ServerRelativeUrl` is the canonical server-relative folder path.

Do not hardcode `Forms/AllItems.aspx`. A library can use a different configured
default view, and SharePoint already exposes its canonical `DefaultViewUrl`.

Useful Microsoft references:

- https://learn.microsoft.com/en-us/previous-versions/office/sharepoint-csom/ee536763%28v%3Doffice.15%29
- https://learn.microsoft.com/en-us/sharepoint/dev/sp-add-ins/working-with-folders-and-files-with-rest

---

## 1. Inspect the existing implementation before editing

Before making changes, find and inspect the real classes and tests for:

- the public folder-node response DTO/record;
- the SharePoint folder response DTO containing `ServerRelativeUrl`;
- the existing SharePoint list response/resolution model;
- the existing SharePoint list client call and its `$select`/`$expand` values;
- the existing project + `listKey` to SharePoint site/list resolution flow;
- `SharePointDocumentUrlBuilder` or its actual equivalent;
- `SharePointDocumentMappingContext` or its actual equivalent;
- the MapStruct mapper that maps SharePoint folders to public folder nodes;
- root document listing, child document listing, and resolve-path services;
- create, rename, move, and copy folder response paths;
- existing URL-builder and mapper tests.

Reuse and update those structures. Do not create duplicate folder DTOs, list DTOs,
mappers, URL builders, list resolvers, or configuration classes.

The previous file-link refactor should already have made the URL builder a pure
component that receives a resolved absolute `URI siteUrl` and uses Spring's
`UriComponentsBuilder`. Extend that implementation instead of restoring manual URL
logic.

---

## 2. Public DTO contract

Add exactly one optional property to the existing public folder-node response:

```java
String webUrl
```

Use the project's actual DTO style. For example, if it is a record:

```java
public record FolderNodeResponse(
        String kind,
        DocumentListKey listKey,
        String id,
        String path,
        String name,
        String parentId,
        long itemCount,
        OffsetDateTime createdAt,
        OffsetDateTime modifiedAt,
        String modifiedBy,
        String webUrl
) {
}
```

Do not copy this example blindly: inspect the real field types, ordering, naming, and
record/class conventions, and add only `webUrl` to the existing structure.

Rules:

- The JSON property name must be exactly `webUrl`.
- `webUrl` belongs to folder responses, not file responses.
- Do not rename or remove existing DTO properties.
- Do not reuse file-only `onlineUrl`, `desktopUrl`, or `downloadUrl` for this purpose.
- Do not expose `siteUrl`, `DefaultViewUrl`, list GUIDs, configuration records,
  credentials, access tokens, or mapper context in the public response.
- Keep `webUrl` nullable/optional so partial environments and old mock data do not
  break clients. When all required canonical inputs are available, populate it.

The Angular frontend already contains:

```ts
export interface FolderNode {
    // existing fields...
    webUrl?: string;
}
```

The frontend button reads `navigation.currentFolder()?.webUrl`, validates that it is
an absolute `http`/`https` URL without embedded credentials, and opens it in a new tab
with `noopener`. Do not modify the Angular frontend in this backend task.

---

## 3. Required semantics

`webUrl` must open the exact folder represented by the returned `FolderNode`:

- for an `EXECUTION` root folder, open the Execution library root;
- for a `MARKETING` root folder, open the Marketing library root;
- for a nested folder, open that exact nested folder through the list's configured
  default SharePoint view.

The URL must be based on the destination/current folder's own list context. Execution
and Marketing may be hosted on different SharePoint sites.

Do not always return the list root URL. The frontend button is context-sensitive: as
the user navigates into `Contracts/Vendors`, it must open `Contracts/Vendors`, not the
top of the document library.

---

## 4. Resolve list metadata once, outside the URL builder

The URL builder must not call SharePoint or resolve a project/list itself.

The existing service/list-resolution layer must provide these already resolved,
canonical values:

```text
siteUrl                      absolute URI for the SharePoint web/site
defaultViewServerRelativeUrl SP.List.DefaultViewUrl
rootFolderServerRelativeUrl  SP.List.RootFolder.ServerRelativeUrl
```

If the existing SharePoint list response already contains these properties, reuse
them.

If `DefaultViewUrl` is not currently selected, extend the existing list-resolution
request/DTO instead of adding a separate HTTP call per folder. An acceptable existing
list query shape is conceptually:

```text
$select=DefaultViewUrl,RootFolder/ServerRelativeUrl
$expand=RootFolder
```

Adapt this to the real client and existing selections. Do not discard fields already
selected by the application.

Important constraints:

- Do not make one additional SharePoint HTTP call for every mapped folder.
- Do not resolve the same list repeatedly inside a collection mapper.
- Resolve the site/list metadata once per service operation, or reuse the existing
  resolved/cached list context if the application already has one.
- Do not derive the default view by appending `/Forms/AllItems.aspx`.
- Do not derive a site by guessing `/sites/{siteName}`.
- Do not assume all managed paths are `/sites`; `/teams`, root sites, subwebs, custom
  managed paths, and non-default ports must remain valid.

---

## 5. Mapping context

Extend the existing mapping context if one already carries `siteUrl`. Do not create a
second overlapping context merely for folders.

An acceptable target shape is:

```java
public record SharePointDocumentMappingContext(
        URI siteUrl,
        String defaultViewServerRelativeUrl,
        String rootFolderServerRelativeUrl
) {
    public SharePointDocumentMappingContext {
        Objects.requireNonNull(siteUrl, "siteUrl must not be null");

        if (!siteUrl.isAbsolute()) {
            throw new IllegalArgumentException("siteUrl must be absolute");
        }

        if (defaultViewServerRelativeUrl == null
                || defaultViewServerRelativeUrl.isBlank()) {
            throw new IllegalArgumentException(
                    "defaultViewServerRelativeUrl must not be blank"
            );
        }

        if (rootFolderServerRelativeUrl == null
                || rootFolderServerRelativeUrl.isBlank()) {
            throw new IllegalArgumentException(
                    "rootFolderServerRelativeUrl must not be blank"
            );
        }
    }
}
```

Use the real project naming conventions. If file mapping operations do not always have
list default-view metadata, do not break them by forcing inappropriate data into every
call. In that case, either:

1. extend the existing context with nullable folder-only metadata and validate it only
   in `buildFolderWebUrl`, or
2. introduce one clearly scoped list/folder mapping context only if the existing
   mapper architecture genuinely requires it.

Prefer extending the existing operation context when it already represents the
resolved SharePoint list. Avoid parallel contexts carrying duplicate `siteUrl` values.

The service layer creates the context. The mapper and URL builder must not inject or
read `SharePointProperties`.

---

## 6. Extend the existing URL builder

Add folder URL construction to the existing `SharePointDocumentUrlBuilder` (or its
actual equivalent). Do not create another URL builder with duplicated canonical URL
logic.

Required public method:

```java
public String buildFolderWebUrl(
        URI siteUrl,
        String defaultViewServerRelativeUrl,
        String rootFolderServerRelativeUrl,
        String folderServerRelativeUrl
)
```

Follow the same canonical URL rules as the existing helper that combines:

- the scheme, host, and optional port from `siteUrl`;
- a complete decoded server-relative path.

The server-relative path replaces the path of `siteUrl`; it is not appended to it.

An acceptable implementation pattern is:

```java
public String buildFolderWebUrl(
        URI siteUrl,
        String defaultViewServerRelativeUrl,
        String rootFolderServerRelativeUrl,
        String folderServerRelativeUrl
) {
    Objects.requireNonNull(siteUrl, "siteUrl must not be null");

    if (!siteUrl.isAbsolute()) {
        throw new IllegalArgumentException("siteUrl must be absolute");
    }

    String normalizedDefaultView = normalizeServerRelativeUrl(
            defaultViewServerRelativeUrl
    );
    String normalizedRoot = normalizeServerRelativeUrl(
            rootFolderServerRelativeUrl
    );
    String normalizedFolder = normalizeServerRelativeUrl(
            folderServerRelativeUrl
    );

    UriComponentsBuilder builder = UriComponentsBuilder
            .fromUri(siteUrl)
            .replacePath(normalizedDefaultView)
            .replaceQuery(null)
            .fragment(null);

    if (!sameSharePointPath(normalizedRoot, normalizedFolder)) {
        builder.queryParam("RootFolder", normalizedFolder);
    }

    return builder
            .build()
            .encode()
            .toUriString();
}
```

Build the decoded default-view path and decoded `RootFolder` value in one
`UriComponentsBuilder`, then encode the complete result once. Do not first turn the
default-view path into an encoded URI and then call `.encode()` again after adding the
query parameter; that risks changing `%20` into `%2520`.

Normalize only what is required. At minimum:

```java
private String normalizeServerRelativeUrl(String value) {
    if (value == null || value.isBlank()) {
        throw new IllegalArgumentException(
                "server-relative URL must not be blank"
        );
    }

    return value.startsWith("/") ? value : "/" + value;
}
```

For root comparison, tolerate a trailing slash difference. SharePoint paths in this
environment are case-insensitive, so a case-insensitive canonical comparison is
acceptable, but do not lowercase the path placed into the final URL. Preserve the
canonical casing returned by SharePoint.

For example:

```java
private boolean sameSharePointPath(String left, String right) {
    return trimTrailingSlash(left)
            .equalsIgnoreCase(trimTrailingSlash(right));
}
```

Do not use this comparison to authorize or prove containment. It is only deciding
whether `RootFolder` can be omitted for the library root.

### Encoding rules

- Treat all three SharePoint path inputs as decoded server-relative paths.
- Encode exactly once.
- Spaces must become valid URL encoding.
- A plus sign in a folder name must not become a space.
- An ampersand in a folder name must remain part of the `RootFolder` value, not start a
  second query parameter.
- A `#` in a supported folder name must not become the browser fragment delimiter.
- Do not call `URLEncoder`.
- Do not manually concatenate `?RootFolder=`.
- Do not use `substring`, `indexOf`, `split`, or manual scheme/authority parsing.
- Do not call `URI.create()` with a decoded path containing spaces.
- Do not encode an already encoded complete URI a second time.

The exact `UriComponentsBuilder` build/encode sequence must match the installed Spring
version. If the example sequence produces a different but correct escaping in that
version, use the correct sequence and assert the resulting public URL strings in tests.

---

## 7. Mapper integration

Update the existing MapStruct folder mapper. Do not create a second folder mapper.

Every mapping method that produces a public folder node and has the required resolved
list context must populate:

```java
webUrl = urlBuilder.buildFolderWebUrl(
        context.siteUrl(),
        context.defaultViewServerRelativeUrl(),
        context.rootFolderServerRelativeUrl(),
        source.getServerRelativeUrl()
)
```

Adapt getter/record accessor names to the actual SharePoint response DTO.

Use MapStruct `@Context` consistently. An acceptable mapping shape is:

```java
@Mapping(
    target = "webUrl",
    expression = "java(urlBuilder.buildFolderWebUrl(" +
        "context.siteUrl(), " +
        "context.defaultViewServerRelativeUrl(), " +
        "context.rootFolderServerRelativeUrl(), " +
        "source.getServerRelativeUrl()))"
)
FolderNodeResponse toFolderNode(
        SharePointFolder source,
        String parentId,
        DocumentListKey listKey,
        @Context SharePointDocumentMappingContext context
);
```

Use the project's actual mapper style. If an `@AfterMapping` or helper method is
already used for URL properties, extend that rather than introducing a different style.

Important:

- Preserve the existing correct mapping of `parentId` and uppercase `listKey`.
- For copy/move/create results, use the operation's destination/current parent context,
  not a source folder's parent.
- Use SharePoint's canonical returned `ServerRelativeUrl`, especially after rename,
  move, copy, or collision-resolved creation.
- Do not build `webUrl` from the requested folder name when SharePoint returned a
  different canonical name/path.
- Do not manually instantiate the builder. Use the existing Spring/MapStruct component
  model.
- Do not perform HTTP calls or configuration lookup inside a mapper expression.

---

## 8. Service integration

Find each service/facade call that maps SharePoint folders. It must resolve the
SharePoint site/list metadata once and pass the mapping context.

Conceptually:

```java
ResolvedSharePointList resolvedList = listResolver.resolve(
        projectId,
        listKey
);

SharePointDocumentMappingContext context =
        new SharePointDocumentMappingContext(
                resolvedList.siteUrl(),
                resolvedList.defaultViewUrl(),
                resolvedList.rootFolderServerRelativeUrl()
        );

return mapper.toFolderNode(
        sharePointFolder,
        parentId,
        listKey,
        context
);
```

Adapt this to the existing project. Do not create a new resolver if one already exists.

If the application currently resolves only `siteUrl`, list id, and root folder id,
extend the existing resolved-list model with the canonical server-relative
`DefaultViewUrl` and root-folder path. Do not make the URL builder aware of property
configuration or list ids.

---

## 9. Response coverage

Search every backend path that returns a folder node. Populate `webUrl` for all of
them, including as applicable:

1. root document listing — `currentFolder` and direct child folders;
2. child document listing — `currentFolder` and direct child folders;
3. resolve-folder-by-path listing — `currentFolder` and child folders;
4. create folder response;
5. rename folder response;
6. move folder response;
7. copy folder response;
8. any get-folder endpoint that returns the public folder-node DTO.

This coverage matters because the frontend can navigate to a folder received from any
of these operations. The button must activate as soon as the current cached folder has
a valid `webUrl`.

Do not add `webUrl` to file-only responses. Existing file `onlineUrl`, `desktopUrl`,
and `downloadUrl` behavior must remain unchanged.

---

## 10. Focused tests

Add or update unit tests for the URL builder. Prefer JUnit 5 parameterized tests where
useful.

At minimum test:

1. Library root returns the absolute configured default-view URL without a
   `RootFolder` parameter.
2. A nested folder adds exactly one `RootFolder` parameter.
3. `DefaultViewUrl` is honored when the view filename is not `AllItems.aspx`.
4. Spaces in the default-view path are encoded once.
5. Spaces in the folder path are encoded correctly inside `RootFolder`.
6. An ampersand in a folder name remains inside the `RootFolder` value.
7. A plus sign in a folder name remains a literal plus after URL decoding and is not
   treated as a space.
8. Apostrophes and Unicode characters produce a valid URL.
9. Characters requiring path/query encoding are covered according to the farm's
   supported naming rules.
10. Root/default-view/folder paths without an initial slash are normalized.
11. Trailing slash differences still identify the list root.
12. A `siteUrl` containing a non-default port preserves the port.
13. A `siteUrl` with a trailing slash does not create a double slash.
14. A `/teams/...` path proves the builder does not assume `/sites`.
15. A custom managed path works.
16. A root SharePoint site works.
17. A relative `siteUrl` is rejected.
18. Null or blank default-view, root-folder, and current-folder paths are rejected.
19. The output contains no duplicated `RootFolder` parameter.
20. The output is not double-encoded (`%20` must not become `%2520`).

Use representative constants such as:

```java
private static final URI SITE_URL = URI.create(
        "https://sharepoint.example.com/sites/MMAAE00001"
);

private static final String DEFAULT_VIEW_URL =
        "/sites/MMAAE00001/Shared Documents/Forms/AllItems.aspx";

private static final String ROOT_FOLDER_URL =
        "/sites/MMAAE00001/Shared Documents";

private static final String NESTED_FOLDER_URL =
        "/sites/MMAAE00001/Shared Documents/Contracts/Vendors";
```

Also add mapper/service tests proving:

- a folder response contains `webUrl`;
- `webUrl` uses the folder's canonical returned `ServerRelativeUrl`;
- an `EXECUTION` folder uses Execution's resolved site/default view;
- a `MARKETING` folder uses Marketing's resolved site/default view;
- cross-site/cross-list folder copy or move uses the destination list context;
- file response mapping is unchanged;
- all required folder-returning methods pass the mapping context.

Do not write tests that only restate private implementation details. Assert public DTO
values and final URL strings.

---

## 11. Dependencies

Use Spring's existing `UriComponentsBuilder` from `spring-web`.

The affected Maven module should already declare `spring-web` directly because the
existing document URL builder imports it. If it is already present, do not add a
duplicate dependency. If the earlier refactor was not integrated and this module now
directly imports `UriComponentsBuilder`, declare:

```xml
<dependency>
    <groupId>org.springframework</groupId>
    <artifactId>spring-web</artifactId>
</dependency>
```

Do not specify a version. Do not add `spring-boot-starter-web` merely for the builder.
Do not add another URL library.

---

## 12. Restrictions

Do not:

- modify unrelated DTO properties or endpoint contracts;
- add an Angular/frontend change;
- add `webUrl` to files;
- hardcode `Forms/AllItems.aspx`;
- hardcode `/sites` or a site name;
- guess a library path from its display name;
- expose SharePoint configuration to the frontend;
- inject `SharePointProperties` into the URL builder;
- perform HTTP calls in the URL builder or mapper;
- add a SharePoint call per mapped folder;
- manually concatenate query strings;
- use `URLEncoder`;
- manually split or reconstruct schemes/authorities;
- call `URI.create()` on decoded paths containing spaces;
- encode the same path twice;
- overwrite the correct destination `parentId` or `listKey` during mapping;
- fabricate a URL when required context is absent;
- refactor unrelated SharePoint clients, authentication, uploads, file links, delete,
  recycle-bin behavior, or exception handling.

Keep the implementation straightforward and consistent with the existing file URL
builder and MapStruct integration.

---

## 13. Final verification and response

After implementation:

1. Run the focused URL-builder, mapper, and service tests.
2. Run compilation/tests for the affected Maven module.
3. Run the project's formatter/static analysis if configured.
4. Remove unused imports, dead helpers, and obsolete manual URL code.
5. Show the exact files changed.
6. Show the final folder-node DTO field.
7. Show the final `buildFolderWebUrl` implementation.
8. Show how the service obtains `DefaultViewUrl` and root-folder
   `ServerRelativeUrl` without a per-folder SharePoint call.
9. Show how the mapping context is created.
10. Show how the mapper assigns `webUrl`.
11. List every folder-returning response path covered.
12. State any assumption made about the existing list-resolution model.
13. Do not claim tests passed unless they were actually executed successfully.

Implement the changes now.
