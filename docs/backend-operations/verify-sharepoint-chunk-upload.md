# Quick Postman Check — SharePoint Chunk Upload

> **Goal:** manually check whether this SharePoint farm supports `StartUpload`,
> `ContinueUpload`, and `FinishUpload`.
>
> This is only a capability check. It uploads the three text fragments `AAA`, `BBB`,
> and `CCC`. The completed file must contain `AAABBBCCC`.

## Postman variables

Use a local Postman environment:

```text
siteUrl        = https://sharepoint.example/sites/project
accessToken    = the same working bearer token used by the existing requests
parentFolderId = UniqueId of a test destination folder
fileName       = chunk-upload-probe.txt
uploadId       = any new GUID, for example 6f9619ff-8b86-d011-b42d-00cf4fc964ff
fileId         = fill this after step 1
offset         = fill this after steps 2 and 3
```

Use these headers:

```text
Authorization: Bearer {{accessToken}}
Accept: application/json;odata=nometadata
Content-Type: application/octet-stream
```

Postman calculates `Content-Length`; do not add it manually.

## 1. Create an empty test file

```http
POST {{siteUrl}}/_api/web/GetFolderById('{{parentFolderId}}')/Files/Add(url='{{fileName}}',overwrite=false)
```

In Postman, select **Body → raw** and leave the body empty.

Expected: `200` or `201`. Copy `UniqueId` from the response into the `fileId`
environment variable.

If the response does not include `UniqueId`, copy `ServerRelativeUrl` and use the
path fallback at the end of this file.

## 2. StartUpload

```http
POST {{siteUrl}}/_api/web/GetFileById('{{fileId}}')/StartUpload(uploadId=guid'{{uploadId}}')
```

Select **Body → raw** and enter exactly:

```text
AAA
```

Do not add a newline.

Expected: `200`. The response should contain the running offset `3`. Put `3` into the
Postman `offset` variable.

## 3. ContinueUpload

```http
POST {{siteUrl}}/_api/web/GetFileById('{{fileId}}')/ContinueUpload(uploadId=guid'{{uploadId}}',fileOffset={{offset}})
```

Select **Body → raw** and enter exactly:

```text
BBB
```

Expected: `200`. The response should contain the new running offset `6`. Replace
`offset` with `6`.

Always use the offset returned by SharePoint. Do not send the chunks in parallel.

## 4. FinishUpload

```http
POST {{siteUrl}}/_api/web/GetFileById('{{fileId}}')/FinishUpload(uploadId=guid'{{uploadId}}',fileOffset={{offset}})
```

Select **Body → raw** and enter exactly:

```text
CCC
```

Expected: `200`. This commits the completed file.

## 5. Verify the result

```http
GET {{siteUrl}}/_api/web/GetFileById('{{fileId}}')/$value
```

Expected response body:

```text
AAABBBCCC
```

If the response is exactly `AAABBBCCC`, the farm supports the complete chunk-upload
sequence through `GetFileById`.

## Path fallback

Only try this if creating the empty file worked but `GetFileById(...)/StartUpload`
reports that the operation or route does not exist.

Copy the test file's `ServerRelativeUrl` into a Postman variable named `filePath`, create
a new empty test file with a new name, and use a new `uploadId`.

Replace the beginning of steps 2–5:

```text
/_api/web/GetFileById('{{fileId}}')
```

with:

```text
/_api/web/GetFileByServerRelativeUrl('{{filePath}}')
```

Then repeat `StartUpload`, `ContinueUpload`, `FinishUpload`, and the final `/$value`
check.

## How to interpret the result

- By-id flow succeeds and returns `AAABBBCCC`: use the by-id chunk design.
- Only the path flow succeeds: chunk upload is supported, but the backend must keep the
  canonical file path returned when it creates the empty file.
- Both flows report that the methods/routes do not exist: this SharePoint REST surface
  does not support the chunk sequence.
- `401` or `403`: authentication/permission problem; the test is inconclusive.
- `400`: first recheck the GUID syntax, returned offset, raw body, and URL encoding.

Record the status and response body from the three upload calls. If a call fails, also
record `SPRequestGuid` or `request-id` from the response headers.

## Cleanup

```http
DELETE {{siteUrl}}/_api/web/GetFileById('{{fileId}}')
If-Match: *
```

## Result to bring back

```text
SharePoint version/header:
Create empty file:
StartUpload status/body:
ContinueUpload status/body:
FinishUpload status/body:
Final downloaded content:
By-id or path:
Any SPRequestGuid/request-id:
```

Microsoft documents that `StartUpload` and `ContinueUpload` return the running total of
uploaded bytes, while `FinishUpload` commits the final fragment. Its older documentation
also contains conflicting platform notes, which is why this direct farm check is
necessary:

- [Microsoft `StartUpload`](https://learn.microsoft.com/en-us/previous-versions/office/sharepoint-server/dn760924%28v%3Doffice.15%29)
- [Microsoft `ContinueUpload`](https://learn.microsoft.com/en-us/previous-versions/office/sharepoint-server/dn760921%28v%3Doffice.15%29)
- [Microsoft `FinishUpload`](https://learn.microsoft.com/en-us/previous-versions/office/sharepoint-csom/dn760922%28v%3Doffice.15%29)
