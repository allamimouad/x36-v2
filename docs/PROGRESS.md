# Progress Tracker

> **Read this FIRST at the start of every session. Update this LAST before ending a session.**

---

## Current Status

**Active Phase**: Phase 2 — Mutations
**Overall Progress**: 1 / 5 phases complete

---

## Phase 1 — Foundation & Read-Only Browsing

- [x] Angular 20 project initialized with PrimeNG + @ngrx/signals
- [x] `models/file-system-node.model.ts`
- [x] `models/file-system-error.model.ts`
- [x] `utils/path.utils.ts`
- [x] `utils/naming.utils.ts` (validateName only)
- [x] `tokens/mock-config.token.ts`
- [x] `tokens/file-manager-config.token.ts`
- [x] `services/file-system-api.ts` (abstract class)
- [x] `services/mock-file-system-api.ts` (read listing real, mutations initially stubbed; now `listDocumentRoot` + `listDocuments(parentId)` — see the two-document-lists decision)
- [x] `services/mock-seed.ts` (two list roots — Execution & Marketing — each with two levels of subfolders and mixed file types)
- [x] `services/sharepoint-file-system-api.ts` (full stub with implementation notes + per-method JSDoc + SP error-code map)
- [x] `stores/file-system.store.ts` (`initialize(projectId)` + loadChildren + invalidate; mutations initially rejected as Phase 2)
- [x] `stores/navigation.store.ts` (full minus selection; selection methods are no-op stubs)
- [x] `services/clipboard.service.ts` (plain signal service)
- [x] `components/folder-tree/folder-tree.component.ts` (read-only, p-tree, lazy via container-built nodes, per-node loading input)
- [x] `components/file-table/file-table.component.ts` (read-only, p-table, dblclick → output)
- [x] `components/path-bar/path-bar.component.ts`
- [x] `components/nav-toolbar/nav-toolbar.component.ts` (new-folder + upload buttons disabled with tooltip pointing at later phases)
- [x] `file-manager.component.ts` (container; provides stores + Mock as `FileSystemApi`; computed tree; effect auto-loads on nav)
- [x] `stores/navigation.store.spec.ts` (one test per public method + computeds; initial-state test tightened)
- [x] `ng build --configuration development` succeeds
- [x] **Demo runs in browser, all acceptance checks pass**
- [x] **Unit tests run**

---

## Phase 2 — Mutations

- [x] `utils/naming.utils.ts` — `resolveNameCollision(baseName, existingNames)`
- [x] `services/mock-file-system-api.ts` — implemented `createFolder`, `rename`, `move`, `copy`, `delete`
- [x] `stores/file-system.store.ts` — implemented single-item create/rename/delete/move/copy
- [x] `stores/navigation.store.ts` — implemented `startRename`, `endRename` (path-id remapping no longer needed after UUID switch — see refactor note 2026-05-21)
- [ ] `services/notification.service.ts`
- [ ] Dialog components: create folder, rename, conflict-resolution shell
- [ ] Context menu and inline rename wiring

---

## Phase 3 — Selection, Keyboard, Clipboard

- [ ] Not started — blocked by Phase 2

---

## Phase 4 — Drag and Drop

- [ ] Not started — blocked by Phase 3

---

## Phase 5 — Uploads & External Drops

- [ ] Not started — blocked by Phase 4

---

## Phase 6 — SharePoint Implementation (other laptop)

- [ ] Not started — deferred to other machine

---

## Current Focus

_What should the next session work on?_

1. Add `NotificationService`.
2. Add Phase 2 dialogs: create folder, rename, conflict-resolution shell.
3. Add context-menu and inline rename wiring, staying within the Phase 2 scope.

---

## Decisions Log

_Keep a running record of non-obvious choices. Update as you go. Future you will thank present you._

- **State management**: NgRx Signal Store is used for entity collections and stateful domains with non-trivial derived graphs. `FileSystemStore` uses `withEntities` for tree+table cache sync; `NavigationStore` uses Signal Store for history, expanded IDs, selection/focus/rename state, and derived folder computeds. Small command-style state uses plain signal services; `ClipboardService` is a plain injectable signal service.
- **Drag-and-drop**: Native HTML5 DnD over PrimeNG DnD or CDK DragDrop. Reason: uniform API for internal + external drops, single drag-state source of truth.
- **Backend abstraction**: `FileSystemApi` as abstract class (not interface + token). Reason: abstract classes work directly as DI tokens in Angular; cleaner idiom.
- **ID vs path**: `id` is a stable, opaque UUID for the entity's lifetime; `path` is the mutable display/backend path that changes on rename/move. Mock generates ids via `crypto.randomUUID()`. SharePoint adapter maps `id = UniqueId` (the GUID SharePoint exposes per list item) and `path = ServerRelativeUrl`. `id` never changes for the entity's lifetime. **Rename** updates `path` on the item and its cached descendants without touching `id`, so references survive without remapping. **Move** is replace-on-success (see the move decision below): it drops the moved subtree and re-inserts only the returned node, so references to the moved item itself survive (same id) but stale descendant references are pruned. Earlier the project used `id = normalized path`, which required rewriting ids (and remapping every consumer's id-holding state) on every rename/move; that complexity is now gone.
- **All writes are pessimistic** (changed 2026-06-24, was "optimistic single, pessimistic bulk"): every mutation awaits the API result before touching the store — no optimistic apply, snapshots, temp ids, or rollback. Reason: the SharePoint backend is both slow (form digest + round-trip) and fallible (throttling, digest expiry, permission, name collision), so optimistic apply would show a non-existent state and flicker the item away on rollback. We apply exactly what the server returns for the affected node and never fabricate the **opaque, server-owned metadata** we cannot derive — `modifiedAt`, `modifiedBy`, server-resolved names. The store still maintains two things locally as **confirmed cache maintenance** (deterministic consequences of an acknowledged write, not guesses): the direct parent's `itemCount` (±1) and descendant repathing after a folder **rename** (paths derive from `parentPath + name`; **move** instead drops the moved subtree — replace-on-success, see below); parent timestamps are left untouched and self-heal on the next revalidating load. Pessimistic also deletes a large amount of rollback/temp-id/reference-reconciliation code, and makes the cross-list-move id-stability question moot for the data layer. Trade-off: a write has a visible wait — the UI must show an in-flight spinner/disabled affordance, wired into the dialogs/context-menu actions when they land. See SPEC §2.4 / §10 / §12.
- **Mock persistence**: fresh state every refresh, no localStorage. Reason: matches user's request; simpler mental model during dev.
- **Move is replace-on-success, not repath-preserve** (2026-06-24): after a successful `move`, the moved node's cached subtree is dropped and only the server-returned `moved` node is inserted (collapsed/unloaded), instead of repathing and keeping descendants. Reason: under a multi-user backend the cached descendants may be stale (another user changed the folder), so dropping + refetch-on-expand is fresher and matches the pessimistic stance. `rename` keeps repath (its descendants don't move). Consequences handled: a guard blocks moving any folder whose cached subtree contains `currentFolderId` (lives in the container, which has both the cache and `currentFolderId`); `FileSystemStore.move` returns the removed ids; `NavigationStore.pruneReferences` + `ClipboardService.pruneReferences` drop dangling expanded/selected/focused/renaming/clipboard refs; stale Back/Forward history entries become `navigationError` "tombstones" (advance index, set `currentFolderId`, show an unavailable message in the right pane + footer, no backend load), cleared on any valid navigation; `refresh()` no-ops on a tombstone. Go Up is unaffected (current folder is guaranteed valid).
- **Two document lists per project (execution + marketing)** (2026-06-25): a project has two SharePoint document libraries, selected by a domain `DocumentListKey = 'execution' | 'marketing'` (`models/document-list.model.ts`, with `DOCUMENT_LIST_LABELS`). The frontend never sees SharePoint list GUIDs/URLs. **Reads are split**: `listDocumentRoot(projectId, listKey)` (only place `listKey` is needed — a root has no parent id) and `listDocuments(projectId, parentId)` (children by id). **Nodes stay generic — no `listKey` field**; a node's list is derived by walking to its root (ids are unique within the site). Writes are unchanged/node-based. `FileSystemStore` holds both trees in one entity cache, `rootIdByList: Record<DocumentListKey, string|null>`; `initialize(projectId)` loads both roots in parallel and returns `DocumentListRoots`. Navigation keeps a single `currentFolderId` (defaults to the **marketing** root; both roots start expanded) — `initialize({ currentFolderId, expandedRootIds })`. The container renders two `FolderTreeComponent` sections (**Marketing first, then Execution**, labelled via `DOCUMENT_LIST_LABELS`); the breadcrumb root label = the current folder's list (root walk). Cross-list move needs no special handling — replace-on-success drops the moved subtree and the returned node's new `parentId` places it under the target tree. Backend route suggestion in `docs/backend-endpoints.md` (split root/child reads).
- **Editable address-bar path navigation** (2026-06-26): users can type a list-relative path (`execution/Contracts/2026`) to jump to any folder, even uncached. Path segments are **real folder names, case-insensitive**; the backend returns the **canonical casing**. New read `resolveDocumentPath(projectId, listKey, path) → { canonicalPath, listing }` (target only, no ancestors); `FileSystemStore.loadPathListing` caches just the target (+`isResolvingPath` flag). Navigation `history` became `NavigationHistoryEntry[]` (`{ folderId, breadcrumb? }`); `openResolvedFolder` records a resolved entry without `loadChildren`; Back/Forward restore breadcrumb context and don't reload resolved entries; tombstone behavior preserved. `PathSegment` is now `{ label, id?, listKey?, path? }` — id-based for cached chains, path-based (re-resolve on click) for resolved ones. `PathBarComponent` is a controlled dumb component (fixed `/{projectLabel}/` prefix + edit mode via `editing`/`editRequested`/`editCancelled`/`pathSubmitted`); list-key **validation is in the container**. **Up** from a resolved folder re-resolves the parent path (ancestors aren't cached); cached Up unchanged. Typed-path nav never changes `expandedTreeIds` (the tree may not reveal the folder — intentional). `FileSystemReader` gained `rootIdByList` so navigation can label the breadcrumb root. Backend suggestion + SPEC §5 updated with the resolve-path endpoint.
- **Copy is pessimistic even as single op**: copy creates a new entity on the server, so we need the real id before inserting into the store.
- **Mock id strategy**: `id = crypto.randomUUID()` per node, generated at seed time and on create/copy. Reason: the id never changes for an entity's lifetime, so references to a given node survive a rename or a move *of that node* without remapping (move drops the moved node's descendants — see the move decision). Matches SharePoint's per-item `UniqueId` (GUID) — the SP adapter uses that directly.
- **FileSystemApi is explicitly project-scoped**: every method receives `projectId`, allowing the future backend to resolve and authorize the project's document library without exposing SharePoint list ids to the component. Retrieval is split into `listDocumentRoot(projectId, listKey)` (a document list's root) and `listDocuments(projectId, parentId)` (a folder's direct children, addressed by id) — see the two-document-lists decision below. Mutation methods also receive full nodes so adapters have the fields needed for writes.
- **FileSystemApi returns `Observable`, not `Promise`**: the real adapter is `HttpClient`-based (Observable-native). An `Observable` can be consumed as a single-shot result via `firstValueFrom` for today's request/response calls, while a `Promise` contract could not later be widened to expose cancellation or multi-emission. A Promise contract would foreclose read-cancellation (`switchMap` over `listDocuments`) and progress-streams at the type level; the Observable contract preserves the option to add them without a future API refactor. Decided while there is no HTTP code yet, so it was a pure signature change. `FileSystemStore` keeps its public methods Promise/`async` (the container awaits them) and bridges each call with `firstValueFrom` — the optimistic apply → await → rollback flow stays linear. The mock simulates latency/errors with `timer(ms).pipe(map(factory))` (`throwError` for the upload stub) instead of `setTimeout` + `await`. Read-cancellation and upload-as-progress-stream are deliberately left as *enabled* follow-ups, not yet wired.
- **NavigationStore depends on a read-only `FileSystemReader` abstraction**: Reason: path-segment / parent-id / current-folder-children computeds need entity lookups, but navigation must not be able to call file-system load/mutation methods. `FileManagerComponent` provides `FileSystemReader` via `useExisting: FileSystemStore`.
- **PrimeNG version pinned to v20.4.0** (`primeng@20.4.0`, `@primeng/themes@20.4.0`). Reason: PrimeNG `*` resolves to v21 which requires `@angular/cdk@^21` and Angular 21; we are on Angular 20. The `20.5.0-lts` line was avoided because LTS releases are gated behind a paid licence — 20.4.0 is the latest free Angular-20-compatible release.
- **PrimeNG theme**: Aura preset, dark-mode opt-in via `.dark` class on the host. Reason: latest PrimeNG-native styling system; dark mode toggleable later without theme swap.
- **Standalone components for PrimeNG imports**: each component imports the specific PrimeNG primitive it needs (`Tree`, `TableModule`, `ButtonModule`, `Tooltip`, `ProgressSpinner`). Reason: tree-shakable, matches Angular 20 standalone idiom.
- **File manager route is lazy-loaded**: Reason: PrimeNG-heavy file manager UI pushed the initial production bundle over Angular's default 1 MB budget when eagerly loaded. Lazy `loadComponent` keeps the initial bundle at ~468 kB while preserving the PrimeNG choice.
- **Container provides stores + `FileSystemApi` mapping**: tokens (`MOCK_CONFIG`, `FILE_MANAGER_CONFIG`) keep their `providedIn: 'root'` defaults. Reason: stores hold state and must die with the component (SPEC §2.5); tokens are pure config, root-scoped is fine.
- **Loads are triggered from `NavigationStore` actions, not from an `effect()`**. `navigateTo`, `back`, `forward`, and `expand` call `loadChildren` unless the same folder is already loading; this revalidates cached children on navigation so users see backend changes made by others. `refresh` invalidates then reloads the current folder, also skipping only when already loading. Reason: an earlier design used `effect()` in the container to react to `currentFolderId` changes, which required `queueMicrotask` + `untracked` workarounds to avoid an infinite re-fire loop caused by `loadChildren`'s synchronous signal writes (`setLoading`, `setError`). Moving the trigger into the action that *causes* the navigation change removes the anti-pattern entirely — `effect()` is for derived state, not for dispatching side-effects that themselves write signals. `FileSystemReader` was extended with `loadChildren`, `invalidate`, `folderIdsWithLoadedChildren`, and `folderIdsWithLoadingChildren` so navigation can trigger loads without gaining mutation access.

---

## Deferred / Known Issues

_Things noticed during implementation but not fixed in the current phase. Review before starting the next phase._

- **`FileSystemStore.upload` signature is `(parentId, files)`** in the store stub but the underlying `FileSystemApi.upload` takes a single `File` plus progress callback. The mismatch is intentional — the store will fan out to `UploadService` in Phase 5 — but worth flagging now so the Phase 5 implementer doesn't try to wire them 1:1.
- **Karma runner in agent sandbox** — current sandbox cannot bind Karma's local server on port 9876 (`listen EPERM`). Specs compile here, but browser tests cannot execute in the agent environment. User confirmed local `npm test` works.
- **`@primeng/themes@20.4.0` shows a deprecation warning on install** advising migration to `@primeuix/themes`. The package still works — the Aura preset import path (`@primeng/themes/aura`) is unchanged. Migrate to `@primeuix/themes` when convenient (likely Phase 2 or 3); not blocking.

---

## Session Notes

_One line per session, newest at top. Include date, phase, what was completed, and any blockers._

- **2026-07-01 — single tree-pane horizontal scrollbar**: moved horizontal scrolling responsibility to the left pane by letting stacked tree sections size to their content and overriding PrimeNG tree/root overflow to visible, so the pane has one scrollbar instead of one per tree.
- **2026-07-01 — project-prefixed tree headers**: updated the left tree section headers to include the current project label, e.g. `Kit Kat Purchase - Marketing Documents` and `Kit Kat Purchase - Execution Documents`, matching the reference UI. Removed the uppercase transform so the labels render in title case.
- **2026-07-01 — path-bar simplification pass**: rolled back the extracted breadcrumb helper/spec and kept the fitter local to `PathBarComponent` with clearer, compact methods (`measureAndFit`, `readNaturalWidths`, `calculateCollapsedCount`, `correctRenderedOverflow`). The HTML was trimmed back to the compact breadcrumb/menu template. `npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.spec.json --noEmit`, `npx ng build --configuration development`, and `git diff --check` pass.
- **2026-07-01 — path-bar no-growth guard for large jumps**: fixed the remaining jump-navigation flash where moving from a one-level long path directly to a deeper long path could render with the previous collapse count for one frame. `PathBarComponent` now treats any new segment/project snapshot as unfitted and renders the conservative `… > current` state until measurement completes, then expands only if the measured widths fit. The toolbar host `.fm-breadcrumb` now uses `flex: 1 1 0` so breadcrumb text never contributes intrinsic width to the toolbar row. `npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.spec.json --noEmit`, `npx ng build --configuration development`, and `git diff --check` pass.
- **2026-07-01 — path-bar fitting follow-up**: tightened the custom breadcrumb fitter so it includes flex `gap` widths in the fit math, measures the current segment in its bold rendered style, keeps the PrimeNG overflow-menu host out of the breadcrumb flex row, clamps negative/tiny available widths, and lets the project prefix/current folder ellipsis-shrink cleanly. `npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.spec.json --noEmit`, `npx ng build --configuration development`, and `git diff --check` pass. Browser verification still needs to be done against the already-running dev server because the sandbox cannot reach `localhost:4200`.
- **2026-07-01 — path-bar overflow measurement fix**: changed `PathBarComponent` breadcrumb fitting so natural segment widths are measured from an out-of-flow hidden measurement row instead of rendering the full path in the visible toolbar for one frame. This preserves the full-or-collapsed parent rule while avoiding transient long-parent layout, bottom page scrollbars, and edit/blur states that left only the project prefix visible. `ng build --configuration development`, `tsc -p tsconfig.spec.json --noEmit`, and `git diff --check` pass. UI still needs browser verification on the long Marketing/Execution stress paths.
- **2026-06-26 — editable address-bar path navigation**: added `resolveDocumentPath` (API + mock walk + SP stub JSDoc), `FileSystemStore.loadPathListing` + `isResolvingPath`, navigation `history` → `NavigationHistoryEntry[]` + `openResolvedFolder` + `currentBreadcrumb` + resolved/cached `pathSegments`, `PathSegment` reshape, controlled `PathBarComponent` edit mode (`/{projectLabel}/` prefix), container `onPathSubmitted`/`onSegmentClicked`/`onUp`/`currentEditablePath` + `pathEditing`/`pathError`, table loading includes `isResolvingPath`, `FileSystemReader.rootIdByList`, demo `projectLabel`. Updated store + navigation specs (history-entry shape, resolved-nav + loadPathListing tests). Docs: SPEC §5 + `backend-endpoints.md` resolve-path. `tsc` (app + spec) and `ng build` clean; Karma still can't run in sandbox (Chrome missing system libs) — run `npm test` locally. UI not yet eyeballed (`npm start`).
- **2026-06-25 — two document lists (execution + marketing)**: added `DocumentListKey` + `DOCUMENT_LIST_LABELS` (`models/document-list.model.ts`); split `FileSystemApi` reads into `listDocumentRoot(projectId, listKey)` + `listDocuments(projectId, parentId)` (updated Mock + SharePoint stub + JSDoc); mock seed now builds **two roots** (`/execution`, `/marketing`), `buildSeed` returns `rootIdByList`. `FileSystemStore`: `rootId` → `rootIdByList`, `initialize` loads both roots in parallel and returns `DocumentListRoots`; `loadChildren` unchanged (already by id). `NavigationStore.initialize({ currentFolderId, expandedRootIds })`. Container renders two `FolderTreeComponent` sections from `rootIdByList` (Marketing first, then Execution), breadcrumb root label via root-walk; bootstrap defaults to the marketing root, both expanded (per the user's request). **Nodes stay generic — no `listKey` field.** Updated store + navigation specs (two-root seed, paths now `/execution/...`), SPEC §2.2/§5, `docs/backend-endpoints.md` (split reads). `tsc` (app + spec) clean. Karma needs local run (sandbox Chrome missing libs). No backend HTTP added (mock only).
- **2026-06-24 — move → replace-on-success + Back/Forward tombstones**: `FileSystemStore.move` now drops the moved subtree and inserts only the server-returned node (collapsed/unloaded), returning the removed ids; `rename` still repaths. Added the container `moveNode` coordinator with an ancestor-of-current guard, `NavigationStore.navigationError`/`pruneReferences`/refresh-guard, `ClipboardService.pruneReferences`, and a right-pane + footer "unavailable" state for stale Back/Forward history. Also fixed the footer `statusText` to show "Loading…" via `isCurrentLoading()`. Added store + navigation specs (replace semantics, tombstone nav, prune, refresh guard). `tsc` (app + spec) and dev build clean; Karma can't run in sandbox (Chrome missing system libs) — run `npm test` locally. No move-triggering UI yet (cut-paste/drag land in Phase 3/4) so `moveNode` is wired but unused for now.
- **2026-06-24 — Phase 2 writes flipped to pessimistic**: rewrote `FileSystemStore` `createFolder`/`rename`/`delete`/`move` from optimistic-with-rollback to pessimistic (validate + guard → await API → apply server result); `copy` was already pessimistic. Removed temp-id insertion, subtree snapshots, and all rollback `catch` blocks; dropped now-unused `removeEntity`/`joinPath` imports. Folder rename/move still repath cached descendants from the server-returned node (`_updateCachedSubtreePaths`). Added a pessimism-guard spec (stub a write to error → store unchanged, parent `itemCount` untouched). Updated SPEC §2.4/§10/§12 and the Decisions Log. Also fixed `_adjustParentCount` to stop fabricating the parent's `modifiedAt` (which left `modifiedBy` stale and inconsistent) — it now patches only the deterministic `itemCount ±1`; server-owned parent timestamps self-heal on the next revalidating load. Contract confirmed as Option A (mutations return the canonical affected node; status quo, no signature change). Note: these mutations are not yet wired to any UI (Phase 2 dialogs/context-menus pending), so no in-flight affordance was needed this session — add it when those land. Next: resume the two-library reshape (Part B of the plan) — `executionList` + `marketingList` two-tree support. Run `npm test` + `ng build` locally (Karma port 9876 still blocked in sandbox).
- **2026-06-17 — Phase 2 FileSystemApi contract flip to Observable**: switched every `FileSystemApi` method from `Promise<T>` to `Observable<T>` ahead of the HttpClient-based SharePoint adapter, while no HTTP code exists yet (cheap signature change vs later refactor). Behavior-preserving: `MockFileSystemApi` now wraps its unchanged synchronous logic in `timer(latency).pipe(map(...))` read/write helpers (`throwError` for the upload stub); the SharePoint stub return types became `Observable` and its bodies now `return throwError(() => new Error(PHASE6))` (error on the Observable channel, not a synchronous throw, per the SPEC §5 rule); `FileSystemStore` bridges each call with `firstValueFrom` and keeps its own public methods Promise/`async`. Read-cancellation (`switchMap`) and upload-as-progress-stream are enabled but intentionally not wired. Updated SPEC §1/§5 and the Decisions Log. `npx tsc --noEmit` passes; run `npm test` + `ng build` locally (Karma port 9876 still blocked in sandbox).
- **2026-06-11 — Phase 2 frontend project-scope contract refactor**: added required `projectId` input to `FileManagerComponent` and a hardcoded demo parent that keeps the root route runnable. Replaced `FileSystemApi.getRoot` + `listChildren` with one `listDocuments(projectId, parentId?)` operation returning current folder plus direct children; every mutation signature now also receives `projectId`. `FileSystemStore.initialize(projectId)` caches root metadata and children in one call, and `NavigationStore.initialize(rootId)` establishes initial history/expansion without a duplicate root request. Updated mock, SharePoint stub, focused store/navigation specs, SPEC, and PHASES. Development build passes; Karma execution remains subject to the sandbox port restriction.
- **2026-06-03 — Phase 2 navigation load refactor review/fix**: added duplicate-load guards to `NavigationStore.refresh()` and `FileSystemStore.loadChildren()` so refresh/direct loads cannot start overlapping child loads for the same folder. Renamed child-list load tracking to the clearer `folderIdsWithLoadedChildren` / `folderIdsWithLoadingChildren`. Navigation now revalidates cached children on `navigateTo`, `back`, `forward`, and `expand`, skipping only if that folder is already loading. Added focused `NavigationStore` specs with a fake `FileSystemReader` covering load triggering/revalidation/skipping for `navigateTo`, `back`, `forward`, `expand`, and `refresh`. Development build passes; Karma specs compile in the agent sandbox but cannot execute there because port 9876 binding is blocked (`listen EPERM`). User verified local Karma run: 20 specs, 0 failures before the revalidation adjustment; rerun locally after this session.
- **2026-05-21 — Phase 2 architecture refactor: NavigationStore triggers loads**: removed the constructor `effect()` (and its `queueMicrotask` + `untracked` workarounds) from `FileManagerComponent`. `NavigationStore.navigateTo` / `back` / `forward` / `expand` now trigger child loads directly after updating navigation state; new `refresh()` method bundles `invalidate + loadChildren` for the current folder. `FileSystemReader` was extended with `loadChildren`, `invalidate`, child-loaded ids, and child-loading ids so navigation can drive loads without gaining mutation access. Container is now plain: `onTreeNodeExpanded` just calls `navigation.expand(id)`; `onRefresh` just calls `navigation.refresh()`. Bootstrap unchanged.
- **2026-05-21 — Phase 2 architecture refactor: nodes-in, nodes-out API**: switched `FileSystemApi` from primitive `(id, parentPath, ...)` signatures to full `FolderNode` / `FileSystemNode` arguments (`move(node, newParent)`, `createFolder(parent, name)`, etc.). Rationale: the SharePoint adapter will be a thin shim over an auto-generated client built from the SharePoint OpenAPI spec; passing nodes gives the adapter access to whichever fields the generated DTOs require without our API churning. Mock reads `arg.id` for lookups. Store callsites already had nodes in hand from `entityMap` — they now pass them straight through.
- **2026-05-21 — Phase 2 architecture refactor: stable UUIDs as primary key**: replaced `id = normalized path` with stable UUIDs (`crypto.randomUUID()` in the mock seed and on create/copy). `path` remains the mutable display/backend path. Deleted `NavigationStore.remapPathIds` and its test — navigation/expanded/selection references survive rename/move untouched now. Simplified `FileSystemStore.rename`/`move` (no more remove+reinsert dance — same id, just overwrite via `setEntity`). Simplified mock `repathNode` (only updates path/name/parentId, never id). SharePoint stub now documents `id = UniqueId`, `path = ServerRelativeUrl`. Plan: `~/.claude/plans/befor-moving-to-next-breezy-pascal.md`.
- **2026-05-19 — Phase 2 structure cleanup**: externalized file-manager component templates/styles from inline `template`/`styles` blocks into sibling `.html`/`.scss` files for the container and existing child components. Behavior unchanged. Development build passes.
- **2026-05-07 — Phase 2 SharePoint path-id adaptation**: updated SPEC/PHASES/PROGRESS to make `id = normalized path` official, matching on-prem SharePoint `serverRelativeUrl`. Implemented `NavigationStore.startRename`, `endRename`, and `remapPathIds()` so rename/move can update path-based navigation references. Added unit coverage for rename state and remapping. Development build passes.
- **2026-05-07 — Phase 2 store mutations**: implemented `FileSystemStore` single-item create/rename/delete/move/copy. Create/rename/delete/move are optimistic with rollback snapshots; copy is pessimistic. Cached folder subtrees are repathed for id/path changes, descendant moves are guarded before optimistic updates, and `loadChildren` now prunes stale cached children on reload. Production and development builds pass.
- **2026-05-07 — Phase 2 mock mutations**: implemented `resolveNameCollision` and completed mock `createFolder`, `rename`, `move`, `copy`, and `delete` with validation, name-collision checks, descendant move guard, path/id repathing for folder descendants, deep-cloned returns, simulated write latency, and configurable simulated write errors. Upload remains stubbed for Phase 5. Production and development builds pass.
- **2026-05-07 — Phase 1 verification complete**: user confirmed browser acceptance and local Karma tests are working. Marked Phase 1 complete and advanced active work to Phase 2 — Mutations.
- **2026-05-06 — Phase 1 test cleanup**: replaced the no-op navigation initial-state spec with concrete assertions for current folder, history, expanded/selected/focus/rename state, and derived computeds. Development build passes; `npm test` compiles specs but cannot execute in sandbox because Karma cannot bind port 9876.
- **2026-05-06 — Phase 1 review fix**: added loading input to `FolderTreeComponent` and maps it to PrimeNG `TreeNode.loading` with `loadingMode="icon"`, so expanded folders can show per-node loading feedback. Production and development builds pass.
- **2026-05-06 — Phase 1 review fix**: lazy-loaded `FileManagerComponent` via route `loadComponent` to keep PrimeNG-heavy code out of the initial production bundle. `npm run build` now passes with initial bundle ~468 kB; development build also passes.
- **2026-05-06 — Phase 1 architecture boundary**: added `FileSystemReader` read-only abstraction and changed `NavigationStore` to inject that instead of the full `FileSystemStore`, preserving derived navigation computeds while structurally preventing navigation from calling file-system commands.
- **2026-05-06 — Phase 1 state simplification**: replaced `ClipboardStore` with plain signal-based `ClipboardService`. Clipboard remains pure state (`ids`, `mode`, `isEmpty`, `has`, `cut`, `copy`, `clear`); paste orchestration is deferred to Phase 3 and should live in the container or a dedicated use-case service.
- **2026-04-30 — Phase 1 (bug bisection)**: user reported page hang + memory blow-up on `npm start`. Bisected with progressive diagnostic versions (v3 → v8d): hang reproduced ONLY when the constructor `effect()` synchronously called `void this.fileSystem.loadChildren(id)`. Root cause: `loadChildren` writes signals (`setLoading`, `setError`) synchronously inside the effect's reactive run, which causes Angular's effect scheduler to re-fire infinitely. Fix: dispatch `loadChildren` from inside the effect via `queueMicrotask(() => void loadChildren(id))` so the writes happen on a fresh task. Same fix applied to `onTreeNodeExpanded`. See container `file-manager.component.ts` for the in-line warning comment. The `onRefresh` and explicit-action paths don't need the wrap because they aren't called from inside an effect.
- **2026-04-30 — Phase 1**: swapped `primeng`/`@primeng/themes` from `20.5.0-lts` (paid licence) down to free `20.4.0`. Build still green. `@primeng/themes` is deprecated → flagged for later migration to `@primeuix/themes`.
- **2026-04-29 — Phase 1**: scaffolded full Phase 1 (models, utils, tokens, abstract API + mock + SP stub, three stores, four dumb components, container, one spec). Wired Aura theme + PrimeIcons + lazy route. `ng build --development` and `ng serve` both green. Browser acceptance run + `npm test` deferred to user.

---

## Quick Reference for the LLM

- Component files: `ChangeDetectionStrategy.OnPush`, standalone, `inject()`, signal APIs
- Templates: new control flow (`@if`, `@for`, `@switch`, `@let`), no `*ngIf` / `*ngFor`
- Dumb components never inject stores — only inputs/outputs
- Stores depend on `FileSystemApi` (abstract), never on concrete implementations
- No feature creep beyond current phase
- Out-of-scope features (SPEC §16) are never built, not even stubbed
- Every mutation goes through stores; components never call `FileSystemApi` directly
- IDs are stable opaque primary keys everywhere; rename/move update mutable paths while ids stay unchanged
- When in doubt, re-read SPEC.md and PHASES.md before writing code
- Update this file at session end
