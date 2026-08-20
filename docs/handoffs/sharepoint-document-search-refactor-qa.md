# SharePoint Document Search Refactor — Answers

## Should the fallback keep the scanned-item counter?

Keep a simple `long scannedItemCount` and increment it for every processed item. Use
it only in the completion log to report the total scanned items and matches. Do not
accumulate items merely to calculate the count.

## How should the duplicated pagination loops be refactored?

Use one streaming `consumePages(firstPage, Consumer<SearchItem>)` helper instead of
separate filtered and unfiltered pagination helpers with two consumers. The caller
constructs the appropriate first request, while `consumePages` follows SharePoint's
exact continuation links, passes each item to one consumer, accumulates nothing, and
returns the processed-item count.

This same helper should be used by the fast search, complete-scan fallback, and
folder-only parent lookup. It avoids duplicated continuation logic, no-op callbacks,
and mutable counter workarounds.

Also use the explicit name `normalizedScopePrefix` for the normalized scope path with
exactly one trailing slash before applying
`normalizedFileRef.startsWith(normalizedScopePrefix)`.

## Is the revised single-helper plan approved?

Yes, with two corrections:

1. `consumePages` must count processed items and return that `long`. The fallback
   consumer must not increment another counter; assign the returned value to
   `scannedItemCount`.
2. Empty results are valid, but preserve the current behavior for a null response body
   rather than introducing new silent handling.

Do not add or change continuation-URL validation. Everything else in the revised plan
is approved.
