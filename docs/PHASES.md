# Phased Implementation Plan

> **For the LLM**: Read `PROGRESS.md` to know which phase is active. Do NOT implement ahead of the current phase. When the current phase is marked complete in `PROGRESS.md`, only then proceed to the next. Each phase must end in a runnable, demoable state.

---

## Phase 1 — Foundation & Read-Only Browsing

**Goal**: user can browse the mock file system (tree + table), navigate with back/forward/up and breadcrumb, see the current folder highlighted in the tree. No mutations yet.

### Entry criteria
- Fresh Angular 20 project with PrimeNG and `@ngrx/signals` installed
- `PROGRESS.md` initialized

### Deliverables

**Models & utils**
- `models/file-system-node.model.ts` — `FolderNode`, `FileNode`, `FileSystemNode`, `isFolder`
- `models/file-system-error.model.ts` — `FileSystemError` class with `code` field
- `utils/path.utils.ts` — `parentOf`, `joinPath`, `basename`, `isAncestorOrSelf`
- `utils/naming.utils.ts` — `validateName` (only validation needed in Phase 1; collision resolution in Phase 2)

**API layer**
- `services/file-system/file-system-api.ts` — abstract class per SPEC §5
- `services/file-system/file-system-api.ts` — all methods signed, bodies empty (concrete classes implement); every operation receives `projectId`
- `services/mock/mock-file-system-api.ts` — full implementation per SPEC §6, including:
  - In-memory `Map<string, FileSystemNode>`
  - Seed data loading
  - Latency simulation
  - Error simulation (rate configurable, defaults ON)
  - Constraint enforcement (name, descendant, collision, not-found)
  - Deep clone on return
  - **For Phase 1, only the read operations need to be correct**: `listDocumentRoot(projectId, listKey)` (a document list's root) and `listDocuments(projectId, parent)` (a folder's direct children; adapter extracts list key + id), each returning the current folder plus its direct files/folders.
- `services/mock/mock-seed.ts` — realistic seed with Execution + Marketing roots, nested folders, mixed files, and one mock-only unavailable folder for stale-navigation testing
- `services/file-system/sharepoint-file-system-api.ts` — stub per SPEC §7 (all methods throw)
- `services/mock/mock-config.token.ts` — `MOCK_CONFIG` InjectionToken
- `tokens/file-manager-config.token.ts` — `FILE_MANAGER_CONFIG` InjectionToken

**Stores**
- `stores/file-system.store.ts` — Signal Store with `withEntities<FileSystemNode>` keyed by `id`. Phase 1 methods: `initialize(projectId)`, `loadChildren(parentId)`, `invalidate(parentId)`. Other methods exist as placeholders rejecting with a neutral "not implemented yet" `FileSystemError` (source stays plan-free — SPEC §2.6).
- `stores/navigation.store.ts` — full implementation: state, computed, `navigateTo`, `back`, `forward`, `up`, `expand`, `collapse`. Selection methods can be stubs (Phase 3).
- `services/interaction/clipboard.service.ts` — plain signal service retaining canonical
  nodes plus derived ids/mode and `cut`, `copy`, `clear`. Keeping the node lets Paste
  use a source selected from transient search results.

**Components (dumb)**
- `components/folder-tree/folder-tree.ts`:
  - Inputs: `nodes`, `expandedIds`, `currentFolderId`, `folderIdsWithLoadingChildren`
  - Outputs: `nodeSelected`, `nodeExpanded`, `nodeCollapsed`
  - Uses `p-tree` with lazy loading
  - **No DnD, no context menu in Phase 1**
- `components/file-table/file-table.ts`:
  - Inputs: `items`, `loading`
  - Outputs: `itemDoubleClicked`
  - Uses `p-table`, shows name, size, modified date, type icon
  - **No selection, no DnD, no context menu, no rename in Phase 1** — single-click selects visually via p-table's default, but only for highlighting
- `components/path-bar/path-bar.ts`:
  - Input: `segments`
  - Output: `segmentClicked`
  - Renders clickable breadcrumb; truncation deferred to Phase 2 if time permits
- `components/nav-toolbar/nav-toolbar.ts`:
  - Inputs: `canGoBack`, `canGoForward`, `canGoUp`
  - Outputs: `back`, `forward`, `up`, `refresh`
  - Action buttons (new folder, upload) present but disabled with tooltip "Not available yet" (source must stay plan-free — SPEC §2.6)

**Container**
- `project-documents.ts`:
  - Required `projectId` input supplied by its host
  - Provides all three stores + `MockFileSystemApi` as `FileSystemApi`
  - Provides default `MOCK_CONFIG` and `FILE_MANAGER_CONFIG`
  - Builds tree node structure from `FileSystemStore` entities (computed)
  - Wires child outputs to store methods
  - Loads both document-list roots independently; available roots render, a missing root is hidden, and both missing roots show a table message
  - Template: simple flex layout (tree left, table right, toolbar + path bar on top)

**Testing**
- `stores/navigation.store.spec.ts` — one test per public method (navigate, back, forward, up, canGoBack computed). This establishes the testing pattern for later phases.

**Demo**
- `app.config.ts` wires up everything
- Running the app shows the seeded tree, user can click around, navigate, use back/forward/up, click breadcrumb segments

### Acceptance checks
- [ ] `npm start` runs; no console errors
- [ ] Tree renders both list roots + seed folders; expanding fetches children with visible loading indicator
- [ ] Double-clicking a folder in the right pane navigates into it
- [ ] Single-clicking a tree node navigates into it
- [ ] Current folder is highlighted in the tree
- [ ] Back / forward / up buttons work and disable correctly
- [ ] Breadcrumb clicks navigate correctly
- [ ] Refresh toolbar button re-fetches current folder
- [ ] Store unit tests pass
- [ ] No code references SharePoint or `serverRelativeUrl`

### NOT in this phase
- Any mutation (create/rename/delete/move/copy/upload)
- Context menus
- Selection beyond visual highlight
- Drag-and-drop
- Clipboard
- Dialogs
- Upload panel

---

## Phase 2 — Mutations (Create / Rename / Delete / Move via buttons)

**Goal**: user can create, rename, and delete through context menus, inline editing, and dialogs where appropriate. No drag-and-drop, clipboard, upload, or multi-select yet.

### Entry criteria
- Phase 1 acceptance checks pass
- `PROGRESS.md` shows Phase 1 complete

### Deliverables

**Utils**
- `utils/naming.utils.ts` — add `resolveNameCollision(baseName, existingNames)` returning unique name with `(2)`, `(3)` suffix

**Mock**
- Complete all remaining `MockFileSystemApi` methods: `createFolder`, `rename`, `move`, `copy`, `delete`. Upload stays stubbed.

**Stores**
- `stores/file-system.store.ts` — implement `createFolder`, `rename`, `delete` (single id only — bulk in Phase 3), `move` (single id), `copy` (single id). Writes are pessimistic per SPEC §2.4 and §10.
- `stores/navigation.store.ts` — add `startRename`, `endRename`

**Services**
- `services/interaction/notification.service.ts` — component-scoped wrapper around `MessageService`; methods: `success(message)`, `error(error, retry?)`, `warning(message)`, `info(message)`, `userMessageFor(error)`, `clear()`. `ProjectDocuments` decides inline state vs toast from typed store errors; retry actions use the custom `p-toast` template.

**Components**
- `components/folder-tree/folder-tree.ts` — emit folder context-menu requests; the container supplies the shared menu from SPEC §3.5
- `components/file-table/file-table.ts` — add:
  - Context menu per row
  - Context menu on empty area
  - Inline file/folder rename (when `focusedId === row.id` and rename mode active)
  - File open/download actions consume backend-provided `onlineUrl`, `desktopUrl`, and
    `downloadUrl`; missing or unsafe links leave only that action disabled
- `components/nav-toolbar/nav-toolbar.ts` — enable new folder button (server-first create followed by inline rename), upload button still disabled

**Container**
- Wires context menu actions to store methods
- Starts inline rename for files and folders, including after the backend confirms
  folder creation; shows single-item delete confirmation inline on the initiating
  table/tree surface and handles results
- Shows `p-toast` and `p-confirmDialog` at top level

**Local recursive name search**
- Add `searchDocuments(projectId, scope, query)` to `FileSystemApi` and implement it in
  the mock over the complete selected-folder subtree.
- Submit from the toolbar on Enter with a three-character minimum; do not search on
  every keystroke.
- Render canonical file/folder nodes with search-specific list-relative location.
  Double-click opens folders or a file's online application; file-location navigation
  remains an explicit context-menu action.
- Record search as its own navigation-history view. Back/Forward restore only its scope
  and query and rerun the request; results are never retained in navigation or the
  entity store.
- Reuse existing node actions from the search context menu: folder open/rename/copy/
  delete and file location/open/rename/copy/delete/download. Search rename/delete confirmations
  remain inline on the search row.
- Keep the SharePoint adapter compile-complete but leave its backend call pending until
  the backend implements the same public contract.

### Acceptance checks
- [ ] Create via button or context menu persists a unique default name, then opens inline rename
- [ ] Folder and file rename stay inline in the table/tree
- [ ] Delete via context menu shows inline Cancel/Confirm icon buttons on the initiating
  surface and deletes only on confirm
- [ ] Pessimistic writes show an in-flight affordance and update the cache only after the API confirms success
- [ ] Error messages are user-friendly (no raw error codes)
- [ ] Tree and table stay in sync — rename a folder in the tree, the table reflects it (if visible)
- [x] Local recursive name search works from a list root or nested folder
- [x] Back/Forward restores folder/search views without caching search results
- [ ] All changes refresh the tree node's children cache correctly

### NOT in this phase
- Multi-select
- Bulk operations
- Drag-and-drop
- Clipboard (cut/copy/paste)
- Upload

---

## Phase 3 — Selection and Clipboard

**Goal**: multi-select and cut/copy/paste workflows.

### Entry criteria
- Phase 2 complete

### Deliverables

**Stores**
- `stores/navigation.store.ts` — implement `select(id, mode: 'single' | 'toggle' | 'range')`, `selectRange(id)`, `clearSelection()`
- `stores/file-system.store.ts` — accept arrays in `delete`, `move`, `copy` (pessimistic + progress for bulk); uses `ConcurrencyQueue`

**Services**
- `services/upload/concurrency-queue.ts` — generic queue, max N concurrent; returns per-task results with errors isolated
- `services/interaction/clipboard.service.ts` — keep as pure clipboard state (`cut`, `copy`, `clear`, `isEmpty`, `has`). Paste orchestration lives in `project-documents.ts` or a dedicated use-case service and dispatches to `fileSystemStore.move` / `.copy`.

**Components**
- `components/file-table/file-table.ts`:
  - Multi-select wired (p-table selectionMode="multiple")
  - Cut items render at 50% opacity (read from `ClipboardService`)
  - Context menu adds: Cut, Copy, Paste (if clipboard not empty); folder-menu Paste
    targets the right-clicked folder without opening it first
### Acceptance checks
- [ ] Multi-selection behavior matches the specification
- [ ] Delete on multi-selection shows bulk confirm ("Delete 5 items?"), deletes sequentially with progress
- [ ] Bulk errors: succeeded items stay deleted, failed items remain, summary toast shown
- [ ] Cut + Paste moves items; Copy + Paste copies items only within the same
  document list
- [ ] Cut items are visually dimmed and clear on successful paste

### NOT in this phase
- Drag-and-drop
- Upload

---

## Phase 4 — Drag and Drop

**Goal**: full DnD matrix from SPEC §3.4. External upload drops are implemented
independently of the remaining internal move/copy drag state.

### Entry criteria
- Phase 3 complete

### Deliverables

**Models**
- `models/drag-state.model.ts` — `DragState` type per SPEC §9

**Services**
- `services/drag-drop.service.ts`:
  - `dragState` signal
  - `startDrag`, `updateEffect`, `endDrag`, `canDropOn` per SPEC §9
  - `isAncestorOrSelf` helper uses `allFolders` from `FileSystemStore` (injected)

**Components**
- `components/folder-tree/folder-tree.ts`:
  - Nodes become draggable (folders only, as tree only shows folders)
  - Nodes are drop targets (external file/folder upload is already implemented;
    internal tree/table drops remain)
  - Visual highlight when `canDropOn` = true during drag
- `components/file-table/file-table.ts`:
  - Rows draggable (both folders and files)
  - Folder rows are drop targets
  - Empty-area drop zone (folder background) = drop into current folder; show dashed border during drag

**Container**
- Handles `dropReceived` from tree and table
- Dispatches to `fileSystemStore.move` or `.copy` based on `dragState.effect`
- Listens to keydown/keyup on window during active drag to update `effect` based on Ctrl
- Escape cancels drag via `dragDropService.endDrag()` + setting a `cancelled` flag checked on drop

### Acceptance checks
- [ ] All 6 internal DnD scenarios (rows 1-6 in SPEC §3.4) work
- [ ] Ctrl-held drop = copy; default drop = move
- [ ] Drop onto self, descendant, or same-parent-move is blocked with no-drop cursor
- [ ] Multi-select drag moves all selected items sequentially with progress
- [ ] Visual feedback is crisp: highlight appears on hover over valid target, disappears on leave
- [ ] Cursor reflects operation (move arrow, copy plus-icon, no-drop)
- [x] External OS files/folders upload into a hovered tree/right-pane folder, or the
  current folder through the unused space below the table rows

### NOT in this phase
- Upload

---

## Phase 5 — File and Folder Upload

**Goal**: files and complete local folder trees upload through toolbar/context-menu
pickers or external OS drag-and-drop, with progress.

### Entry criteria
- Phase 4 complete

### Deliverables

**Models**
- `models/upload-task.model.ts` — per-file tasks plus lightweight folder-batch
  preparation state

**Mock**
- Implement `MockFileSystemApi.upload` — simulated incremental progress, 250 MiB guard,
  collision detection, `AbortSignal`, and the final persisted `FileNode`

**Services**
- `services/upload/upload.service.ts`:
  - exposes task/batch signals and file/folder enqueue operations
  - uses `showDirectoryPicker()` handles to preserve every directory, including empty
  - creates the uniquely named selected root and descendants parent-first before files
  - shows every selected top-level folder immediately and prepares their trees one at a
    time
  - uses `ConcurrencyQueue` with max 4 for file requests
  - supports cancel, eligible retry from byte zero, and clear completed
- `services/upload/directory-manifest.ts` — recursively enumerates directory/file handles
  without loading complete file bytes into application memory
- `services/upload/concurrency-queue.ts` — generic bounded promise queue

**Components**
- `components/upload-panel/upload-panel.ts`:
  - Floating bottom-right
  - Collapsible
  - Shows folder preparation, relative file paths, progress, cancel/retry buttons
  - Only visible while batches/tasks are retained

**Container**
- Toolbar Upload popup exposes Folder / File
- Empty-area and folder context menus expose the same choices and capture the selected
  SharePoint destination before the picker opens
- File uses `<input type="file" multiple>`; Folder uses native `showDirectoryPicker()`
- External file/folder drops reuse the same enqueue operations and upload panel;
  right-pane folder rows and tree nodes are explicit targets, while the flexible
  unused area below the table rows targets the currently open folder; header/file
  rows are not targets
- Adds upload panel to template (bottom-right fixed position)

### Acceptance checks
- [ ] File action supports multi-select and keeps the captured destination
- [ ] Folder action creates the selected root and all descendants, including empty-only trees
- [ ] Duplicate selected roots use the backend-returned unique root name
- [ ] Upload panel shows preparation and per-file progress
- [ ] Multiple selected/dropped folders are all shown, with one preparing and the rest
  queued
- [ ] Four-at-a-time file concurrency is enforced
- [ ] Cancel is best effort below 100%, becomes disabled during finalization, and
  network retry resends the complete file
- [ ] Collisions fail without overwrite and files above 250 MiB fail before a request
- [ ] Created folders/files appear in tree/table without a page refresh
- [ ] Folder selection is browser-checked in Edge/Chrome over HTTPS
- [ ] External file and nested/empty-folder drops are browser-checked in Edge/Chrome

---

## Phase 6 — SharePoint Implementation (OTHER LAPTOP)

**Goal**: replace `MockFileSystemApi` with `SharePointFileSystemApi` against real SharePoint on-prem.

### Prerequisites
- Access to the SharePoint on-prem environment
- Test site with a document library
- Ability to debug network requests

### Work to do
- Keep the implemented copy/upload lifecycles in `sharepoint-file-system-api.ts`;
  replace only the private `requestCopy` and `requestUpload` bodies with their
  generated backend operations
- Implement every remaining method per the adapter's JSDoc comments
- Use the application's existing generated backend client. The backend already routes
  SharePoint calls through an authenticated Feign client whose interceptor supplies the
  cached per-user certificate-backed OAuth bearer token. Do not add a frontend token
  cache, form-digest interceptor, `X-RequestDigest`, or `_api/contextinfo` calls.
- Implement `id` as the SharePoint `UniqueId` (GUID) and `path` as `ServerRelativeUrl`. Source operations address items via `GetFolderById('<id>')` / `GetFileById('<id>')`. The adapter is a thin shim over the auto-generated SharePoint client — every API method takes full `FolderNode` / `FileSystemNode` arguments, so the shim can read whichever fields (`id`, `path`, `name`, `parent.id`, `parent.path`, ...) the generated DTOs require.
- Error code mapping from SharePoint error codes to `FileSystemError` codes
- Preserve the implemented raw-body upload progress, cancellation, response, and typed
  error behavior when connecting the generated client; keep the frontend contract
  compatible with a future single-request streaming transport
- In `project-documents.ts`, swap the provider `useClass: MockFileSystemApi` → `useClass: SharePointFileSystemApi` and update/remove the `MockFileSystemApi` import (the binding lives in the container, not `app.config.ts`)
- Only after that swap, optionally delete `services/mock/` (mock backend + seed + mock config token) and the two `stores/*.spec.ts` if unit tests aren't kept in that repo
- Icons: no component swap needed — `FileSystemIcon` is the only file-type icon component (the Material Symbols stand-in was deleted 2026-07-08). Copy `src/assets/icons/sharepoint-file-type-icons/` (the 8 SVGs) to the target app along with the feature folder, or replace them with the target's own set — the component only needs `<name>.svg` to exist for the 8 `FileSystemIconName` values
- Fonts: the copied source uses Material Symbols (Outlined) ligature spans for UI chrome (nav-toolbar, container, path-bar). Ensure the target repo installs the `material-symbols` npm package and loads `material-symbols/outlined.css` (self-hosted — no CDN dependency)
- Colors: nothing to do — `project-documents-theme.scss` already maps every `--pd-*` token to the shared palette via `@use '../../assets/styles/utils/colors'`, the exact path of the target repo's `_colors.scss` (which `@forward`s `ibportal-web-ui-commons`). Do **NOT** copy this repo's `src/assets/styles/utils/_colors.scss` — it is a local stand-in with the lib palette inlined; the target already has the real file. To adjust a color: change the mapping in `project-documents-theme.scss`, or add a variable to the target's `_colors.scss` and reference it. PrimeNG component internals (buttons, tree rows, table hover) are themed separately via the PrimeNG preset; file-type icon colors live in the SVGs

### Acceptance
- All Phase 1–5 acceptance checks still pass, now against real SharePoint
- Component code changes are limited to the documented provider swap and icon-component swap

### Risks to watch for
- OAuth token expiry/refresh remains owned by the existing backend authentication layer
- 429 throttling on bulk ops (even with concurrency 4)
- Permission errors surfacing as generic 401/403 — need careful mapping
- Timezone handling: SharePoint returns UTC, ensure `createdAt` / `modifiedAt` are parsed correctly
- Path encoding: URLs with spaces, special chars — use `encodeURIComponent` consistently
- Very deep folder hierarchies may hit URL length limits in some on-prem configurations
