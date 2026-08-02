# File Links — Reply

I agree with the recommendation: choose Approach A, with one refinement—pass a typed
mapping context and keep URL construction inside the shared builder, not directly
inside MapStruct expressions.

1. Use Approach A: mapper context. The service should resolve the document list and
   its complete SharePoint site URL, then pass that value through the MapStruct chain
   using `@Context`. Prefer a typed context such as
   `SharePointDocumentMappingContext(URI siteUrl)` instead of passing a raw string.
   The mapper should delegate URL generation to `SharePointDocumentUrlBuilder`; it
   should not resolve configuration or perform I/O itself.

2. Initially support the verified Office families only for Online and Local:
   - Word: `.doc`, `.docx`, `.docm`
   - Excel: `.xls`, `.xlsx`, `.xlsm`, `.xlsb`
   - PowerPoint: `.ppt`, `.pptx`, `.pptm`, `.ppsx`

   Matching should be case-insensitive. Generate `downloadUrl` for all normally
   accessible file types. Do not initially generate `onlineUrl` for PDF or images
   until their direct-view behavior is verified in our on-prem SharePoint environment.
   Do not generate `desktopUrl` for PDF or images.

3. `SharePointProperties.getBaseUrl()` returns only the SharePoint farm origin, such
   as `https://sharepoint.example`; it is not the complete site URL. The existing
   document-list resolution must combine that origin with the configured site
   path/name and pass the resulting URL, such as
   `https://sharepoint.example/sites/project-a`, to the mapper. Execution and
   Marketing may resolve to different sites.

   For a direct document URL, resolve the root-relative `ServerRelativeUrl` against
   the site URL's scheme/authority. For `downloadUrl`, retain the full site URL and
   append `/_layouts/15/download.aspx`. Do not append `/sites/...` twice.
