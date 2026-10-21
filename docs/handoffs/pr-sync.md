# PR synchronization

Applied on `sync/pr-changes` from the photographed diffs in
`tmp-screenshots/pr1` through `pr4`. The user confirmed these were the complete set
and chose the PR behavior, local mocks, local popup equivalents, and a Google SVG.

| Screenshots | Work represented | Local implementation |
| --- | --- | --- |
| PR1 / #110 / CFO-11531 | Recycle bin | Node flag, API methods, mock deleted-subtree snapshots, store routing/writes, tree icon/leaf, deleted metadata table, Restore/Delete menus, confirmation and restore-error dialogs |
| PR2 / CFO-12015 | Default-folder access | Optional node access flags; protected/readonly menu rules, toolbar/paste and external-drop affordances |
| PR3 / #152 / CFO-11535 + CFO-12146 | List access | Root `isListReadonly`, navigation map, target-list folder/tree rules, read-only bin actions and search disabled in bins |
| PR4 / CFO-12253 | Initial navigation | Execution first in tree/default navigation; initial `listKey` + `folderPath` query resolution and query cleanup |

## Transfer boundaries

- Keep the destination repository's generated Swagger services/models and working
  `SharePointFileSystemApi`. The local adapter remains a compile-safe reference with
  unimplemented reads/recycle-bin operations; it is **not** a replacement for those
  existing backend integrations. No generated service files are required here.
- Port the three `FileSystemApi` bin signatures and corresponding store calls. As in
  the screenshots, `listGuid` is the bin folder id, and deleted-item `parentId` is
  that bin id. Deleted records have their own ids and retain original display paths.
- Local `models/document-access.model.ts` supplies symbolic `Readonly`/`Protected`
  equivalents. In the destination, use its generated access enums and DTO mapping;
  preserve the existing returned values and actual wire representation.
- `RecycleBinDialogs` replaces the unavailable shared popup dependency here. Keep
  the destination popup service if desired, wiring the same cancel/confirm and
  restore-failure flows. Backend trace-id reporting remains owned by that service;
  there is no invented report endpoint in this local implementation.
- Keep destination providers, signing/dashboard/activity integrations and other
  files that do not exist in this standalone demo. Their photographed changes are
  outside the local feature's file tree. Review container imports/providers during
  transfer instead of overwriting the entire application configuration.
- Copy the new icon asset as well as the feature source. Its source is Google's
  [Material outlined delete icon](https://raw.githubusercontent.com/google/material-design-icons/master/src/action/delete/materialiconsoutlined/24px.svg),
  from [material-design-icons](https://github.com/google/material-design-icons),
  licensed under [Apache 2.0](https://github.com/google/material-design-icons/blob/master/LICENSE).
  The original SVG is saved as `src/assets/icons/sharepoint-file-type-icons/recyclebin.svg`.
- Initial folder links require Angular Router, as in the screenshots. The local
  demo already provides it. Query cleanup clears all parameters using `replaceUrl`;
  default root initialization remains the first history entry.

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
as the list root. Recycle-bin display paths use that root to support both the local
`/execution` paths and the destination's longer SharePoint paths.

## Deliberately preserved follow-up items

The user selected exact PR behavior instead of additional permission fixes:

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

## Verification (2026-10-21)

- Headless Chrome 147 / Karma: **140 of 140 tests passed**, including the mock
  roundtrip/failure/list-isolation cases, store pessimism, tree drop affordances,
  destination-list menus, initial links, permanent-delete confirmation, and escaped
  restore-error text.
- Development and production builds pass. Production reports the existing
  warning thresholds: initial bundle 511.55 kB against 500 kB and container styles
  4.52 kB against 4 kB; neither reaches the error threshold.
- App/spec TypeScript checks and `git diff --check` pass. Lint has no errors and
  retains the two existing path-bar accessibility warnings.
- Karma uses a temporary launcher config (`/tmp/x36-karma.cjs`) with the cached
  Chrome binary and runtime libraries extracted under `/tmp/x36-browser-deps`. No
  package dependencies, lockfile, or system packages were changed. Karma reports
  a test-server font URL 404; font rendering was not visually verified.
- Real SharePoint integration and manual Edge/Chrome acceptance remain destination
  checks. The automated suite exercises the local mock, not those generated clients.
