# SharePoint Document Search Facade Refactor

Refactor the existing SharePoint document-search facade without changing its public
API, DTOs, frontend contract, Feign endpoints, or search behavior.

First inspect the current implementation and reuse its existing types, naming
conventions, exceptions, logging style, and helper methods. Do not redesign the
surrounding architecture.

Implement these three related changes.

## 1. Stream the fallback scan

In the complete-scan Java-filtering fallback, remove the collection that stores every
SharePoint item, currently named something similar to `allItems`.

While processing every SharePoint continuation page:

- increment a scanned-item counter if the existing logging needs the total;
- add every valid folder to `folderPathToId`;
- apply the Java search predicate immediately;
- add only matching items to `matchedItems`;
- do not resolve parent IDs until every SharePoint page has been scanned, because a
  matched item's parent folder might appear on a later page;
- after the final page, convert `matchedItems` to `SearchMatch` objects using the
  completed folder lookup map.

Preserve the existing threshold-safe fallback pagination:

- keep `$top=1000`;
- follow the exact `nextLink` returned by SharePoint;
- do not introduce `$orderby`;
- do not add a SharePoint filter to the complete-scan fallback;
- do not calculate page IDs or offsets manually;
- do not collect all pages into another combined list.

You may extract a small streaming pagination helper to remove duplicated
first-page/next-page loops. If you do, it must process items incrementally through a
consumer or callback and must not accumulate all SharePoint items internally.

## 2. Centralize `SearchMatch` creation and parent resolution

Create one private helper, named appropriately for the existing code, equivalent to:

```text
createSearchMatch(item, folderPathToId)
```

Use it from both the fast filtered path and the complete-scan fallback.

The helper must:

- obtain the item's parent path from `FileDirRef`;
- normalize the parent path using the existing path-normalization rules;
- resolve `parentId` from `folderPathToId`;
- apply the same resolution behavior to matched files and matched folders;
- throw the project's existing appropriate SharePoint/client exception when a
  required parent cannot be resolved;
- never silently skip a matched item;
- never return a non-root search result with a null or fabricated parent ID.

Remove duplicated parent-resolution loops and conditions from the fast and fallback
implementations.

## 3. Centralize Java search matching

Create one private helper equivalent to:

```text
matchesSearch(item, normalizedScopePath, normalizedQuery)
```

Use the same helper wherever Java verification or filtering is performed, including
the complete-scan fallback and defensive verification of filtered SharePoint results.

The predicate must:

- match the query only against `FileLeafRef`;
- never use `FileRef` or the full path as query text;
- verify that the item is recursively beneath the requested scope;
- use a path boundary such as `normalizedScopePath + "/"` so similarly prefixed
  sibling folders are not included;
- exclude the scope folder itself;
- apply consistent null-safe normalization and case handling;
- use `Locale.ROOT` if values are lowercased.

Keep the fast SharePoint filter equivalent to:

```text
substringof(query, FileLeafRef)
and (FileDirRef eq scopePath or startswith(FileDirRef, scopePath + '/'))
```

## Constraints

- Keep the current fast-filter-then-threshold-fallback behavior.
- Catch only the existing specific threshold exception for fallback.
- Keep the conditional folder-only lookup required to resolve missing parent IDs.
- Keep the existing canonical search DTO and `SearchMatch` contract.
- Do not return a fake, empty, random, scope, or otherwise incorrect `parentId`.
- Do not change controllers, endpoint paths, service contracts, frontend models, or
  response shapes.
- Do not add `File` or `Folder` expansions.
- Do not add an `ItemCount` or other preflight request.
- Do not add `$orderby`.
- Do not add application-level pagination or result truncation.
- Avoid unrelated refactoring.

After implementation, summarize exactly which facade methods were changed or added
and confirm that the fallback no longer retains every SharePoint item in memory.
