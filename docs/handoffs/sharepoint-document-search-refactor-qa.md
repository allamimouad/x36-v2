# SharePoint Document Search Refactor — Answers

## Should the fallback keep the scanned-item counter?

Keep a simple `long scannedItemCount` and increment it for every processed item. Use
it only in the completion log to report the total scanned items and matches. Do not
accumulate items merely to calculate the count.
