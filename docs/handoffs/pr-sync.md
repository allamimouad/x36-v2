# PR synchronization

Applied on `sync/pr-changes` from the photographed diffs in
`tmp-screenshots/pr1` through `pr4`. The user confirmed these were the complete set
and chose the PR behavior, local mocks, local popup equivalents, and a Google SVG.

**2026-10-22 scope:** preserve the supplied behavior, including existing bugs and
limitations. No additional bug fixes are authorized during synchronization. The
extra path normalization and guard removal have been rolled back as below;
the proposed narrower activation guard has not been applied.

| Screenshots | Work represented | Local implementation |
| --- | --- | --- |
| PR1 / #110 / CFO-11531 | Recycle bin | Node flag, API methods, mock deleted-subtree snapshots, store routing/writes, tree icon/leaf, deleted metadata table, Restore/Delete menus, confirmation and restore-error dialogs |
| PR2 / CFO-12015 | Default-folder access | Optional node access flags; protected/readonly menu rules, toolbar/paste and external-drop affordances |
| PR3 / #152 / CFO-11535 + CFO-12146 | List access | Root `isListReadonly`, navigation map, target-list folder/tree rules, read-only bin actions and search disabled in bins |
| PR4 / CFO-12253 | Initial navigation | Execution first in tree/default navigation; initial `listKey` + `folderPath` query resolution and query cleanup |

## Source alignment

The follow-up alignment preserves the names, declaration and property order,
helper placement, and template structure visible in the four PRs. This keeps the
common code easy to compare during transfer. It is based on photographed diff
regions, not a complete checkout of the destination repository.

| Earlier local name or structure | Aligned source |
| --- | --- |
| `createFolderButtonDisabled`, `uploadButtonDisabled` | `isCreateFolderButtonDisabled`, `isUploadButtonDisabled`, immediately after `creatingFolder` |
| `contextMenuForNode` | `getContextMenu`, after the initial-navigation and search-reset helpers |
| `openInitialFolderPath` | `getInitialFolderParamsFromRoute` then `navigateToInitialFolder`; injected route named `activatedRoute` |
| Inline bin confirmation and `confirmPermanentDelete` | `deleteRecycleBinItem`, `confirmDeleteRecycleBinItem`, then `restoreRecycleBinItem`, after `recycleBinContextMenu` |
| Filtered `visibleFolderCount` | `foldersLength` and `getFoldersLengthDependingOnIfRootFolder`; subtract one bin at the root, as in the PR |
| Inline tree sorting, `_loadRoot$` | `sortFoldersByAlphabeticalAndRecycleBin`, `_loadRoots` |
| Dynamic `recycleColumns` array | Static five-column bin template from the PR |

Folder-menu locals are ordered `locked`, `root`, `isProtected`, `isReadonly`;
file-menu locals are `locked`, `openItems`, `isReadonly`. Navigation computeds and
their returned properties follow the PR order: `currentFolder`,
`currentFolderIsRecycleBin`, `isCurrentFolderReadonly`, `isListReadonly`, then
`readonlyAccessByListKey`. Bin mutations use the same `id`, `subtree`, and `node`
locals. Component inputs, node object properties, import members, tree helpers,
and container bindings were also aligned where shown.

Useful screenshot anchors (paths relative to `tmp-screenshots/`):

| Region | Reference images |
| --- | --- |
| Bin table and API declaration order | `pr1/20261020_234720.jpg` through `20261020_234903.jpg`; `pr1/20261020_235137.jpg` |
| Store mutations, menus, sort/count helpers | `pr1/20261020_235451.jpg`, `20261020_235501.jpg`, `20261020_235718.jpg`, `20261020_235741.jpg`, `20261020_235753.jpg` |
| Toolbar, menu locals, paste order | `pr2/20261021_014444.jpg`, `20261021_014514.jpg`, `20261021_014554.jpg` |
| Generated access-enum imports | `pr2/20261021_014214.jpg`, `20261021_014316.jpg`, `20261021_014330.jpg`, `20261021_014444.jpg`; `pr3/20261021_015824.jpg` |
| Navigation computeds, container bindings and menus | `pr3/20261021_015824.jpg`, `20261021_015848.jpg`, `20261021_015912.jpg`, `20261021_015955.jpg` |
| Initial-navigation fields and helpers | `pr4/20261021_020941.jpg`, `20261021_021019.jpg`, `20261021_021039.jpg` |

The remaining local adaptations are explicit:

- `MockFileSystemApi` remains the provider, with complete mock bin behavior rather
  than the photographed mock stubs. The container retains its `projectId` and
  `projectLabel` inputs instead of destination project-overview dependencies.
- Access-enum imports now use the PR's `@api/model/folderNodeResponse` and
  `@api/model/fileNodeResponse` paths. Local definitions resolve through an alias
  outside `project-documents`; the destination uses its generated models directly.
- Popup imports and calls now match PR1. Local implementations resolve through
  aliases outside `project-documents`; see the dependency mapping below. There is
  no feature-specific dialog component or dialog state to remove during transfer.
- `transformPath` now matches PR1's `path.split('/')` / `segments.slice(3)` logic
  and its format comments. The extra `documentRootPath` input/binding and table
  call to `relativePathFromRoot` are removed. Mock deleted records use
  `sites/mock/{listKey}/remainingPath`; their private restoration snapshots retain
  the live mock paths and ids. The shared table adds no path/root validation.
- Existing functionality outside the photographed regions stays in place. Local
  lint requirements retain necessary line wrapping and scoped suppressions;
  this alignment does not apply a repository-wide formatter.

## Popup dependencies outside the copy boundary

Copying `src/app/project-documents/` preserves the PR's original imports:

```ts
import { PopupService, TRACE_ID_HEADER } from 'ibportal-web-ui-commons';
import {
    ConfirmationPopup,
    DEFAULT_CONFIRMATION_POPUP_DIALOG_CONFIG
} from '@shared/components/confirmation-popup/confirmation-popup';
```

The container injects `popupService` and uses the photographed `showPopup`
confirmation and `showErrorPopupWithReportAction` error options. Restore failures
read the HTTP response's message and trace-id header, use the PR's generic message
when those details are unavailable, and request escaped text. Confirmation runs
the delete operation only through `onAccept`.

| Import or setup | Local implementation | Destination |
| --- | --- | --- |
| `ibportal-web-ui-commons` | `tsconfig.json` maps to `src/local/ibportal-web-ui-commons/index.ts` | Existing package and its exported trace-id constant |
| `@shared/components/confirmation-popup/confirmation-popup` | `src/app/shared/components/confirmation-popup/` via `@shared/*` alias | Existing shared component and dialog config |
| Local popup providers | `project-documents-demo.ts` provides `DialogService` and `PopupService` | Existing application providers |

Keep these local aliases, library files, shared component, and demo host on this
machine. Copy only the feature directory into the destination's existing popup
setup; no popup imports, calls, or feature templates need changing. The earlier
`components/recycle-bin-dialogs/` component, its signals, and template wrapper have
been removed.

The local service implements the API subset used here with PrimeNG DynamicDialog.
Its error popup displays the trace ID and offers **Copy report details**. The
destination package retains its existing reporting action. The local
`TRACE_ID_HEADER` value is `X-Trace-Id`; the destination continues using its own
package's constant. No private package installation or reporting endpoint is
required for local development.

## Generated API imports outside the copy boundary

The node model, container, table, tree, navigation store, and mock helper use the
original access-enum import paths where needed:

```ts
import { FolderNodeResponseAccessLevelEnum } from '@api/model/folderNodeResponse';
import { FileNodeResponseAccessLevelEnum } from '@api/model/fileNodeResponse';
```

`tsconfig.json` maps `@api/*` to `src/local/api/*`. The corresponding
`model/folderNodeResponse.ts` and `model/fileNodeResponse.ts` files export the same
local access constants/types previously used by the mocks. Their names, values,
and permission behavior are preserved. The old feature-local
`models/document-access.model.ts` has been removed.

Leave `src/local/api/` and this local alias here when copying the feature. The
destination keeps its existing `@api` mapping and generated models, so the copied
imports resolve without editing. These local files implement only the exports
used by this feature; the existing SharePoint adapter/mapper transfer boundaries
below still apply.

## Transfer boundaries

- Keep the destination repository's generated Swagger services/models and working
  `services/file-system/sharepoint-file-system-api.ts`. The local adapter remains a
  compile-safe reference with unimplemented reads/recycle-bin operations; it is
  **not** a replacement for those existing backend integrations. No generated
  service files are required here.
- Keep the destination's `services/file-system/sharepoint-document.mapper.ts` and
  `sharepoint-error.mapper.ts`. The local document mapper contains stubs and the
  local error mapper is a reference; retain the destination's DTO mappings and
  backend error/reporting details.
- Port the three `FileSystemApi` bin signatures and corresponding store calls. As in
  the screenshots, `listGuid` is the bin folder id, and deleted-item `parentId` is
  that bin id. Deleted records have their own ids and retain original display paths.
- Keep the destination's generated access enums and DTO mapping. Feature imports
  already point to its `@api` model paths; preserve the existing returned values
  and actual wire representation. Local enum equivalents remain outside the
  copied directory.
- Keep the destination popup package, confirmation component, and reporting flow.
  Their import paths and method calls are already used by the feature; local
  equivalents live outside the copied directory.
- Keep destination providers, signing/dashboard/activity integrations and other
  files that do not exist in this standalone demo. Their photographed changes are
  outside the local feature's file tree. Review container imports/providers during
  transfer instead of overwriting the entire application configuration. Keep its
  shared `_colors.scss` as well.
- Copy the new icon asset as well as the feature source. Its source is Google's
  [Material outlined delete icon](https://raw.githubusercontent.com/google/material-design-icons/master/src/action/delete/materialiconsoutlined/24px.svg),
  from [material-design-icons](https://github.com/google/material-design-icons),
  licensed under [Apache 2.0](https://github.com/google/material-design-icons/blob/master/LICENSE).
  The original SVG is saved as `src/assets/icons/sharepoint-file-type-icons/recyclebin.svg`.
- Initial folder links require Angular Router, as in the screenshots. The local
  demo already provides it. Once a valid link is attempted, query cleanup clears
  all parameters using `replaceUrl`; default root initialization remains the first
  history entry.

## Local review

The demo protects `/execution/Contracts` from rename/delete and makes
`/marketing/Press` read-only. Configure `MOCK_CONFIG.readonlyListKeys` for a complete
read-only list. Missing access fields mean writable access. These flags simulate
backend decisions; this UI does not infer roles.

Delete a normal folder/file, then select its list's Recycle Bin in the tree. Restore
recovers its original ids and nested contents; revisit the original location to
refresh its listing. Delete in the bin opens the permanent-delete confirmation.
The mock resets on refresh. Deleted records are list-isolated and excluded from search.

Example initial link:
`/?listKey=execution&folderPath=%2Fexecution%2FContracts`.
Both query parameters are required; the path uses the same full-path representation
as the list root. Missing/empty parameters or an unrecognized `listKey` are ignored
and leave the URL unchanged. A recognized list key is matched case-insensitively;
after the navigation attempt, all query parameters are cleared on success or
failure. This follows PR4, including its invalid-key behavior. Bin path display
uses PR1's fixed three-segment removal. Only mock bin records receive the
`sites/mock/` prefix; live mock paths and initial links remain `/execution/...`
or `/marketing/...`. Existing search and PR4 initial-link uses of
`relativePathFromRoot` remain unchanged.

## Deliberately preserved follow-up items

The user selected exact PR behavior instead of additional permission fixes:

- `onItemDoubleClicked` returns immediately whenever the current folder is a bin.
  This deliberately also prevents the tree's Open Folder context action from
  opening ordinary folders while a bin is displayed. Do not replace the broad
  guard with a narrower one during this synchronization.
- Protected folder search results still use the readonly/locked branch rather than
  the normal protected-folder rename/delete rule.
- Row/tree dragover rejects forbidden targets, while their actual drop handlers
  retain the original forwarding behavior. Blank-current-folder drops are guarded.
- Paste checks target folder access and current-folder access; it does not separately
  check the target list when pasting into another tree section.
- Bin mutations remove records after success; restored nodes/parent metadata refresh
  on subsequent navigation. No optimistic restoration or mutation retry was added.

These UI rules do not replace backend authorization. Internal drag-and-drop is a
separate next task; its implementation has not been added during this sync.

## Verification (2026-10-22)

- Repeated after reverting the extra path formatter and guard removal. The table
  fixture uses the PR's path representation without a document-root input. Added
  workflow checks that the broad guard leaves tree Open Folder inactive while
  viewing a bin and ignores a deleted-file activation emitted to the container.
  Existing integration checks cover the actual local popup service: delete on
  confirm, no delete on cancel, HTTP error message escaping and trace-id
  propagation, and generic non-HTTP restore failures. The initial-link spec checks
  that an invalid list key leaves the default folder and URL unchanged, matching PR4.
- Headless Chrome 147 / Karma: **144 of 144 tests passed**, including the mock
  roundtrip/failure/list-isolation cases, store pessimism, tree drop affordances,
  destination-list menus, initial links, permanent-delete confirmation, and escaped
  restore-error text.
- Production build passes. It reports the existing
  warning thresholds: initial bundle 514.37 kB against 500 kB and container styles
  4.52 kB against 4 kB; neither reaches the error threshold.
- App/spec TypeScript checks and `git diff --check` pass. Lint has no errors and
  retains the two existing path-bar accessibility warnings.
- Karma uses a temporary launcher config (`/tmp/x36-karma.cjs`) with the cached
  Chrome binary and runtime libraries extracted under `/tmp/x36-browser-deps`. No
  package dependencies, lockfile, or system packages were changed. Karma reports
  a test-server font URL 404; font rendering was not visually verified.
- Real SharePoint integration and manual Edge/Chrome acceptance remain destination
  checks. The automated suite exercises the local mock, not those generated clients.
