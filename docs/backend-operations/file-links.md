# File Open and Download Links

> **Status: frontend contract implemented; SharePoint link formats manually verified
> in the connected on-prem environment on 2026-07-31; backend DTO mapping pending.**
> This document is the backend handoff for the three file context-menu actions:
> Online Application, Local application, and Download File.

## Outcome

Every backend response that contains a file node may provide three independent,
ready-to-use links:

```json
{
  "kind": "file",
  "listKey": "execution",
  "id": "sharepoint-unique-id",
  "path": "/sites/project/Documents/Reports/report.docx",
  "name": "report.docx",
  "parentId": "parent-folder-guid",
  "sizeBytes": 4096,
  "createdAt": "2026-07-31T08:00:00Z",
  "modifiedAt": "2026-07-31T08:00:00Z",
  "onlineUrl": "https://sharepoint.example/sites/project/Documents/Reports/report.docx?web=1",
  "desktopUrl": "ms-word:ofe|u|https://sharepoint.example/sites/project/Documents/Reports/report.docx",
  "downloadUrl": "https://sharepoint.example/sites/project/_layouts/15/download.aspx?SourceUrl=%2Fsites%2Fproject%2FDocuments%2FReports%2Freport.docx"
}
```

Use these exact public DTO property names:

```text
onlineUrl
desktopUrl
downloadUrl
```

They are file-only properties. Folder DTOs do not contain them.

All three remain optional in the Angular type so an unsupported action can be disabled
without breaking a listing. For a normally accessible file, the backend should always
provide `downloadUrl`. It provides `onlineUrl` and `desktopUrl` only when that action is
supported for the file type and environment.

The URLs are navigation capabilities, not backend routing configuration. Returning a
ready-to-use SharePoint link is intentional; do not additionally expose site mapping
records, list GUIDs, credentials, access tokens, Feign configuration, or OAuth state.

## No new content proxy

Do not add a backend endpoint that relays the file bytes for this workflow.

The browser and installed Office applications have been verified to authenticate
directly to SharePoint in the target environment. The backend constructs the links
because it owns `(projectId, listKey) -> siteUrl/library` routing, but SharePoint sends
the file content directly to the browser or Office client:

```text
SharePoint -> browser / Office application
```

Do not replace that with:

```text
SharePoint -> application backend -> browser
```

Backend streaming is a fallback only if direct SharePoint authentication, network
reachability, or an explicit application audit/scan requirement later makes it
necessary.

## Canonical direct document URL

Resolve `(projectId, file.listKey)` through the existing backend-owned configuration
to obtain the correct SharePoint site URL. Execution and Marketing can be on different
sites.

Combine the SharePoint origin with the file's canonical `ServerRelativeUrl`. Encode
path segments correctly, but do not encode the complete URL as one value and do not
double-encode an already encoded path.

Example canonical inputs:

```text
siteUrl          = https://sharepoint.example/sites/project
serverRelativeUrl = /sites/project/Documents/Reports/report.docx
```

Canonical direct document URL:

```text
https://sharepoint.example/sites/project/Documents/Reports/report.docx
```

Use a URI builder. Do not concatenate user-controlled strings into an HTML or
JavaScript fragment.

## `onlineUrl`

For Office files supported by the farm's Office Online Server/WOPI configuration,
return the canonical direct document URL with the query parameter `web=1`.

At minimum, support the verified families:

| File extensions | Online link |
|---|---|
| `.doc`, `.docx`, `.docm` | canonical document URL with `web=1` |
| `.xls`, `.xlsx`, `.xlsm`, `.xlsb` | canonical document URL with `web=1` |
| `.ppt`, `.pptx`, `.pptm`, `.ppsx` | canonical document URL with `web=1` |

Set the query parameter with a URI builder so any existing query is preserved. Do not
blindly append `?web=1`; an existing query requires `&web=1`, and an existing `web`
parameter must be replaced rather than duplicated.

For PDF, images, text, Visio, or another type, return an `onlineUrl` only when the
target farm/browser combination is known to provide an inline viewer. That link may be
the canonical direct URL without `web=1`. If opening the URL would download the file
or show an unsupported page, omit `onlineUrl`; Download remains available.

Microsoft references:

- [Office URI schemes](https://learn.microsoft.com/en-us/office/client-developer/office-uri-schemes)
- [SharePoint Office files and `web=1`](https://learn.microsoft.com/en-us/troubleshoot/sharepoint/lists-and-libraries/files-downloaded-instead-of-opening-office-application)

## `desktopUrl`

Return an Office URI only for a supported desktop application:

| File extensions | URI prefix |
|---|---|
| `.doc`, `.docx`, `.docm` | `ms-word:ofe|u|` |
| `.xls`, `.xlsx`, `.xlsm`, `.xlsb` | `ms-excel:ofe|u|` |
| `.ppt`, `.pptx`, `.pptm`, `.ppsx` | `ms-powerpoint:ofe|u|` |

Append the canonical absolute direct document URL, without `web=1`:

```text
ms-word:ofe|u|https://sharepoint.example/sites/project/Documents/report.docx
```

`ofe` means open for editing. SharePoint and Office still enforce the user's actual
permissions; a read-only user does not gain edit rights from this URI.

Do not return a `desktopUrl` for PDF, image, text, archive, or unknown file types.
Browsers do not provide a reliable generic protocol for launching an arbitrary local
default application with a live remote document.

Additional Microsoft schemes such as `ms-visio`, `ms-project`, `ms-access`, or
`ms-publisher` may be added only after that application and file family are verified in
the target environment.

## `downloadUrl`

Return the direct SharePoint download handler URL:

```text
{siteUrl}/_layouts/15/download.aspx?SourceUrl={encodedServerRelativeUrl}
```

Example:

```text
https://sharepoint.example/sites/project/_layouts/15/download.aspx?SourceUrl=%2Fsites%2Fproject%2FDocuments%2FReports%2Freport.pdf
```

Rules:

1. Use the resolved site URL for the file's `listKey`.
2. Append `/_layouts/15/download.aspx` to that site URL.
3. Put the canonical decoded `ServerRelativeUrl` into the `SourceUrl` query parameter.
4. Encode the query value exactly once with a URI builder.
5. Do not add `web=1`.
6. Do not embed an OAuth bearer token, cookie, signature, or backend credential.

This format was manually verified in the target SharePoint environment. It downloads
directly from SharePoint, so the Angular application does not fetch a Blob and the
backend does not relay bytes.

`downloadUrl` is independent of `onlineUrl` and `desktopUrl`. A Word document can
offer all three actions. Download creates a detached local copy; editing that copy
does not write back to SharePoint.

## Response coverage

Populate fresh links whenever the backend returns a `FileNode`, including:

- root and child document listings;
- resolve-path listings;
- a canonical file response after rename;
- a canonical copied-file response;
- a canonical uploaded-file response;
- a moved-file response when move is implemented.

Links must use the response file's canonical final path and name. This is especially
important after collision-resolved copy/upload and after rename/move. Never construct
links from the requested name when SharePoint returned a different canonical name.

Folder rename can change the paths of cached descendant files without returning those
descendants. The next listing of that renamed folder must return fresh file links.
Do not treat previously issued navigation links as stable identifiers; `id` remains
the stable identity.

## Frontend behavior already implemented

Angular now:

- enables Online Application only for a safe absolute `http`/`https` `onlineUrl`;
- enables Local application only for an allow-listed Microsoft Office URI containing
  an absolute `http`/`https` document URL;
- enables Download File only for a safe absolute `http`/`https` `downloadUrl`;
- opens Online in a new tab with `noopener`;
- launches the desktop URI from the current browsing context;
- downloads through a temporary direct-link anchor without `HttpClient`, `fetch`, or
  Blob buffering;
- shows disabled menu entries when a corresponding link is absent or invalid.

The frontend does not append `web=1`, select an Office protocol from an extension,
construct `download.aspx`, or know the SharePoint site mapping. Those decisions belong
to the backend DTO mapper described here.

## Acceptance checklist

- Word, Excel, and PowerPoint each expose Online, Local, and Download.
- Online opens the SharePoint-hosted document in the browser application.
- Local prompts for and opens the installed Office client.
- Saving from the Office client updates the SharePoint-hosted document.
- Download saves an independent local copy.
- PDF/image/text Online is enabled only when verified; Download remains available.
- Missing optional links disable only their corresponding menu action.
- Spaces, accents, apostrophes, `#`, `%`, and deep folder paths remain valid.
- Execution and Marketing links use their independently configured SharePoint sites.
- Renamed, moved, copied, and uploaded files use their canonical final links.
- No link contains a bearer token or backend credential.
- File bytes do not pass through the application backend.
