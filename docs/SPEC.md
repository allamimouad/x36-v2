# Angular 20 File Manager — Specification

> **For the LLM reading this**: This is one of three files. Always read all three before writing code:
> - `SPEC.md` (this file) — what to build
> - `PHASES.md` — implementation plan, phase by phase
> - `PROGRESS.md` — current status, what's done, what's next
>
> **Before starting any work**: read `PROGRESS.md` to see which phase is active.
> **Before ending your session**: update `PROGRESS.md` with what you completed, what you deferred, and what the next session should pick up.
> **Never implement features from a future phase.** If you notice something needed later, note it in `PROGRESS.md` under "Deferred" and move on.

---

## 1. Tech Stack (non-negotiable)

- **Angular 20** (standalone components, no `NgModule`)
- **TypeScript strict mode**
- **PrimeNG** (latest Angular-20-compatible version)
- **PrimeIcons**
- **@ngrx/signals** (NgRx Signal Store) for state management
- **RxJS** for the `FileSystemApi` contract (every method returns `Observable`, matching the HttpClient-native SharePoint adapter), plus HTTP and `rxMethod`. Stores that prefer async/await bridge with `firstValueFrom` at the call site.
- **Angular Signals** API throughout: `signal()`, `computed()`, `effect()`, `input()`, `output()`, `model()`
- **New control flow**: `@if`, `@for`, `@switch`, `@let`
- **`inject()`** everywhere — no constructor injection
- **`ChangeDetectionStrategy.OnPush`** on every component

---

## 2. Architectural Principles (read before writing any code)

### 2.1 Dumb components
Child components (`FolderTreeComponent`, `FileTableComponent`, `PathBarComponent`, `NavToolbarComponent`, `UploadPanelComponent`, dialogs) **MUST NOT inject stores**. They receive state via `input()` signals and emit via `output()`. Only the container (`FileManagerComponent`) and services wire stores to children. This is a hard rule.

### 2.2 Backend-agnostic via `FileSystemApi`
Stores **MUST NOT know about SharePoint**. They depend on an abstract `FileSystemApi` class. Two implementations exist:
- `MockFileSystemApi` — in-memory, used for dev and tests (default provider)
- `SharePointFileSystemApi` — stubbed now, implemented later on another machine

The interface uses generic terminology (`projectId`, `listKey`, `id`, `path`, `name`) — no SharePoint-specific terms like `serverRelativeUrl` leak out. A project has **two document lists**, selected by the domain `listKey` (`'execution' | 'marketing'`); the backend maps each to one of the project's SharePoint document libraries. `id` is a stable, opaque UUID for the entity's lifetime, unique within the project's SharePoint site. `path` is the mutable, human-readable backend path. In the mock, `id` is a `crypto.randomUUID()` value; in the SharePoint adapter, `id = UniqueId` (the GUID SharePoint exposes per list item) and `path = ServerRelativeUrl`. Retrieval is split: `listDocumentRoot(projectId, listKey)` returns a list's root (the only operation that needs `listKey`, since a root has no parent id), and `listDocuments(projectId, parentId)` returns a folder's direct children addressed by id. Nodes stay generic — they do **not** carry `listKey`; a node's list is derived by walking to its root. Mutations take full `FolderNode` / `FileSystemNode` arguments so each implementation can read whatever fields it needs. No internal id↔url mapping cache.

### 2.3 Signal Store for entities, plain signals for simple state
`FileSystemStore` uses `withEntities` because folders and files are viewed in multiple places (tree + table) and must stay in sync. `NavigationStore` uses Signal Store because it owns navigation history, expansion, focus, selection, rename state, and file-system-derived computeds. Small command-style state uses plain signal services; `ClipboardService` is a plain injectable service with `signal()` / `computed()`, not a Signal Store. Simple component-local state stays as plain `signal()` inside the component — don't over-store.

### 2.4 Pessimistic writes
All mutations wait for the API result before touching the store — no optimistic apply,
no rollback. Reason: the SharePoint backend is both slow (form digest + round-trip) and
fallible (throttling, digest expiry, permission, name collision). Optimistic apply would
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
All stores and services specific to the file manager are provided on `FileManagerComponent`, not `providedIn: 'root'`. State dies with the component.

---

## 3. Feature Requirements

### 3.1 Layout

- **Left pane**: folder tree (folders only, no files)
- **Right pane**: contents of the currently-open folder (folders + files)
- **Top bar**: back / forward / up buttons, clickable breadcrumb path, action buttons (new folder, upload), search input
- **Bottom status bar**: selection count, current folder item count
- **Upload panel**: floating bottom-right, collapsible, only visible when uploads exist

### 3.2 Core operations

- Create folder (dialog)
- Rename folder or file (inline on F2, or dialog via context menu)
- Delete folder or file (confirmation; bulk-aware)
- Move / copy (drag-and-drop, or cut/copy/paste)
- Upload files (drag-and-drop from OS + upload button)
- Navigate into folder

### 3.3 Navigation

- **Double-click a folder on the right** → opens that folder
- **Single-click a folder on the tree** → opens that folder
- **Current folder is highlighted in the tree** whenever visible there
- **Back / forward / up** like browser history:
  - Back: previous folder in history (not necessarily parent)
  - Forward: undoes Back
  - Up: navigates to parent (truncates forward history, same as a fresh nav)
- **Breadcrumb path is fully clickable**: clicking any segment navigates there
- `canGoBack`, `canGoForward`, `canGoUp` are `computed` signals; buttons disable via signal inputs

### 3.4 Drag-and-drop — full matrix

All scenarios must work:

| # | Source | Target | Result | Guard |
|---|--------|--------|--------|-------|
| 1 | Tree (folder) | Right pane (folder row) | Move source into target | Descendant guard |
| 2 | Tree (folder) | Right pane (empty area) | Move source into *currently open* folder | Descendant guard |
| 3 | Tree (folder) | Tree (folder node) | Move source under target | Descendant guard |
| 4 | Right pane (folder or file) | Tree (folder node) | Move item into target | Self/descendant guard |
| 5 | Right pane (folder or file) | Right pane (folder row) | Move item into target | No self-drop |
| 6 | Right-pane multi-selection | Any folder | Move all selected | Applied per-item |
| 7 | External OS files | Right pane (anywhere) | Upload to current folder | — |
| 8 | External OS files | Tree folder node | Upload into that folder | — |

**Modifiers**:
- Default drop = **move**
- Hold **Ctrl** during drop = **copy**
- **Escape** during drag = cancel
- Cursor reflects effect (`move` / `copy` / `no-drop`)

**Visual feedback**:
- Valid target: folder row/node highlights
- Invalid: `cursor: no-drop`, no highlight
- Empty right-pane drop zone: dashed border appears during drag

### 3.5 Right-click context menus

- **Tree folder node**: Open, New folder, Rename, Delete, Copy path
- **Right-pane folder**: Open, New folder (inside), Rename, Delete, Cut, Copy, Paste (if clipboard has items), Copy path
- **Right-pane file**: Open/Download, Rename, Delete, Cut, Copy, Copy path
- **Right-pane empty area**: New folder, Paste, Upload, Refresh

### 3.6 Cut / copy / paste clipboard

- Shortcuts: `Ctrl+X`, `Ctrl+C`, `Ctrl+V` (plus context menu)
- Clipboard: `{ ids: ReadonlySet<string>, mode: 'cut' | 'copy' | null }` in `ClipboardService`
- Cut items render at 50% opacity until pasted or cleared
- Paste cut into same folder: no-op (silent)
- Paste copy where name collides: prompt (Replace / Keep both / Skip / Cancel)
- On successful move after cut: clear clipboard

### 3.7 Multi-select (right pane only)

- **Click**: select one (becomes anchor)
- **Ctrl+Click**: toggle one
- **Shift+Click**: range from anchor
- **Ctrl+A**: select all in current folder
- **Escape**: clear selection
- Drives bulk delete, bulk move/copy, bulk cut/copy
- PrimeNG `p-table` `selectionMode="multiple"` with `dataKey="id"`

### 3.8 Keyboard shortcuts

| Key | Action |
|---|---|
| F2 | Rename focused item |
| Delete | Delete selection (confirm if bulk) |
| Enter on folder | Open it |
| Backspace | Go up (only if right pane has focus and nothing is being edited) |
| Alt+Left | Back |
| Alt+Right | Forward |
| Alt+Up | Parent |
| Ctrl+A | Select all (right pane) |
| Ctrl+C / X / V | Copy / Cut / Paste |
| Ctrl+N | New folder (in current folder) |
| F5 | Refresh current folder |
| Escape | Clear selection / cancel drag / close context menu |

### 3.9 Upload with progress

- Drag external files → queue uploads to target folder
- Upload button opens file picker (multi)
- **Upload panel**: floating bottom-right, collapsible, shows active / queued / completed
- Per-file progress bar, cancel, retry
- **Concurrency limit**: 4 simultaneous uploads
- **Chunked** for files > 10 MB (the mock simulates chunked progress; real SharePoint impl uses StartUpload/ContinueUpload/FinishUpload)

---

## 4. Data Models

```ts
// models/file-system-node.model.ts

export type FileSystemNode = FolderNode | FileNode;

export interface FolderNode {
  kind: 'folder';
  id: string;              // stable, opaque UUID (SharePoint UniqueId); never the path
  path: string;            // full path from root, e.g. "/Documents/Reports/2026"
  name: string;
  parentId: string | null; // null for root
  itemCount: number;
  createdAt: string;       // ISO
  modifiedAt: string;      // ISO
}

export interface FileNode {
  kind: 'file';
  id: string;
  path: string;
  name: string;
  parentId: string;
  sizeBytes: number;
  createdAt: string;
  modifiedAt: string;
  contentType?: string;
  downloadUrl?: string;
}

export function isFolder(n: FileSystemNode): n is FolderNode {
  return n.kind === 'folder';
}
```

**Why `id` AND `path`**: `id` is a stable, opaque UUID used everywhere for store lookups, drag targets, selection, clipboard, and navigation. It does not change for the lifetime of the entity. `path` is the mutable, human-readable backend path used for display and (in the SharePoint adapter) for constructing URLs on write operations. **Rename** updates `path` for the item and any loaded descendants but leaves `id` untouched, so references survive without remapping. **Move** is replace-on-success: it drops the moved node's cached subtree and re-inserts only the server-returned node (still the same `id`), so references to the moved item itself survive, but stale *descendant* references are pruned rather than preserved (navigation/expansion/selection/clipboard are pruned, and stale Back/Forward history entries become "unavailable" tombstones — see §10).

---

## 5. The `FileSystemApi` contract

```ts
// services/file-system-api.ts
import type { Observable } from 'rxjs';

export type DocumentListKey = 'execution' | 'marketing';

export abstract class FileSystemApi {
  /** List the root of one document list (`listKey`) with its direct children. */
  abstract listDocumentRoot(projectId: string, listKey: DocumentListKey): Observable<{
    currentFolder: FolderNode;
    folders: FolderNode[];
    files: FileNode[];
  }>;

  /** List the direct children of a folder, addressed by its id alone. */
  abstract listDocuments(projectId: string, parentId: string): Observable<{
    currentFolder: FolderNode;
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

  /** Create a new folder under `parent`. Throws on name collision. */
  abstract createFolder(projectId: string, parent: FolderNode, name: string): Observable<FolderNode>;

  /** Rename a folder or file. Throws on name collision or invalid name. */
  abstract rename(projectId: string, node: FileSystemNode, newName: string): Observable<FileSystemNode>;

  /** Move a folder or file to a new parent. Throws on descendant move, name collision. */
  abstract move(projectId: string, node: FileSystemNode, newParent: FolderNode): Observable<FileSystemNode>;

  /** Copy a folder (recursive) or file to a new parent. */
  abstract copy(projectId: string, node: FileSystemNode, newParent: FolderNode): Observable<FileSystemNode>;

  /** Delete a folder (recursive) or file. */
  abstract delete(projectId: string, node: FileSystemNode): Observable<void>;

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

**Rationale for `Observable` over `Promise`:** the real adapter is built on Angular `HttpClient`, which is Observable-native. An `Observable` can be consumed as a single-shot result via `firstValueFrom` for the current HTTP-style request/response calls, while a `Promise` contract could not later be widened to expose cancellation or multi-emission. Keeping the contract as the superset preserves the option to add read-cancellation (e.g. `switchMap` over `listDocuments` on rapid navigation) and progress-streams without a future API refactor. Stores that prefer linear async/await (e.g. optimistic apply → await → rollback) bridge with `firstValueFrom` at the call site; the store's own public methods may remain Promise-based.

**Rationale for project scope and passing nodes:** `projectId` lets the future backend resolve and authorize the project's document library without exposing SharePoint identifiers to the component. Passing full `FolderNode` / `FileSystemNode` values gives adapters the fields they need for write operations. The mock ignores `projectId` and reads `arg.id` to look up its canonical copy.

**Rules for implementations**:
- All errors are delivered on the Observable's **error channel** as a typed `FileSystemError` carrying a `code`:
  `'not-found' | 'name-collision' | 'invalid-name' | 'descendant-move' | 'permission-denied' | 'network' | 'cancelled' | 'unknown'`.
  Emit them via `throwError(() => new FileSystemError(...))`, or by throwing inside a `map`/operator so RxJS converts the throw into an error notification — do **not** `throw` synchronously from the method body (that fails at call time, before any subscriber attaches). The per-method "Throws on …" notes above are shorthand for this error notification. The real `HttpClient` adapter maps transport/SharePoint failures with `catchError` into a `FileSystemError`.
- All returned objects are deep-copied (caller cannot mutate internal state)
- `upload` must respect `AbortSignal` for cancellation

---

## 6. Mock Implementation Requirements

`MockFileSystemApi` must:

- **In-memory tree**: `Map<string, FileSystemNode>` seeded from `mock-seed.ts`
- **Seed data**: 3 top-level folders (`Documents`, `Shared`, `Archive`), each with 2 levels of subfolders and a mix of files (various sizes, types: `.pdf`, `.docx`, `.xlsx`, `.png`, `.txt`)
- **Fresh state on every page refresh** (no localStorage)
- **Simulated latency**: 150–400ms random for reads, 250–600ms for writes, 300–1500ms for uploads (proportional to file size)
- **Simulated errors**: 5% random failure rate on writes, configurable via `MOCK_CONFIG.errorRate` token; errors throw `FileSystemError('network', ...)`
- **Constraint enforcement** (mandatory — the mock behaves like real SharePoint):
  - Name collision check on create/rename/move/copy (throw `name-collision`)
  - Descendant guard on move (throw `descendant-move`)
  - Invalid-name check: empty, `.`, `..`, chars in `\/:*?"<>|`, length > 128 (throw `invalid-name`)
  - Non-existent `id` (throw `not-found`)
- **Deep clone on return** so callers can't mutate internal state
- **Upload progress**: simulate chunked progress, emit `onProgress` at ~10% intervals based on simulated latency
- **Upload cancellation**: respect `AbortSignal`; throw `cancelled`
- **Configurable via token**:
  ```ts
  export interface MockConfig {
    errorRate: number;       // 0..1, default 0.05
    minLatencyMs: number;    // default 150
    maxLatencyMs: number;    // default 400
    enableErrors: boolean;   // default true; turn off for automated tests
  }
  export const MOCK_CONFIG = new InjectionToken<MockConfig>('MOCK_CONFIG');
  ```

---

## 7. SharePoint Stub Requirements

`SharePointFileSystemApi` is a **stub file** committed now, implemented on another laptop later.

- Class implements `FileSystemApi` with every method present
- Each method body: `throw new Error('TODO: implement in Phase 6 — see PHASES.md');`
- File contains a detailed comment block at the top listing:
  - Base URL pattern (`{siteUrl}/_api/web/`)
  - Auth assumption (NTLM/Kerberos, `withCredentials: true`)
  - Form digest requirement
  - `id` ↔ `serverRelativeUrl` mapping strategy
  - Endpoints needed per method (e.g., for `createFolder`: `POST /_api/web/Folders`)
  - Error code mapping (SharePoint `-2147024713` → `'name-collision'`, etc.)
- JSDoc on each method with the endpoint(s) it will call

**Do not** write any real HTTP calls in the stub. The goal is: when the developer opens this file on the SharePoint-connected laptop, they have a complete checklist of what to implement.

---

## 8. Architecture

### 8.1 Stores

**`FileSystemStore`** (entity cache, keyed by `id`):
- Entities: `FileSystemNode`
- State: `projectId: string | null`, `folderIdsWithLoadingChildren: string[]`, `errorByParentId: Record<string, string | undefined>`, `folderIdsWithLoadedChildren: string[]`
- Methods: `initialize(projectId)`, `loadChildren(parentId)`, `createFolder(parentId, name)`, `rename(id, newName)`, `delete(ids)`, `move(ids, targetParentId)`, `copy(ids, targetParentId)`, `invalidate(parentId)`, `upload(parentId, files)`
- Depends on `FileSystemApi` (injected), not on a concrete class

**`NavigationStore`**:
- State: `currentFolderId: string | null`, `history: string[]`, `currentHistoryIndex: number`, `expandedTreeIds: Set<string>`, `selectedIds: Set<string>`, `focusedId: string | null`, `renamingId: string | null`
- Computed: `canGoBack`, `canGoForward`, `canGoUp`, `pathSegments`, `parentId`, `currentFolderChildren`
- Methods: `navigateTo(id)`, `back()`, `forward()`, `up()`, `expand(id)`, `collapse(id)`, `select(id, mode)`, `selectRange(id)`, `clearSelection()`, `startRename(id)`, `endRename()`

**`ClipboardService`**:
- Plain injectable signal service, not a Signal Store
- State: `ids: ReadonlySet<string>`, `mode: 'cut' | 'copy' | null`
- Computed/helpers: `isEmpty`, `has(id)`
- Methods: `cut(ids)`, `copy(ids)`, `clear()`
- Paste orchestration belongs in `FileManagerComponent` or a dedicated use-case service because it coordinates `ClipboardService`, `NavigationStore`, and `FileSystemStore`

All stores and feature services are provided at `FileManagerComponent` level.

### 8.2 Services

- **`FileSystemApi`** (abstract) — §5
- **`MockFileSystemApi`** — §6
- **`SharePointFileSystemApi`** — §7
- **`DragDropService`** — cross-component drag state (signal-based); methods: `startDrag`, `updateEffect`, `endDrag`, `canDropOn`
- **`UploadService`** — upload queue with concurrency limit; exposes task signals for the panel
- **`ClipboardService`** — small signal-based clipboard state holder
- **`ConcurrencyQueue`** — generic promise-based queue, max N concurrent; used for bulk ops and uploads
- **`NotificationService`** — wraps `MessageService` (p-toast); centralizes success/error messages

### 8.3 Components

```
file-manager/
  file-manager.component.ts           # container; provides stores; wires events
  components/
    folder-tree/folder-tree.component.ts
    file-table/file-table.component.ts
    path-bar/path-bar.component.ts
    nav-toolbar/nav-toolbar.component.ts
    upload-panel/upload-panel.component.ts
    dialogs/
      create-folder-dialog.component.ts
      rename-dialog.component.ts
      conflict-resolution-dialog.component.ts
  stores/
    file-system.store.ts
    navigation.store.ts
  services/
    file-system-api.ts                 # abstract class
    clipboard.service.ts               # plain signal clipboard state
    mock-file-system-api.ts
    sharepoint-file-system-api.ts      # stub
    mock-seed.ts                       # seed data
    drag-drop.service.ts
    upload.service.ts
    concurrency-queue.ts
    notification.service.ts
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
    mock-config.token.ts
```

---

## 9. Drag-and-Drop Implementation

**Native HTML5 DnD**, coordinated through `DragDropService`. Not PrimeNG DnD, not CDK DragDrop. Rationale: uniform API for internal + external (OS file) drags, single drag-state source of truth, clean component isolation.

### 9.1 Contract

Draggable elements:
- `draggable="true"`
- `(dragstart)` → `dragDropService.startDrag({ source, items, sourceParentId, effect: 'move' })`; set `event.dataTransfer.effectAllowed = 'copyMove'`
- `(dragend)` → `dragDropService.endDrag()`

Drop targets:
- `(dragover)`:
  - `event.preventDefault()` if `dragDropService.canDropOn(targetId)` is true
  - Read `event.ctrlKey` → `dragDropService.updateEffect(ctrlKey ? 'copy' : 'move')`
  - Set `event.dataTransfer.dropEffect` accordingly
  - Toggle local `isDragOver` signal
- `(dragleave)` → clear `isDragOver`
- `(drop)`:
  - `event.preventDefault()`
  - If `dragState().source === 'external'` → read `event.dataTransfer.files`, enqueue uploads to target
  - Else → emit `dropReceived` event; container calls `fileSystemStore.move()` or `.copy()`

### 9.2 `canDropOn` logic

```ts
canDropOn(targetId: string): boolean {
  const drag = this.dragState();
  if (!drag) return false;
  if (drag.source === 'external') return true;
  // Cannot drop onto items currently being dragged
  if (drag.items.some(i => i.id === targetId)) return false;
  // Cannot drop a folder into its own descendant
  for (const item of drag.items) {
    if (item.kind === 'folder' && isAncestorOrSelf(item.id, targetId, allFolders)) {
      return false;
    }
  }
  // No-op move (same parent)
  if (drag.effect === 'move' && drag.sourceParentId === targetId) return false;
  return true;
}
```

`isAncestorOrSelf(ancestorId, candidateId, allFolders)`: walks up from `candidateId` via `parentId` until it either hits `ancestorId` (true) or null (false). Use `id` traversal, not path string matching (paths change on rename, ids don't).

---

## 10. Write Rules (all pessimistic)

| Operation | Mode | Behavior |
|---|---|---|
| Create folder | Pessimistic | Await server, insert the returned node, bump parent `itemCount` |
| Rename | Pessimistic | Await server, apply the returned node, repath cached descendants |
| Single delete | Pessimistic | Await server, then remove the cached subtree |
| Single move | Pessimistic | Await server; drop the moved subtree and insert only the returned node (collapsed/unloaded), adjust both parent counts, prune dangling refs (replace-on-success) |
| Single copy | Pessimistic | Await server (copy creates a new entity, need real id) |
| Bulk delete/move/copy | Pessimistic + progress | Run through ConcurrencyQueue, apply each on success, summarize errors |
| Upload | Pessimistic + progress | Always |

No optimistic apply, snapshots, temp ids, or rollback anywhere — on error nothing was
applied, so the store is already consistent and the failure surfaces as a toast.

---

## 11. Conflict Resolution

Name collision on create/rename/move/copy/upload:
- **Rename same parent**: inline error "A file/folder with that name already exists."
- **Move / copy / upload**: `ConflictResolutionDialog` with options: Replace / Keep both (auto-suffix) / Skip / Cancel; bulk ops show "Apply to all" checkbox
- `naming.utils.ts` provides `resolveNameCollision(baseName, existingNames)` → `"file (2).txt"`, `"file (3).txt"`, etc.

---

## 12. Error Handling

- All `FileSystemError` codes map to user-friendly messages via `NotificationService`
- All mutations show toast on error (and success for bulk)
- A failed write applied nothing to the store (pessimistic), so the toast is the whole recovery — no rollback
- Network errors offer Retry action in toast
- Never swallow errors silently

---

## 13. Accessibility

- Tree and table keyboard-navigable (PrimeNG baseline)
- Drag operations achievable without mouse (Cut → navigate → Paste)
- All interactive elements have `aria-label`
- Focus rings visible
- `aria-live="polite"` region announces current folder on navigation

---

## 14. Testing Hooks

- Every major element has `data-testid`: `fm-tree-node-<id>`, `fm-row-<id>`, `fm-btn-back`, `fm-btn-forward`, `fm-btn-up`, `fm-breadcrumb-<index>`, `fm-context-<action>`
- One unit test per store (established in Phase 1) showing the pattern
- `MockFileSystemApi` with `enableErrors: false` is the test double

---

## 15. Configuration

```ts
export interface FileManagerConfig {
  libraryRootName: string;       // display name for root, e.g. "Documents"
  maxUploadSizeBytes: number;    // default 2 GB
  chunkSizeBytes: number;        // default 5 MB
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
- Recycle bin
- Favorites / pinned folders

Don't implement, don't stub. If the spec seems to suggest one of these, it's wrong — flag it, don't build it.
