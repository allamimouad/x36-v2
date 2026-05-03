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
- `services/file-system-api.ts` — abstract class per SPEC §5
- `services/file-system-api.ts` — all 8 methods signed, bodies empty (concrete classes implement)
- `services/mock-file-system-api.ts` — full implementation per SPEC §6, including:
  - In-memory `Map<string, FileSystemNode>`
  - Seed data loading
  - Latency simulation
  - Error simulation (rate configurable, defaults ON)
  - Constraint enforcement (name, descendant, collision, not-found)
  - Deep clone on return
  - **For Phase 1, only `listChildren`, `getRoot` need to be correct**. Other methods must exist with correct signatures but can be stubbed to throw "Not implemented in Phase 1".
- `services/mock-seed.ts` — realistic seed: 3 top-level folders, each with 2 levels of subfolders, mix of files
- `services/sharepoint-file-system-api.ts` — stub per SPEC §7 (all methods throw)
- `tokens/mock-config.token.ts` — `MOCK_CONFIG` InjectionToken
- `tokens/file-manager-config.token.ts` — `FILE_MANAGER_CONFIG` InjectionToken

**Stores**
- `stores/file-system.store.ts` — Signal Store with `withEntities<FileSystemNode>` keyed by `id`. Phase 1 methods: `loadChildren(parentId)`, `invalidate(parentId)`. Other methods exist as placeholders returning `Promise.reject(new Error('Phase 2'))`.
- `stores/navigation.store.ts` — full implementation: state, computed, `navigateTo`, `back`, `forward`, `up`, `expand`, `collapse`. Selection methods can be stubs (Phase 3).
- `stores/clipboard.store.ts` — shell only (empty state, no-op methods). Full impl in Phase 3.

**Components (dumb)**
- `components/folder-tree/folder-tree.component.ts`:
  - Inputs: `nodes`, `expandedIds`, `currentFolderId`, `loadingByParentId`
  - Outputs: `nodeSelected`, `nodeExpanded`, `nodeCollapsed`
  - Uses `p-tree` with lazy loading
  - **No DnD, no context menu in Phase 1**
- `components/file-table/file-table.component.ts`:
  - Inputs: `items`, `loading`
  - Outputs: `itemDoubleClicked`
  - Uses `p-table`, shows name, size, modified date, type icon
  - **No selection, no DnD, no context menu, no rename in Phase 1** — single-click selects visually via p-table's default, but only for highlighting
- `components/path-bar/path-bar.component.ts`:
  - Input: `segments`
  - Output: `segmentClicked`
  - Renders clickable breadcrumb; truncation deferred to Phase 2 if time permits
- `components/nav-toolbar/nav-toolbar.component.ts`:
  - Inputs: `canGoBack`, `canGoForward`, `canGoUp`
  - Outputs: `back`, `forward`, `up`, `refresh`
  - Action buttons (new folder, upload) present but disabled with tooltip "Coming in Phase 2"

**Container**
- `file-manager.component.ts`:
  - Provides all three stores + `MockFileSystemApi` as `FileSystemApi`
  - Provides default `MOCK_CONFIG` and `FILE_MANAGER_CONFIG`
  - Builds tree node structure from `FileSystemStore` entities (computed)
  - Wires child outputs to store methods
  - Subscribes to `navigationStore.currentFolderId` with an `effect` that calls `fileSystemStore.loadChildren(id)` on change
  - Template: simple flex layout (tree left, table right, toolbar + path bar on top)

**Testing**
- `stores/navigation.store.spec.ts` — one test per public method (navigate, back, forward, up, canGoBack computed). This establishes the testing pattern for later phases.

**Demo**
- `app.config.ts` wires up everything
- Running the app shows the seeded tree, user can click around, navigate, use back/forward/up, click breadcrumb segments

### Acceptance checks
- [ ] `npm start` runs; no console errors
- [ ] Tree renders root + 3 seed folders; expanding fetches children with visible loading indicator
- [ ] Double-clicking a folder in the right pane navigates into it
- [ ] Single-clicking a tree node navigates into it
- [ ] Current folder is highlighted in the tree
- [ ] Back / forward / up buttons work and disable correctly
- [ ] Breadcrumb clicks navigate correctly
- [ ] Refresh (F5 or toolbar button) re-fetches current folder
- [ ] Store unit tests pass
- [ ] No code references SharePoint or `serverRelativeUrl`

### NOT in this phase
- Any mutation (create/rename/delete/move/copy/upload)
- Context menus
- Selection beyond visual highlight
- Keyboard shortcuts (except F5)
- Drag-and-drop
- Clipboard
- Dialogs
- Upload panel

---

## Phase 2 — Mutations (Create / Rename / Delete / Move via buttons)

**Goal**: user can do full CRUD through buttons, context menus, and dialogs. No drag-and-drop, no multi-select yet.

### Entry criteria
- Phase 1 acceptance checks pass
- `PROGRESS.md` shows Phase 1 complete

### Deliverables

**Utils**
- `utils/naming.utils.ts` — add `resolveNameCollision(baseName, existingNames)` returning unique name with `(2)`, `(3)` suffix

**Mock**
- Complete all remaining `MockFileSystemApi` methods: `createFolder`, `rename`, `move`, `copy`, `delete`. Upload stays stubbed.

**Stores**
- `stores/file-system.store.ts` — implement `createFolder`, `rename`, `delete` (single id only — bulk in Phase 3), `move` (single id), `copy` (single id). Optimistic for single ops per SPEC §10.
- `stores/navigation.store.ts` — add `startRename`, `endRename`

**Services**
- `services/notification.service.ts` — wraps `MessageService`, methods: `success(message)`, `error(message, retry?)`, `warning(message)`, `info(message)`

**Components**
- `components/dialogs/create-folder-dialog.component.ts` — reactive form, name validation, disabled submit on invalid
- `components/dialogs/rename-dialog.component.ts` — same pattern
- `components/dialogs/conflict-resolution-dialog.component.ts` — shell only (used in Phase 4 for bulk move/copy; for Phase 2 single ops, errors show as toast)
- `components/folder-tree/folder-tree.component.ts` — add context menu with p-contextMenu: Open, New folder, Rename, Delete
- `components/file-table/file-table.component.ts` — add:
  - Context menu per row
  - Context menu on empty area
  - Inline rename (when `focusedId === row.id` and rename mode active)
- `components/nav-toolbar/nav-toolbar.component.ts` — enable new folder button (opens dialog), upload button still disabled

**Container**
- Wires context menu actions to store methods
- Opens dialogs, handles dialog results
- Shows `p-toast` and `p-confirmDialog` at top level

### Acceptance checks
- [ ] Create folder via button or context menu works; collision shows inline error
- [ ] Rename via F2 (inline) or context menu (dialog) works
- [ ] Delete via context menu shows confirmation, deletes on confirm
- [ ] Optimistic updates: new folder appears instantly; on simulated error, it disappears with an error toast
- [ ] Error messages are user-friendly (no raw error codes)
- [ ] Tree and table stay in sync — rename a folder in the tree, the table reflects it (if visible)
- [ ] All changes refresh the tree node's children cache correctly

### NOT in this phase
- Multi-select
- Bulk operations
- Drag-and-drop
- Clipboard (cut/copy/paste)
- Keyboard shortcuts beyond F2
- Upload

---

## Phase 3 — Selection, Keyboard, Clipboard

**Goal**: power-user workflows. Multi-select, all keyboard shortcuts, cut/copy/paste.

### Entry criteria
- Phase 2 complete

### Deliverables

**Stores**
- `stores/navigation.store.ts` — implement `select(id, mode: 'single' | 'toggle' | 'range')`, `selectRange(id)`, `clearSelection()`
- `stores/clipboard.store.ts` — full implementation: `cut(ids)`, `copy(ids)`, `clear()`, and `paste(targetParentId)` which dispatches to `fileSystemStore.move` (cut) or `fileSystemStore.copy` (copy) — bulk-aware
- `stores/file-system.store.ts` — accept arrays in `delete`, `move`, `copy` (pessimistic + progress for bulk); uses `ConcurrencyQueue`

**Services**
- `services/concurrency-queue.ts` — generic queue, max N concurrent; returns per-task results with errors isolated

**Components**
- `components/file-table/file-table.component.ts`:
  - Multi-select wired (p-table selectionMode="multiple")
  - Cut items render at 50% opacity (read from `ClipboardStore`)
  - Context menu adds: Cut, Copy, Paste (if clipboard not empty)
- `file-manager.component.ts`:
  - `@HostListener` or signal-based key handler for all shortcuts (SPEC §3.8)
  - Handles Escape to clear selection / close menus
  - Handles Ctrl+A, Delete (confirm if bulk), F2, Enter, Backspace, Alt+Left/Right/Up, Ctrl+X/C/V, Ctrl+N

### Acceptance checks
- [ ] Click / Ctrl+Click / Shift+Click behaviors match spec
- [ ] Ctrl+A selects all in current folder
- [ ] Delete on multi-selection shows bulk confirm ("Delete 5 items?"), deletes sequentially with progress
- [ ] Bulk errors: succeeded items stay deleted, failed items remain, summary toast shown
- [ ] Cut + Paste moves items; Copy + Paste copies items
- [ ] Cut items are visually dimmed; clear on successful paste or Escape
- [ ] All keyboard shortcuts work as specified
- [ ] Backspace only triggers up-nav when focus is in right pane and no input/dialog open

### NOT in this phase
- Drag-and-drop
- Upload

---

## Phase 4 — Drag and Drop

**Goal**: full DnD matrix from SPEC §3.4, excluding external file drops (Phase 5).

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
- `components/folder-tree/folder-tree.component.ts`:
  - Nodes become draggable (folders only, as tree only shows folders)
  - Nodes are drop targets (accept drops from tree and table; external drops deferred to Phase 5)
  - Visual highlight when `canDropOn` = true during drag
- `components/file-table/file-table.component.ts`:
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

### NOT in this phase
- External file drops from OS
- Upload

---

## Phase 5 — Uploads & External Drops

**Goal**: feature-complete. Uploads work, external file drops work on both tree and right pane.

### Entry criteria
- Phase 4 complete

### Deliverables

**Models**
- `models/upload-task.model.ts`:
  ```ts
  export interface UploadTask {
    id: string;
    file: File;
    parentId: string;
    status: 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';
    progress: number; // 0-100
    error?: string;
    abortController: AbortController;
  }
  ```

**Mock**
- Implement `MockFileSystemApi.upload` — simulated chunked progress, respects `AbortSignal`, creates the `FileNode` on completion, latency proportional to file size

**Services**
- `services/upload.service.ts`:
  - `tasks = signal<UploadTask[]>([])`
  - `enqueue(files, parentId)` — adds tasks, kicks queue
  - `cancel(id)`, `retry(id)`, `clearCompleted()`
  - Uses `ConcurrencyQueue` with max 4
  - On task completion, calls `fileSystemStore.invalidate(parentId)` so UI refreshes

**Components**
- `components/upload-panel/upload-panel.component.ts`:
  - Floating bottom-right
  - Collapsible (header click)
  - Shows per-task progress (p-progressBar), status icon, cancel/retry buttons
  - Only visible when tasks exist

**Tree and Table**
- Both accept external file drops:
  - `(dragover)` with `dataTransfer.types.includes('Files')` = valid target
  - `(drop)` extracts `event.dataTransfer.files`, calls `uploadService.enqueue(files, targetId)`
- Tree: target = hovered folder node
- Table: target = hovered folder row, OR current folder if empty area

**Container**
- Enables upload button in toolbar (opens file picker, multi-select)
- Adds upload panel to template (bottom-right fixed position)

### Acceptance checks
- [ ] Dragging OS files onto a tree node uploads into that folder
- [ ] Dragging OS files onto a table row (folder) uploads into that folder
- [ ] Dragging OS files onto table empty area uploads into current folder
- [ ] Upload button opens file picker, supports multi-select
- [ ] Upload panel appears on first upload, shows progress per file
- [ ] 4-at-a-time concurrency enforced (upload 10 files, only 4 show 'uploading', rest 'queued')
- [ ] Cancel button aborts upload immediately
- [ ] Retry button re-queues failed uploads
- [ ] Uploaded files appear in tree/table on completion (without full refresh)
- [ ] Large file simulation shows chunked-looking progress (not one jump to 100%)

---

## Phase 6 — SharePoint Implementation (OTHER LAPTOP)

**Goal**: replace `MockFileSystemApi` with `SharePointFileSystemApi` against real SharePoint on-prem.

### Prerequisites
- Access to the SharePoint on-prem environment
- Test site with a document library
- Ability to debug network requests

### Work to do
- Implement each method in `sharepoint-file-system-api.ts` per the stub's JSDoc comments
- Add `interceptors/digest.interceptor.ts` — injects `X-RequestDigest`, catches 403, refreshes, retries once
- Add form digest caching (singleton service, expires with safety margin)
- Implement `id` ↔ `serverRelativeUrl` mapping (suggestion: `id = base64(serverRelativeUrl)` for opacity, or just use the URL directly if simpler)
- Error code mapping from SharePoint error codes to `FileSystemError` codes
- Implement chunked upload (`StartUpload` / `ContinueUpload` / `FinishUpload`)
- Flip provider in `app.config.ts` from `MockFileSystemApi` to `SharePointFileSystemApi`

### Acceptance
- All Phase 1–5 acceptance checks still pass, now against real SharePoint
- No component code changes needed (this is the whole point of the abstraction)

### Risks to watch for
- Form digest expiry under load
- 429 throttling on bulk ops (even with concurrency 4)
- Permission errors surfacing as generic 401/403 — need careful mapping
- Timezone handling: SharePoint returns UTC, ensure `createdAt` / `modifiedAt` are parsed correctly
- Path encoding: URLs with spaces, special chars — use `encodeURIComponent` consistently
- Very deep folder hierarchies may hit URL length limits in some on-prem configurations
