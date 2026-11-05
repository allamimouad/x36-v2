# Angular 20 File Manager — Specification

> **For the LLM reading this**: This is one of three files. Always read all three before writing code:
> - `SPEC.md` (this file) — what to build
> - `PHASES.md` — implementation plan, phase by phase
> - `PROGRESS.md` — current status, what's done, what's next
>
> **Before starting any work**: read `PROGRESS.md` to see which phase is active.
> **Before ending your session**: update `PROGRESS.md` with what you completed, what you deferred, and what the next session should pick up.
> **Authorized scope update (2026-10-21):** the four PRs are synchronized locally, including recycle bin, backend-supplied access rules, and initial folder links. This explicitly extends the original scope; internal drag-and-drop was deferred until the separate authorization below. See `handoffs/pr-sync.md`.
> **Additional PR (2026-10-22):** PR5 names the routed project input `id` and
> replaces the container's `projectLabel` input with a writable signal initialized
> to `''`. Immediately after `observeReadErrors()`, the constructor effect sets it
> from `projectOverviewService.projectDTO()?.name ?? ''`. The local overview service
> and its demo provider live outside the copied feature; the destination keeps
> its existing service and provider.
> **PR fidelity constraint (2026-10-22):** apply the supplied PR behavior without
> additional bug fixes. Restore the original `slice(3)` bin path formatter and
> broad current-bin activation guard. Preserve existing limitations, including
> tree Open Folder doing nothing while a recycle bin is displayed. Any proposed
> bug fixes require a separate, explicit task after synchronization is reviewed.
>
> **Internal drag authorization (2026-10-23):** implement single-item native file/folder
> move and Ctrl-copy on `feat/internal-drag-drop`, using the existing store/API
> contract. Tree nodes, table folder rows, and unused table space are targets.
> Search-result sources, multi-selection, cut, and new backend endpoints remain
> deferred. See `handoffs/internal-drag-drop.md` for behavior and backend follow-up.
>
> **Never implement features from a future phase.** If you notice something needed later, note it in `PROGRESS.md` under "Deferred" and move on.
> **Git publishing rule**: commit and push to `main` by default. Create or use another
> branch only when the user explicitly asks for one.

---

## 1. Tech Stack (non-negotiable)

- **Angular 20** (standalone components, no `NgModule`)
- **TypeScript strict mode**
- **PrimeNG** (latest Angular-20-compatible version)
- **Material Symbols (Outlined)** via the self-hosted `material-symbols` npm package for all UI icons (no PrimeIcons; the target env is on-prem, so no CDN fonts), rendered as **raw ligature spans** (`<span class="material-symbols-outlined" aria-hidden="true">refresh</span>`) — the target repo's convention, no wrapper component. Each usage site styles its own class (font-size, `line-height: 1`, `user-select: none`). The only exception is the target environment's file-type icon set (`FileSystemIcon`, SVG assets)
- **Typography: "BNPP Type"** — declared once on the `ProjectDocuments` host (`:host` in project-documents.scss) with system-font fallbacks, so the feature carries its own typeface wherever it is embedded; all children inherit (`font: inherit` where a form-control reset is needed). No other component may declare a text font family (the `material-symbols-outlined` icon-font class is the only exception). Caveat: overlays attached to `body` (tooltips, context menus, dialogs, and the breadcrumb overflow `p-menu`) inherit the page font, not the host's — the embedding app is expected to set the same font globally
- **@ngrx/signals** (NgRx Signal Store) for state management
- **RxJS** for the `FileSystemApi` contract (every method returns `Observable`, matching the HttpClient-native SharePoint adapter), plus HTTP and `rxMethod`. Stores that prefer async/await bridge with `firstValueFrom` at the call site.
- **Angular Signals** API throughout: `signal()`, `computed()`, `effect()`, `input()`, `output()`, `model()`
- **File System Access API** for folder selection in secure-context Microsoft Edge /
  Google Chrome; `@types/wicg-file-system-access` is type-only and no runtime picker
  library is used
- **New control flow**: `@if`, `@for`, `@switch`, `@let`
- **`inject()`** everywhere — no constructor injection
- **`ChangeDetectionStrategy.OnPush`** on every component

---

## 2. Architectural Principles (read before writing any code)

### 2.1 Dumb components
Child components (`FolderTree`, `FileTable`, `PathBar`, `NavToolbar`, `UploadPanel`, dialogs) **MUST NOT inject stores**. They receive state via `input()` signals and emit via `output()`. Only the container (`ProjectDocuments`) and services wire stores to children. This is a hard rule.

### 2.2 Backend-agnostic via `FileSystemApi`
Stores **MUST NOT know about SharePoint**. They depend on an abstract `FileSystemApi` class. Two implementations exist:
- `MockFileSystemApi` — in-memory, used for dev and tests (default provider)
- `SharePointFileSystemApi` — upload implemented as a compile-safe HTTP reference;
  remaining operations are stubbed until backend-client integration

`services/mock/` contains the mock/dev backend and unit-test double (`mock-file-system-api.ts`, `mock-seed.ts`, `mock-config.token.ts`). It is used by the default local `ProjectDocuments` provider until the SharePoint laptop swaps that provider to `SharePointFileSystemApi` — after which the directory (plus the two store specs, if tests aren't kept) can be deleted in one go. (Named `mock`, not `testing`: the target repo's `eslint-plugin-boundaries` config classifies `testing` folders as shared test utilities forbidden from importing feature code.)

The interface uses generic terminology (`projectId`, `listKey`, `id`, `path`, `name`) — no SharePoint-specific terms like `serverRelativeUrl` leak out. A project has **two document lists**, selected by the domain `listKey` (`'EXECUTION' | 'MARKETING'`); the frontend deliberately uses the same uppercase values as the backend contract. The lists may live on the same SharePoint site or on different sites. `id` is a stable, opaque UUID for the entity's lifetime within its list context. `path` is the mutable, human-readable backend path. In the mock, `id` is a `crypto.randomUUID()` value; in the SharePoint adapter, `id = UniqueId` and `path = ServerRelativeUrl`. Every node carries its domain `listKey`, allowing the adapter to resolve `(projectId, listKey)` to the correct backend-owned site/library configuration without exposing that configuration to the frontend. Retrieval is split: `listDocumentRoot(projectId, listKey)` returns a list's root, and `listDocuments(projectId, parent)` returns a folder's direct children; the adapter extracts `parent.listKey` and `parent.id` for the list-scoped backend route. Root-list load status is handled per list: a loaded root renders; a `not-found` root is hidden; any other root-load error does not discard the other loaded list. If both roots are `not-found`, the table area shows "No documents found for this project." Mutations take full `FolderNode` / `FileSystemNode` arguments. List-scoped adapters obtain their routing context from the nodes; copy is the exception and maps the nodes to complete source/destination server-relative parent paths while also sending the destination domain `listKey` needed on the returned node. It sends no source list key. Address-bar labels remain lowercase and parsing is case-insensitive. No internal id↔url mapping cache.

### 2.3 Signal Store for entities, plain signals for simple state
`FileSystemStore` uses `withEntities` because folders and files are viewed in multiple places (tree + table) and must stay in sync. `NavigationStore` uses Signal Store because it owns navigation history, expansion, focus, selection, rename state, and file-system-derived computeds. Small command-style state uses plain signal services; `ClipboardService` is a plain injectable service with `signal()` / `computed()`, not a Signal Store. Simple component-local state stays as plain `signal()` inside the component — don't over-store.

### 2.4 Pessimistic writes
All mutations wait for the API result before touching the store — no optimistic apply,
no rollback. Reason: the SharePoint backend is both slow (network + backend round-trips) and
fallible (throttling, token expiry, permission, name collision). Optimistic apply would
show a state that does not exist yet and flicker the item away on rollback.

We **apply exactly what the server returns for the affected node**, and never fabricate the
**opaque, server-owned metadata** we cannot derive: `modifiedAt`, `modifiedBy`, and any
server-resolved name. Two things the store *does* maintain locally — not as guesses, but as
**confirmed cache maintenance** (deterministic consequences of a write the server already
acknowledged): the direct parent's `itemCount` (±1 per confirmed create/delete/move), and the
repathing of already-cached descendants after a folder **rename** (their paths derive
deterministically from `parentPath + name`). **Move** does *not* repath — it is
replace-on-success: it drops the moved node's cached subtree and inserts only the
server-returned node (collapsed/unloaded), so stale descendants are refetched on expand
rather than carried forward (see §10). We do **not** touch a parent's timestamps when
adjusting its count; stale parent `modifiedAt`/`modifiedBy` self-heal on the next revalidating
load.
- Single create/rename/move/delete/copy: await the API call, then apply the result.
- Bulk ops (multi-select): show progress, apply per-item as each succeeds, summarize errors at end.
- Uploads: always progress-based, update store on completion.

The UI must signal an in-flight write (spinner / disabled affordance) so the wait does not
feel like a missed click; this is wired into the dialogs/context-menu actions when they land.

### 2.5 Component-level providers
All stores and services specific to the file manager are provided on `ProjectDocuments`, not `providedIn: 'root'`. State dies with the component.

### 2.6 Portable, plan-free source
The `src/app/project-documents/` folder will be copied verbatim to another machine and pushed to a different repository (with the SharePoint adapter swapped in for the mock). Therefore **no file under `src/app/project-documents/` may reference the internal planning workflow**: no "Phase N" in comments, tooltips, error messages, or identifiers, and no pointers to `SPEC.md` / `PHASES.md` / `PROGRESS.md`. **The same applies to the cross-repo copy workflow itself**: no comments about a "target repo", "the other laptop", files being "copied", "swapped", or "deleted later", or code being "dev-only" / a "stand-in" for that reason — the copied source must read as if it always lived in its destination. Migration instructions live only in `docs/` (PHASES Phase 6). Not-yet-built functionality is worded neutrally ("not available yet", "not implemented yet"). Phase references live only in `docs/`. `TODO` comments are allowed and mark every unimplemented feature, but must be short one-liners referencing the feature / user story that will implement it (e.g. `// TODO: implement with the upload US.`) — never a phase.

When synchronizing the photographed PRs, preserve their variable names,
declaration/property order, helper placement, and template structure wherever
visible. Keep required local adaptations documented in `handoffs/pr-sync.md` so
the common code remains easy to compare with the destination.

Unavailable popup and generated API dependencies use the PR's original
package/shared/`@api` import paths.
Local equivalents, alias configuration, and demo providers live outside
`src/app/project-documents/`, allowing the copied feature to use the destination's
existing popup implementation and generated models without changing those imports.

---

## 3. Feature Requirements

### 3.1 Layout

- **Left pane**: folder tree (folders only, no files), Execution above Marketing; each list has a recycle-bin leaf sorted after ordinary folders
- **Right pane**: contents of the currently-open folder (folders + files)
- **Top bar**: back / forward / up buttons, clickable breadcrumb path, action buttons (new folder, upload), search input
- **Bottom status bar**: selection count, current folder item count
- **Upload panel**: floating bottom-right, collapsible, only visible when uploads exist

### 3.2 Core operations

- Create folder server-first with the default name `New folder`, then immediately enter inline rename
- Rename folders inline from the table/tree; rename files inline from the context
  menu. A file rename input shows only the editable basename; its existing
  extension is hidden during editing and restored in the complete name sent to the API.
- Execution and marketing roots load independently. When at least one root is available,
  a missing or failed companion root stays hidden and does not raise a user notification.
- Delete folder or file (single-item confirmation is inline on the initiating table/tree
  surface; bulk confirmation remains bulk-aware)
- Move / copy (drag-and-drop, or cut/copy/paste)
- Upload files or a complete local folder tree through the Upload menu or an external
  OS drag
- Navigate into folder

### 3.3 Navigation

- Initially open Execution when available, otherwise Marketing.
- Optional URL query parameters `listKey` (case-insensitive) and `folderPath` (full backend path) resolve a folder after default initialization. Both must be non-empty and the list key must be recognized; otherwise ignore the link and retain the query parameters. Once a recognized link is attempted, clear all query parameters with `replaceUrl` on success or failure; default navigation stays in history.
- **Double-click a folder on the right** → opens that folder
- **Double-click a file on the right** → opens it in its online application
- **Single-click a folder on the tree** → opens that folder
- **Current folder is highlighted in the tree** whenever visible there
- **Back / forward / up** like browser history:
  - Back: previous folder in history (not necessarily parent)
  - Forward: undoes Back
  - Up: navigates to parent (truncates forward history, same as a fresh nav)
- **Breadcrumb path is fully clickable**: clicking any segment navigates there
- Entering a folder always obtains a fresh listing: direct folder navigation loads its
  children, path resolution returns the target listing, Back/Forward revalidates a
  restored folder, and restoring a search reruns its scope/query.
- `canGoBack`, `canGoForward`, `canGoUp` are `computed` signals; buttons disable via signal inputs

### 3.4 Drag-and-drop — full matrix

The authorized single-item scenarios are implemented below; multi-selection remains deferred:

| # | Source | Target | Result | Guard |
|---|--------|--------|--------|-------|
| 1 | Tree (folder) | Right pane (folder row) | Move source into target | Descendant guard |
| 2 | Tree (folder) | Right pane (empty area) | Move source into *currently open* folder | Descendant guard |
| 3 | Tree (folder) | Tree (folder node) | Move source under target | Descendant guard |
| 4 | Right pane (folder or file) | Tree (folder node) | Move item into target | Self/descendant guard |
| 5 | Right pane (folder or file) | Right pane (folder row) | Move item into target | No self-drop |
| 6 | Right-pane multi-selection | Any folder | Deferred | Not part of current authorization |
| 6a | Right pane (folder or file) | Unused right-pane space | Ctrl-copy into current folder | Same-parent move is rejected |
| 7 | External OS files/folders | Right pane (folder row) | Upload into that folder | — |

**The descendant guard is frontend-only, by necessity.** It lives in one place,
`pathContainsOrEquals` (`utils/node-containment.utils.ts`), used by `containsNode`'s
path fallback, `FileSystemStore.targetsOwnSubtree` and
`ProjectDocuments.isNodeAncestorOrSelf`. It is **case-insensitive**, because SharePoint
addresses the same folder as `/Contracts` or `/contracts`; the trailing slash in the
prefix test is what keeps `/Contracts2` from reading as a child of `/Contracts`. Only the
comparison is normalized — a stored path is never rewritten.

It cannot be delegated to the backend: the real API answers a descendant copy with a
generic **HTTP 500** and creates nothing (verified 2026-11-05). That is safe but carries
no descendant signal, so nothing in the response can be mapped to `descendant-move`, and
mapping a 500 to it would relabel every server-side copy failure. See `docs/TODO.md`
item 6.
| 8 | External OS files/folders | Unused right-pane space below rows | Upload to current folder | — |
| 9 | External OS files/folders | Tree folder node | Upload into that folder | — |

**Modifiers**:
- Internal default drop = **move**
- Hold **Ctrl** during an internal drop = **copy**
- External OS drops are always uploads (`copy` cursor); modifiers do not change them
- **Escape** during drag = cancel
- Cursor reflects effect (`move` / `copy` / `no-drop`)

**Visual feedback**:
- Valid target: folder row/node highlights
- Invalid: `cursor: no-drop`, no highlight
- Current-folder target: the complete unused space below the rendered rows becomes a
  dashed drop zone during an internal or external drag. If rows fill the pane, it keeps a usable
  minimum height at the bottom; the table/header/file rows do not become the target.

### 3.5 Right-click context menus

- **Folder** (tree or right pane): Open Folder; separator; Rename Folder, Copy Folder, Paste, Delete Folder; separator; Upload within folder → Folder / File
- **File**: Open File in → Local application / Online Application; separator; Rename File, Copy File, Delete File; separator; Download File
- **Right-pane empty area**: Create new Folder; separator; Paste; Upload → Folder / File
- Nested menus open on hover. Paste is a direct command, not a submenu.
- Root folders cannot be renamed or deleted. Actions whose workflows are not implemented yet remain visible but disabled, preserving the final menu structure.
- File actions consume backend-provided `onlineUrl`, `desktopUrl`, and `downloadUrl`
  capabilities. A missing or unsafe link disables only its corresponding action.
- The header's `View in SharePoint (web)` action consumes the current folder's
  backend-provided `webUrl`. It opens the exact current folder and is disabled when
  the URL is missing or unsafe.
- Online opens in a new browser tab; Local application launches an allow-listed
  Microsoft Office URI; Download navigates directly to SharePoint without Angular or
  the application backend relaying the file bytes.

### 3.6 Cut / copy / paste clipboard

- Clipboard: `{ ids: ReadonlySet<string>, mode: 'cut' | 'copy' | null }` in `ClipboardService`
- Cut items render at 50% opacity until pasted or cleared
- Paste cut into same folder: no-op (silent)
- Copy/paste supports destinations in either document list of the current project,
  including when Execution and Marketing resolve to different SharePoint sites.
- Paste copy always keeps both through the backend's canonical collision handling; the
  frontend neither predicts the final name nor prompts for one
- On successful move after cut: clear clipboard

### 3.7 Multi-select (both tables)

Implemented 2026-10-28 for the right-pane table, extended to the search table
2026-11-05. The tree is single-item throughout; the recycle bin does not take part.

- **Click** replaces the selection and becomes the anchor.
- **Ctrl/Cmd+click** toggles one row and moves the anchor to it.
- **Shift+click** selects from the anchor to the clicked row, in the order the rows are
  currently rendered, and leaves the anchor where it is so a further Shift-click
  re-extends from the same row.
- Clicking the space below the rows, changing the viewed folder, or Escape clears it,
  **including the focused row** — those gestures mean nothing is chosen.
- Enter/Space on a focused row selects it, matching a plain click.

Focus and selection are **separate affordances and must look it**. Selection is a
background fill; focus is an inset accent edge. They shared one background until
2026-11-05, and because every row click focuses, a row that had just been
Ctrl-click-deselected still read as selected — the state was right, only the paint was
wrong. The same shared colour made a recycle-bin row look selected, though bins only
ever focus.

**Any change of view starts with a fresh selection**, with no exceptions — a folder
navigation, Back/Forward, Up, a typed path, a project load, and **entering or leaving a
search**. It is enforced in one place, `_clearedSelection()`, which returns a new `Set`
each call so two patches cannot share one instance. Reloading the *current* folder is
not a change of view and deliberately keeps the selection.

**The search table has the same selection**, with two deliberate differences:
Enter/Space opens a result rather than selecting it, and Paste is not offered there
because that surface has no target folder.

Both tables resolve a click through one shared `resolveSelection` (`utils/selection.
utils.ts`), each passing its own table's rendered ids so a Shift-range follows the
current sort.

Extending selection to search took widening how a selection is turned back into nodes.
A search hit is **never** cached — results come from the search endpoint and nothing
inserts them into `FileSystemStore`, deliberately, because `currentFolderChildren`
derives a folder's contents from whatever entity claims it as a parent and would then
present a partial listing as a complete one. Both places that resolved a selection
through the cache therefore fall back to the surface's own rows: `selectedNodes` reads
the search results, and a drag carries `selectedNodes` alongside `selectedIds`. A
selection naming something **neither** source knows is still refused outright — stale is
not the same as uncached.

A search selection may span document lists, since one result set can. The consequence is
asymmetric and accepted: the context-menu **Delete works** across lists, each item going
to its own list's bin, while **dragging a mixed set onto a bin is refused as a whole**,
because the bin policy requires a matching list and drag validation is set-wide.

Selection is **not** wired through PrimeNG's `selectionMode="multiple"`. The rows own
native drag listeners whose propagation is deliberately stopped before PrimeNG's own
handlers, and a Shift-range has to follow the rendered order, which column sorting
changes. The table therefore resolves the whole next selection itself and reports it;
the store only stores it.

**A bulk selection collapses to top-most ancestors**, exactly as a drag always has
(`topMostNodes`). Only a search can put a folder and something inside it in the same
selection — the right-pane table lists one folder's children, so its rows are always
siblings. Acting on both would pull the child out of the folder it is travelling with on
a cut, duplicate it on a copy, and delete it twice. Collapsing happens in
`selectedNodes`, not inside the batch runner, so each caller's own count and confirmation
text describe what will actually run (which is why the delete dialog needs a singular
form: collapsing two rows can leave one).

**A search selection never outlives its rows.** A re-query can drop a row that was
selected — renaming it so it stops matching is the easiest way, but any refresh can — and
the node behind it may still be cached, so a bulk action or drag could reach something
invisible. Two things prevent it: the container reconciles the selection against the
current result ids, and `selectedNodes` resolves from the **active surface only** (search
results while searching, the cache otherwise) rather than merging both, which makes a
hidden row unresolvable rather than merely absent. The search surface likewise reports
only the ids it is showing when a drag starts.

Drives drag-and-drop of several items, plus bulk delete, copy and cut (2026-11-03).
Delete and Copy/Cut act on the whole selection; **Rename stays single-item**, since
renaming many at once means nothing, and is the only action still disabled on a
multi-selection.

Deleting a selection asks once in the shared `ConfirmationPopup` ("delete 5 items?");
a single delete keeps its inline row buttons. Cut is move underneath, so it inherits
the same rules as a drag move. Paste accepts any number of items and both clipboard
modes; a cut clipboard is spent once pasted, a copy one survives for another paste.
Cut rows render at 50% opacity until the paste lands. A paste is rejected as a whole
if any item would land inside itself, and opens the destination when the move carried
off the folder being viewed.

**Search results are reconciled by re-running the search after a mutation, with an
instant local touch-up first** (revised 2026-11-04). Every mutation prunes the rows it
removed by id, and a rename corrects its own row, so what the user acted on responds
immediately. Everything a mutation implies beyond that — uncached descendants of a
deleted folder, paths beneath a renamed one — is left to
`DocumentSearchService.refresh`, which re-runs the last submitted search.

The refresh deliberately **keeps the current rows on screen** until the response lands:
clearing them, as a user-submitted search does, would replace one stale row with an
empty table for as long as the query takes. That takes two things, and the service can
only do one of them — it keeps its results array, while `isRefreshing` is what stops the
view swapping the table for its loading state. A submitted search sets `isSearching`
alone and may replace the table; a refresh sets both, and the view shows a non-blocking
"Updating results…" line above the live rows.

Every path that mutates reconciles, including a **copy**, which removes nothing and so
prunes no ids: a copy made inside the searched scope is a new match. Drag-copy and
paste-copy go through the same completion path for exactly that reason.

`clear` **forgets** the submitted search as well as unsubscribing. It runs on every
navigation away from a search, so a retained query would let a later mutation's refresh
re-run a search the user has left — against the previous project, since the service
outlives one project — and the revived `activeQuery`/`activeScopeId` would make the
container's `alreadyLoaded` check skip the next real search and show those rows.

An earlier version maintained the list entirely locally, matching descendants by path
prefix; that is removed. Re-querying costs a request but is correct about descendants
and paths by construction, where the local version produced four separate defects.

Bulk download is deliberately absent: there is no zip endpoint, so it would mean one
browser download per file.

### 3.9 Upload with progress

- Toolbar, empty-area, and folder context menus expose Folder / File choices
- File selection uses a standard multi-file picker
- Folder selection uses `showDirectoryPicker()` and selects one root per action
- External desktop drops accept multiple top-level files and folders. A hovered
  right-pane/tree folder is the destination; otherwise the right pane targets the
  currently open folder only through the flexible unused space below the table rows.
  Folder rows and tree labels own their native drag/drop listeners and call
  `preventDefault()` on valid external targets; this avoids losing the drop through
  PrimeNG event handling.
  Header/file rows are not upload targets. Only `DataTransfer` payloads containing
  files are intercepted, keeping external upload separate from future internal
  move/copy drag state.
- Dropped folders use `DataTransferItem.getAsFileSystemHandle()` when available and
  fall back to the legacy File and Directory Entries API. Legacy readers are drained
  until an empty batch so folders with more than 100 immediate children are not
  truncated.
- Folder upload first traverses the complete local tree, then creates the selected root
  with the backend's unique-name behavior and creates every descendant directory
  parent-first, including empty directories; files start only after directory creation
  succeeds
- **Upload panel**: floating bottom-right, collapsible, shows folder preparation plus
  active / queued / completed per-file work. When several top-level folders are
  selected or dropped, every folder appears immediately; one folder tree at a time is
  traversed and created, while the remaining folder batches are visibly queued
- Per-file progress bar, best-effort cancel while browser-to-backend transfer is below
  100%, and manual retry for network failures or cancelled files; retry always restarts
  from byte zero. At 100% the task enters finalization and Cancel is disabled because
  SharePoint may already have committed the file; completion is shown only after the
  backend returns the canonical created file.
- **Concurrency limits**: one folder-tree preparation/creation chain and 4 simultaneous
  file uploads
- File collisions fail safely with `overwrite=false`; they are not automatically retried
- Folder preparation and task state are in-memory only; no upload session, database row,
  chunk protocol, or refresh resume is introduced
- The frontend and streaming backend accept one bounded raw-body request per file up
  to the configurable 250 MiB limit without changing the endpoint

### 3.10 Recursive name search

- Search is scoped to the currently open folder and its descendants in that folder's
  one document list. Searching a list root therefore covers the complete list.
- Match file and folder **names only**, case-insensitively; never search file contents.
- Submit on Enter with a non-empty trimmed query, including one-character names. Do not
  issue a request for every keyboard event.
- Every result uses the normal canonical `FolderNode` or `FileNode` model. Search omits
  the expensive optional `itemCount`/`sizeBytes` metadata, but preserves identity,
  paths, timestamps, editor, and operation capabilities. The frontend derives
  address-bar navigation paths from the node's canonical `path` and the already-loaded
  list-root `path`.
- Double-clicking/pressing Enter on a folder result opens that folder. The same action
  on a file opens its online application. Single-click does not navigate; locating a
  file is an explicit `Open File Location` action in its context menu.
- Folder and search screens are distinct navigation-history entries. Opening a result
  adds its folder screen; Back restores the search scope/query and reruns it instead of
  retaining stale results. Resubmitting while already on a search screen replaces that
  entry's query rather than adding another history position.
- Clearing the input exits to the preceding folder entry. Navigating independently to
  another folder adds a normal folder entry and clears the temporary search results.
- Search results reuse normal item operations: folder open/rename/copy/delete and file
  location/open/rename/copy/delete/download. Rename and delete confirmation remain inline.
- Copy retains the complete source node in `ClipboardService`; Paste prefers a newer
  cached version when present and otherwise uses that retained node.
- Search results never enter `FileSystemStore`. Only activating a result may update the
  store through path resolution. Successful rename/delete updates the cache only when
  the target is already cached; Copy inserts its returned node only when the destination
  is cached. The active search reruns after rename/delete.

---

### 3.11 Recycle bin and backend-supplied access

- Every folder carries `isRecycleBin`; the virtual bin appears only in the tree, as
  a leaf. Deleted folders never expand into that tree. Ordinary table counts exclude
  the virtual bin.
- A bin view lists full File Name, Path (project/list/original relative path), Deleted,
  Deleted By, and Size, initially newest deletion first. Empty text is
  "The recycle bin is empty." Search, create, upload, empty-area context menus,
  double-click navigation, and ordinary table editing/drop targets are unavailable.
  Keep the PR's `transformPath`: split the path on `/`, remove the first three
  segments with `slice(3)`, and prefix the lowercase list key. Its expected input
  is `sites/{siteName}/{listName}/remainingPath`; do not add a root-path input or
  validate the path against the loaded root in this table. Mock bin records use
  `sites/mock/{listKey}/remainingPath` to exercise this same formatter.
  Keep the broad `onItemDoubleClicked` early return whenever the current folder
  is a recycle bin, including its effect on ordinary tree Open Folder actions.
- Deleted-item context menus expose Restore and Delete. Restore reports success or
  an escaped error dialog. Permanent Delete requires a modal Cancel/Confirm step.
  Use `PopupService` and `TRACE_ID_HEADER` from `ibportal-web-ui-commons`, and
  `ConfirmationPopup` with `DEFAULT_CONFIRMATION_POPUP_DIALOG_CONFIG` from
  `@shared/components/confirmation-popup/confirmation-popup`, matching PR1.
  Confirmation uses `showPopup` with an `onAccept` callback; restore errors use
  `showErrorPopupWithReportAction` with the HTTP message/trace ID or the PR's
  generic fallback message. Local implementations live outside the feature.
  Both writes remove the bin record from cache only after API success; restored
  contents appear when their original location is next loaded.
- `accessLevel` is optional. Folder `Protected` disables rename/delete while keeping
  contents writable; `Readonly` disables rename/delete and upload within the folder.
  File `Readonly`, or a read-only current folder, disables file rename/delete.
  Copy/open/download retain their existing rules.
  Import `FolderNodeResponseAccessLevelEnum` from `@api/model/folderNodeResponse`
  and `FileNodeResponseAccessLevelEnum` from `@api/model/fileNodeResponse`, as in
  the PR. Local equivalents resolve to `src/local/api/` through the local alias;
  the destination keeps its generated definitions.
- Root listing `isListReadonly` feeds a map keyed by document list. Current-folder
  access combines its own flag and its list flag. Folder context menus and tree
  dragover use the destination folder's list; file menus use the current folder.
  Bin Restore/Delete are disabled for a read-only current list.
- Current-folder read-only state disables create/upload, empty-area writes, paste,
  and blank-space dragover/drop. Paste also checks the target's own access flag.
  Row-folder dragover checks own/current-folder access; tree dragover checks own/list
  access and excludes recycle bins.
- This synchronization preserves the reviewed PR behavior, including gaps in
  protected search-result actions, actual row/tree drop handlers, and target-list
  paste checks. These are recorded in the handoff for separate follow-up; backend
  authorization remains required.

---

## 4. Data Models

```ts
// models/file-system-node.model.ts

export type FileSystemNode = FolderNode | FileNode;

export interface FolderNode {
  kind: 'folder';
  isRecycleBin: boolean;
  accessLevel?: FolderNodeResponseAccessLevelEnum;
  listKey: DocumentListKey; // domain list/site routing context
  id: string;              // stable, opaque UUID (SharePoint UniqueId); never the path
  path: string;            // full path from root, e.g. "/Documents/Reports/2026"
  name: string;
  parentId: string | null; // null for root
  itemCount?: number;       // omitted by lightweight recursive search
  createdAt?: string;       // ISO
  modifiedAt: string;      // ISO
  modifiedBy?: string;
  webUrl?: string;         // absolute SharePoint browser URL for this folder
}

export interface FileNode {
  kind: 'file';
  accessLevel?: FileNodeResponseAccessLevelEnum;
  listKey: DocumentListKey;
  id: string;
  path: string;
  name: string;
  parentId: string;
  sizeBytes?: number;      // omitted by lightweight recursive search
  createdAt?: string;
  modifiedAt: string;
  modifiedBy?: string;
  contentType?: string;
  onlineUrl?: string;
  desktopUrl?: string;
  downloadUrl?: string;
}

export function isFolder(n: FileSystemNode): n is FolderNode {
  return n.kind === 'folder';
}

export interface FolderLocation {
  folderId: string;
  breadcrumb?: ResolvedBreadcrumbContext;
}

export type NavigationHistoryEntry =
  | { kind: 'folder'; folder: FolderLocation }
  | { kind: 'search'; scope: FolderLocation; query: string };
```

**Why `listKey`, `id`, AND `path`**: `listKey` is stable domain routing context used with `projectId` to select the backend-owned SharePoint site/library. `id` is an opaque UUID used for store lookups, drag targets, selection, clipboard, and navigation; it is never treated as globally unique without its list context. `path` is the mutable, human-readable backend path used for display and for operations that require a URL. **Rename** updates `path` for the item and any loaded descendants but leaves `id` and `listKey` untouched. **Move** is replace-on-success: it drops the moved node's cached subtree and re-inserts only the server-returned node. A same-list move retains `listKey`; a cross-list move returns the destination `listKey`. Stale descendant references are pruned rather than preserved (see §10).

---

## 5. The `FileSystemApi` contract

```ts
// services/file-system/file-system-api.ts
import type { Observable } from 'rxjs';

export type DocumentListKey = 'EXECUTION' | 'MARKETING';

export abstract class FileSystemApi {
  /** List the root of one document list (`listKey`) with its direct children. */
  abstract listDocumentRoot(projectId: string, listKey: DocumentListKey): Observable<{
    currentFolder: FolderNode;
    isListReadonly?: boolean;
    folders: FolderNode[];
    files: FileNode[];
  }>;

  /** List direct children; the adapter extracts `parent.listKey` and `parent.id`. */
  abstract listDocuments(projectId: string, parent: FolderNode): Observable<{
    currentFolder: FolderNode;
    isListReadonly?: boolean;
    folders: FolderNode[];
    files: FileNode[];
  }>;

  /**
   * Resolve a list-relative path (real folder names, case-insensitive; `''` = list root)
   * to its target folder. Returns the canonical path casing plus the target listing
   * only — no ancestors. Throws `not-found` on a missing segment.
   */
  abstract resolveDocumentPath(projectId: string, listKey: DocumentListKey, path: string):
    Observable<{ canonicalPath: string; listing: { currentFolder: FolderNode; folders: FolderNode[]; files: FileNode[] } }>;

  /** Search names recursively below `scope`; paging stays private to the adapter/backend. */
  abstract searchDocuments(
    projectId: string,
    scope: FolderNode,
    query: string,
  ): Observable<FileSystemNode[]>;

  /** Create under `parent`; backend resolves collisions and returns the persisted name. */
  abstract createFolder(projectId: string, parent: FolderNode, name: string): Observable<FolderNode>;

  /** Rename a folder or file. Throws on name collision or invalid name. */
  abstract rename(projectId: string, node: FileSystemNode, newName: string): Observable<FileSystemNode>;

  /** Move a folder or file to a new parent. Throws on descendant move, name collision. */
  abstract move(projectId: string, node: FileSystemNode, newParent: FolderNode): Observable<FileSystemNode>;

  /** Copy a folder (recursive) or file to a new parent. */
  abstract copy(projectId: string, node: FileSystemNode, newParent: FolderNode): Observable<FileSystemNode>;

  /** Delete a folder (recursive) or file. */
  abstract delete(projectId: string, node: FileSystemNode): Observable<void>;

  abstract getRecycleBinItems(projectId: string, listGuid: string): Observable<DocumentListing>;
  abstract restoreRecycleBinItem(projectId: string, listGuid: string, nodeId: string): Observable<void>;
  abstract deletePermanentlyRecycleBinItem(projectId: string, listGuid: string, nodeId: string): Observable<void>;

  /** Upload a file. Emits progress (0-100). Returns the created FileNode. */
  abstract upload(
    projectId: string,
    parent: FolderNode,
    file: File,
    onProgress: (percent: number) => void,
    signal?: AbortSignal,
  ): Observable<FileNode>;
}
```

The SharePoint adapter maps `copy(projectId, node, newParent)` to the existing
project-scoped copy controller:

```text
POST /projects/{projectId}/documents/copy

kind             <- node.kind
sourceParentPath <- decoded parent portion of node.path
sourceName       <- node.name
targetListKey    <- newParent.listKey
targetParentId   <- newParent.id
targetParentPath <- newParent.path
```

The copy request does not send source/destination wrapper objects, the source
`listKey`, `node.id`, a duplicated destination `kind`, or a destination name. The
complete parent paths identify the SharePoint sites and document libraries for the
copy operation. `targetListKey` is still required because SharePoint does not return
the frontend's domain value (`EXECUTION` or `MARKETING`); the backend maps it onto the
returned node. The backend compares the parent paths before copying: different parent
paths keep `node.name` unchanged, while equal parent paths select the File-Explorer
` - Copy` form. Existing `KeepBoth` logic then resolves any collision and the response
returns the canonical final name. The frontend never chooses the target name or
calculates a suffix. The source parent path is derived locally from `node.path`,
without a backend lookup.

The frontend permits this call when `node.listKey` and `newParent.listKey` differ.
The current path-based public contract still requires the backend hardening tracked
in `docs/TODO.md` item 5 before it can be considered project/list-bound.

For the returned node, the backend maps `listKey` from `targetListKey` and `parentId`
from `targetParentId`. SharePoint supplies the canonical `id`, `path`, `name`,
`createdAt`, `modifiedAt`, and optional `modifiedBy`. A file also maps its real
`sizeBytes`; a folder maps its real `itemCount`, which must not be defaulted to zero
because a recursive copy may contain children.

**Rationale for `Observable` over `Promise`:** the real adapter is built on Angular `HttpClient`, which is Observable-native. An `Observable` can be consumed as a single-shot result via `firstValueFrom` for the current HTTP-style request/response calls, while a `Promise` contract could not later be widened to expose cancellation or multi-emission. Keeping the contract as the superset preserves the option to add read-cancellation (e.g. `switchMap` over `listDocuments` on rapid navigation) and progress-streams without a future API refactor. Stores that prefer linear async/await (e.g. optimistic apply → await → rollback) bridge with `firstValueFrom` at the call site; the store's own public methods may remain Promise-based.

**Rationale for project scope and passing nodes:** `projectId` lets the future backend resolve and authorize the project's document library without exposing SharePoint identifiers to the component. Passing full `FolderNode` / `FileSystemNode` values gives adapters the fields they need for write operations. The mock ignores `projectId` and reads `arg.id` to look up its canonical copy.

**Rules for implementations**:
- All errors are delivered on the Observable's **error channel** as a typed `FileSystemError` carrying a `code`:
  `'not-found' | 'name-collision' | 'invalid-name' | 'locked' | 'descendant-move' | 'permission-denied' | 'network' | 'cancelled' | 'too-large' | 'unknown'`.
  Emit them via `throwError(() => new FileSystemError(...))`, or by throwing inside a `map`/operator so RxJS converts the throw into an error notification — do **not** `throw` synchronously from the method body (that fails at call time, before any subscriber attaches). The per-method "Throws on …" notes above are shorthand for this error notification. The real `HttpClient` adapter maps transport/SharePoint failures with `catchError` into a `FileSystemError`.
- All returned objects are deep-copied (caller cannot mutate internal state)
- `upload` must respect `AbortSignal` for cancellation

---

## 6. Mock Implementation Requirements

`MockFileSystemApi` must:

- Create one virtual bin per list and retain deleted subtree snapshots. Restore keeps
  original ids and restores paths under the current original parent; missing parents
  and name collisions leave records recoverable. Permanent deletion removes snapshots.
- Exclude bins/deleted records from recursive search. Support mock configuration for
  `readonlyListKeys`, `protectedFolderPaths`, and `readonlyFolderPaths`; default demo
  examples are protected `execution/Contracts` and read-only `marketing/Press`.

- **In-memory tree**: `Map<string, FileSystemNode>` seeded from `mock-seed.ts`
- **Seed data**: two document-list roots (`execution`, `marketing`) with nested folders and mixed file types (`.pdf`, `.docx`, `.xlsx`, `.png`, `.txt`). The local mock includes `execution/Unavailable on open` to simulate a folder that appears in a listing but returns `not-found` when opened.
- **Fresh state on every page refresh** (no localStorage)
- **Simulated latency**: 150–400ms random for reads, 250–600ms for writes, 300–1500ms for uploads (proportional to file size)
- **Simulated errors**: 5% random failure rate on writes, configurable via `MOCK_CONFIG.errorRate` token; errors throw `FileSystemError('network', ...)`. `MOCK_CONFIG.unavailableFolderPaths` can also force deterministic `not-found` reads for specific list-relative paths.
- **Constraint enforcement** (mandatory — the mock behaves like real SharePoint):
  - Search scans the complete in-memory subtree, matches names case-insensitively,
    returns canonical list-relative paths, and never crosses into the other list
  - Create resolves the requested default name to a unique canonical name (`New folder`, `New folder (1)`, …)
  - Name collision check on rename/move (throw `name-collision`)
  - Copy resolves root-name collisions with backend-equivalent KeepBoth naming
  - Descendant guard on move/copy (throw `descendant-move`)
  - Invalid-name check: empty, `.`, `..`, chars in `\/:*?"<>|`, length > 128 (throw `invalid-name`)
  - Non-existent `id` (throw `not-found`)
- **Deep clone on return** so callers can't mutate internal state
- **Upload progress**: simulate incremental progress, emit `onProgress` at ~10% intervals based on simulated latency
- **Upload cancellation**: respect `AbortSignal`; throw `cancelled`
- **Configurable via token**:
  ```ts
  export interface MockConfig {
    errorRate: number;       // 0..1, default 0.05
    minLatencyMs: number;    // default 150
    maxLatencyMs: number;    // default 400
    enableErrors: boolean;   // default true; turn off for automated tests
    unavailableFolderPaths?: readonly string[];
  }
  export const MOCK_CONFIG = new InjectionToken<MockConfig>('MOCK_CONFIG');
  ```

---

## 7. SharePoint Adapter Requirements

`SharePointFileSystemApi` is partially implemented. Its copy and upload lifecycles are
complete; the remaining operations retain implementation-pending Observable errors.

- Class implements `FileSystemApi` with every method present
- `copy` maps the source node and destination folder to the six-field project-scoped
  backend request, emits the canonical copied node, and translates HTTP failures into
  typed `FileSystemError` values
- Copy request construction is isolated in one private `requestCopy` method so an
  auto-generated client can replace the equivalent `HttpClient` call without changing
  clipboard, store, or error behavior
- `upload` sends the raw `File` to the stable backend endpoint, observes HTTP events,
  reports real progress, unsubscribes on `AbortSignal`, maps the final `FileNode`, and
  translates HTTP failures into typed `FileSystemError` values
- Upload request construction is isolated in one private `requestUpload` method so an
  auto-generated client can replace the equivalent `HttpClient` call without changing
  progress, cancellation, or error behavior
- Every method other than copy/upload returns
  `throwError(() => new Error('SharePointFileSystemApi is not implemented yet'))`
  on the Observable error channel
- File contains a detailed comment block at the top listing:
  - Angular routes operations through the application backend, never SharePoint
    directly
  - The backend reuses its existing authenticated Feign client and cached per-user
    certificate-backed OAuth bearer token; the feature adds no authentication or
    form-digest infrastructure
  - `id` ↔ `serverRelativeUrl` mapping strategy
  - Endpoints needed per method (e.g., for `createFolder`: `POST /_api/web/Folders`)
  - Error code mapping (SharePoint `-2147024713` → `'name-collision'`, etc.)
- JSDoc on each method with the endpoint(s) it will call

---

## 8. Architecture

### 8.1 Stores

**`FileSystemStore`** (entity cache, keyed by `id`):
- Entities: `FileSystemNode`
- State: `projectId: string | null`, `folderIdsWithLoadingChildren: string[]`, `errorByParentId: Record<string, FileSystemError | undefined>`, `folderIdsWithLoadedChildren: string[]`, `isInitializing: boolean`, `initializedRoots: DocumentListRoots | null`
- Methods: `connectProject(projectId)` (reactive `rxMethod`: the container passes its required `id` input signal once, named to match the destination route parameter; every change resets project state and re-initializes, with `switchMap` cancelling any in-flight load; imperative calls with a plain id retry the same project), `initialize(projectId)` (promise facade over one initialization — returns `DocumentListRoots` with each list marked `loaded`, `not-found`, or `error`; used by unit tests), `loadChildren(parentId)`, `createFolder(parentId, name)`, `rename(nodeOrId, newName)`, `delete(nodeOrId)`, `deleteRecycleBinNodes(ids)`, `restoreRecycleBinNodes(ids)`, `move(ids, targetParentId)`, `copy(nodeOrId, targetNodeOrId)`, `invalidate(parentId)`, `upload(parentId, file, onProgress, signal)`
- Depends on `FileSystemApi` (injected), not on a concrete class

**`NavigationStore`**:
- State: `currentFolderId: string | null`, `history: string[]`, `currentHistoryIndex: number`, `expandedTreeIds: Set<string>`, `selectedIds: Set<string>`, `focusedId: string | null`, `renamingId: string | null`
- Computed: `canGoBack`, `canGoForward`, `canGoUp`, `pathSegments`, `parentId`, `currentFolderChildren`
- Methods: `navigateTo(id)`, `back()`, `forward()`, `up()`, `expand(id)`, `collapse(id)`, `select(id, mode)`, `selectRange(id)`, `clearSelection()`, `startRename(id)`, `endRename()`

**`ClipboardService`**:
- Plain injectable signal service, not a Signal Store
- State: `ids: ReadonlySet<string>`, `mode: 'cut' | 'copy' | null`
- Computed/helpers: `isEmpty`, `has(id)`
- State: retained canonical `nodes`, derived `ids`, `mode`, and `isEmpty`
- Methods: `cut(nodes)`, `copy(nodes)`, `clear()`
- Paste orchestration belongs in `ProjectDocuments` or a dedicated use-case service because it coordinates `ClipboardService`, `NavigationStore`, and `FileSystemStore`

All stores and feature services are provided at `ProjectDocuments` level.

### 8.2 Services

- **`FileSystemApi`** (abstract) — §5
- **`MockFileSystemApi`** — §6
- **`SharePointFileSystemApi`** — §7
- **`DragDropService`** — cross-component drag state (signal-based); methods: `startDrag`, `over`, `drop`, `leave`, `endDrag`, `canDropOn`
- **`UploadService`** — upload queue with concurrency limit; exposes task signals for the panel
- **`ClipboardService`** — small signal-based clipboard state holder
- **`ConcurrencyQueue`** — generic promise-based queue, max N concurrent; used for bulk ops and uploads
- **`NotificationService`** — component-scoped wrapper around `MessageService` (`p-toast`); centralizes severity/lifetime defaults, safe `FileSystemError.code` → user-message mapping, technical console logging, and optional Retry actions. `ProjectDocuments` owns the decision to notify; stores and dumb components do not inject it.
- **`FileLaunchService`** — validates backend-provided file action links and performs
  online, installed-Office, and direct-download navigation. It never constructs a
  SharePoint URL or downloads file bytes through Angular.

### 8.3 Components

```
project-documents/
  project-documents.ts      # container; provides stores; wires events
  project-documents-theme.scss  # maps the shared palette (assets/styles/utils/_colors.scss) to the --pd-* tokens all feature styles consume
  components/
    folder-tree/folder-tree.ts
    file-table/file-table.ts
    path-bar/path-bar.ts
    nav-toolbar/nav-toolbar.ts
    upload-panel/upload-panel.ts
  shared/
    file-system-icon/                  # file-type icon: <img> over assets/icons/sharepoint-file-type-icons/<name>.svg
  stores/
    file-system.store.ts
    navigation.store.ts
  services/
    file-system-api.ts                 # abstract class
    clipboard.service.ts               # plain signal clipboard state
    sharepoint-file-system-api.ts      # stub
    mock/
      mock-file-system-api.ts          # mock/dev backend + unit-test double
      mock-seed.ts                     # seed data
      mock-config.token.ts             # mock latency/error settings
    interaction/drag-drop.service.ts
    upload.service.ts
    concurrency-queue.ts
    directory-manifest.ts
    notification.service.ts
    file-launch.service.ts
  models/
    file-system-node.model.ts
    file-system-error.model.ts
    drag-state.model.ts
    upload-task.model.ts
  utils/
    path.utils.ts                      # parentOf, joinPath, isAncestorOf, basename
    naming.utils.ts                    # resolveNameCollision, sanitizeName, validateName
  tokens/
    file-manager-config.token.ts
```

---

## 9. Drag-and-Drop Implementation

**Native HTML5 DnD**, coordinated through `DragDropService`. Not PrimeNG DnD, not CDK DragDrop. Rationale: uniform API for internal + external (OS file) drags, single drag-state source of truth, clean component isolation.

### 9.1 Contract

`services/interaction/drag-drop.service.ts` is provided by `ProjectDocuments`.
Tree/table children emit typed `ItemDragRequest` / `ItemDropRequest` events and
receive source, target, active-state, and draggable-ID inputs; they inject no stores.

- One cached item per session; only ordinary tree folders and table files/folders
  are draggable. Roots, bins, deleted records, editing or busy items are excluded.
- `dragstart` writes a random session token under
  `application/x-project-documents-item` and sets `effectAllowed = 'copyMove'`.
  Payload IDs alone never authorize a mutation: an active in-memory session for
  this component/project is required. Internal events take precedence over `Files`.
- `dragover` reads only types and `ctrlKey`, validates the current canonical nodes,
  sets `dropEffect`, and highlights the valid target on its actual surface.
  Default is move; Ctrl is copy. Modifier changes are read from drag events because
  native drags suppress ordinary keyboard events.
- `drop` synchronously reads and verifies the token, reads the final Ctrl state,
  and validates again before clearing the gesture and awaiting the mutation.
  Source and destination are marked busy; a second internal operation is rejected.
- A valid collapsed tree folder expands after 700ms hover without navigation.
  Leaving/changing targets, cancellation, drop, project changes, and destruction
  clear the timer. Tree/table tracking uses node IDs to preserve native sources
  while lazy-loaded entities change.
- `dragend` clears the gesture, including native Escape cancellation. A document
  Escape handler also cancels when the browser delivers the keyboard event.

### 9.2 Validation and completion

`drag-drop-policy.ts` rechecks source/destination availability, current write/edit
state, node access flags, parent access, and document-list access on hover and drop.
Search results are draggable (2026-11-03), one row at a time — selection is
right-pane-table only. Permissions are **item-level**: a read-only item cannot be moved
or deleted, and the folder it sits in is not consulted, matching every other gate in the
app (the context menus, tree, table and store all read the item's own access and its
list, never its parent's). A moved or deleted result leaves the list; a copied one stays.
The search is not re-run.

Roots and bins cannot be dragged. Dropping on a recycle bin **deletes** (2026-11-01):
the bin is only an affordance, since `FileSystemApi.delete` takes no target and the
backend routes the item to its own list's bin — so only the bin matching the source's
`listKey` accepts the drop, and any other bin would misrepresent where the item goes.
Holding Ctrl asks for a copy, which a bin cannot satisfy, so that is rejected rather
than silently deleting. There is no confirmation: the item is recoverable from the bin
and the gesture is deliberate. A multi-selection deletes every item. Deleted records
inside a bin are not bins and still receive no drops.
Self/descendant drops and same-parent moves are rejected. Same-parent Ctrl-copy
retains the existing backend/mock KeepBoth naming (locally `name - Copy`, then
`name - Copy (2)`). Protected/readonly sources may be copied to a writable target.
Moving also requires an editable source and a writable source parent/list.
Protected target folders accept new contents; readonly targets/lists do not.

Containment walks cached parent IDs with a same-list canonical path-prefix fallback
for a folder resolved without its ancestors. This does not change bin display paths.

Mutations reuse `FileSystemStore.move/copy` and remain pessimistic. Success applies
canonical returned nodes, prunes moved subtree navigation/clipboard references, and
shows a notification. The view stays open unless the moved folder contains it; that
case opens the destination after success. Failure preserves data/view/references.
The removed subtree is found at completion, including path-resolved descendants
and records loaded while the move was pending. A connection revision prevents late
move/copy results patching a reinitialized
project, including reinitialization with the same ID. Stale completions and
completions after component destruction produce no drag navigation/toast.

Local mocks support cross-list operations. Real SharePoint move remains a stub;
actual backend support, especially cross-site support, must be verified separately.

---

## 10. Write Rules (all pessimistic)

| Operation | Mode | Behavior |
|---|---|---|
| Create folder | Pessimistic | Request `New folder`; await the server-selected unique name, insert the returned node, bump parent `itemCount`, then enter inline rename |
| Rename | Pessimistic | Await server, apply the returned node, repath cached descendants |
| Single delete | Pessimistic | Await server, then remove the cached subtree |
| Single move | Pessimistic | Await server; drop the moved subtree and insert only the returned node (collapsed/unloaded), adjust both parent counts, prune dangling refs (replace-on-success) |
| Single copy | Pessimistic | Await canonical returned node; mock supports same/cross-list, real backend capability requires verification |
| Bulk delete/move/copy | Pessimistic + progress | Run through ConcurrencyQueue, apply each on success, summarize errors |
| Upload | Pessimistic + progress | Always |

No optimistic apply, snapshots, temp ids, or rollback anywhere — on error nothing was
applied, so the store is already consistent and the failure surfaces as a toast.

---

## 11. Conflict Resolution

Name collision on rename/move/copy/upload:
- **Initial folder creation**: the backend returns a unique persisted default name before inline editing starts
- **Rename same parent**: inline error "A file/folder with that name already exists."
- **Copy**: always KeepBoth through the backend; apply the canonical returned name
- **Upload**: fail the file with a collision message; never overwrite or retry automatically
- `naming.utils.ts` provides `resolveNameCollision(baseName, existingNames)` → `"file (2).txt"`, `"file (3).txt"`, etc.

---

## 12. Error Handling

- All `FileSystemError` codes map to user-friendly messages via `NotificationService`
- Persistent states that prevent the current folder from displaying (`not-found`, permission, or a first load with no usable cache) render in the table area. Transient revalidation failures keep cached rows visible and use a toast. Never show the same failure in both places.
- `FileSystemStore.errorByParentId` retains typed `FileSystemError` values so the container can make that inline-vs-toast decision without parsing backend text.
- All mutations show toast on error (and success for bulk)
- A failed write applied nothing to the store (pessimistic), so the toast is the whole recovery — no rollback
- Only typed `FileSystemError('network')` failures offer a Retry action in the custom toast template. Unknown/untyped errors may indicate a programming defect and must not be retried blindly; deterministic failures such as `not-found` and permission errors also have no Retry action.
- Never swallow errors silently

---

## 13. Accessibility

- Tree and table preserve PrimeNG accessibility behavior
- Drag operations achievable without mouse (Cut → navigate → Paste)
- All interactive elements have `aria-label`
- Focus rings visible
- `aria-live="polite"` region announces current folder on navigation

---

## 14. Testing Hooks

- Every major element has `data-testid`: `pd-tree-node-<id>`, `pd-row-<id>`, `pd-btn-back`, `pd-btn-forward`, `pd-btn-up`, `pd-breadcrumb-<index>`, `pd-context-<action>`
- One unit test per store (established in Phase 1) showing the pattern
- `MockFileSystemApi` with `enableErrors: false` is the test double

---

## 15. Configuration

```ts
export interface FileManagerConfig {
  libraryRootName: string;       // display name for root, e.g. "Documents"
  maxUploadSizeBytes: number;    // default 250 MiB
  uploadConcurrency: number;     // default 4
  bulkOpConcurrency: number;     // default 4
}
export const FILE_MANAGER_CONFIG = new InjectionToken<FileManagerConfig>('FILE_MANAGER_CONFIG');
```

---

## 16. Out of Scope (do NOT build)

- Version history UI
- Sharing / permissions UI
- Document preview
- Check-in / check-out
- Search within file contents
- Favorites / pinned folders

Don't implement, don't stub. If the spec seems to suggest one of these, it's wrong — flag it, don't build it.
