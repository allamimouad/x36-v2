# SharePoint Document Search — Parent ID Reply

Keep the request-local folder path-to-ID lookup.

The target SharePoint REST representation allows `ParentFolder/UniqueId` to be
expanded for folders, but `SP.File` does not expose `ParentFolder`. For file list-item
rows, use `FileDirRef` as the containing-folder path.

While following the existing paginated `/items` response, collect every folder row—not
only matching folders—into a temporary Java map:

```text
normalized folder FileRef -> folder UniqueId
```

Seed the map with the known document-library root path/id and the selected search-scope
path/id. Retain matching rows until all pages have been processed, then map each
result's normalized `FileDirRef` through that lookup to obtain its canonical
`parentId`.

If a matched non-root item's parent is still unresolved after the complete lookup has
been built, throw the project's existing integration/API exception (HTTP 500). Do not
silently skip the item, fabricate an ID, or issue a SharePoint request for every
parent.

`contentType` is not required by this search implementation. Reuse it only if the
existing normal canonical mapper already supplies it without new search-specific
fetching or mapping.
