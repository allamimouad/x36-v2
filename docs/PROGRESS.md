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
- [x] `services/mock-file-system-api.ts` (listChildren + getRoot real, rest stubbed with `not implemented in Phase 1`)
- [x] `services/mock-seed.ts` (Documents/Shared/Archive, two levels of subfolders, mixed file types)
- [x] `services/sharepoint-file-system-api.ts` (full stub with implementation notes + per-method JSDoc + SP error-code map)
- [x] `stores/file-system.store.ts` (loadRoot + loadChildren + invalidate; mutations rejected as Phase 2)
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

- [ ] Not started — ready to begin

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

1. Start **Phase 2 — Mutations**.
2. Implement `resolveNameCollision(baseName, existingNames)` in `utils/naming.utils.ts`.
3. Complete mock mutation methods: `createFolder`, `rename`, `move`, `copy`, `delete` (upload remains Phase 5).
4. Implement single-item mutation methods in `FileSystemStore` with Phase 2 optimistic/pessimistic behavior.
5. Add `NotificationService` and Phase 2 dialogs/context-menu wiring, staying within the Phase 2 scope.

---

## Decisions Log

_Keep a running record of non-obvious choices. Update as you go. Future you will thank present you._

- **State management**: NgRx Signal Store is used for entity collections and stateful domains with non-trivial derived graphs. `FileSystemStore` uses `withEntities` for tree+table cache sync; `NavigationStore` uses Signal Store for history, expanded IDs, selection/focus/rename state, and derived folder computeds. Small command-style state uses plain signal services; `ClipboardService` is a plain injectable signal service.
- **Drag-and-drop**: Native HTML5 DnD over PrimeNG DnD or CDK DragDrop. Reason: uniform API for internal + external drops, single drag-state source of truth.
- **Backend abstraction**: `FileSystemApi` as abstract class (not interface + token). Reason: abstract classes work directly as DI tokens in Angular; cleaner idiom.
- **ID vs path**: Interface uses `id` (stable) + `path` (display). SharePoint impl maps `id` ↔ `serverRelativeUrl` internally. Reason: keeps interface backend-agnostic; `path` changes on move, `id` doesn't.
- **Optimistic for single ops, pessimistic for bulk**: Reason: no-batch SharePoint means partial failures on bulk are common; pessimistic + per-item progress is clearer UX than mass-rollback.
- **Mock persistence**: fresh state every refresh, no localStorage. Reason: matches user's request; simpler mental model during dev.
- **Copy is pessimistic even as single op**: copy creates a new entity on the server, so we need the real id before inserting into the store.
- **Mock id strategy**: `id = path` for the mock seed. Reason: matches SPEC §4 hint ("id can equal the initial path of the node, or be a UUID"); keeps debugging trivial. SharePoint impl will internally map `id` to `serverRelativeUrl` (same idea, different shape).
- **NavigationStore depends on a read-only `FileSystemReader` abstraction**: Reason: path-segment / parent-id / current-folder-children computeds need entity lookups, but navigation must not be able to call file-system load/mutation methods. `FileManagerComponent` provides `FileSystemReader` via `useExisting: FileSystemStore`.
- **PrimeNG version pinned to v20.4.0** (`primeng@20.4.0`, `@primeng/themes@20.4.0`). Reason: PrimeNG `*` resolves to v21 which requires `@angular/cdk@^21` and Angular 21; we are on Angular 20. The `20.5.0-lts` line was avoided because LTS releases are gated behind a paid licence — 20.4.0 is the latest free Angular-20-compatible release.
- **PrimeNG theme**: Aura preset, dark-mode opt-in via `.dark` class on the host. Reason: latest PrimeNG-native styling system; dark mode toggleable later without theme swap.
- **Standalone components for PrimeNG imports**: each component imports the specific PrimeNG primitive it needs (`Tree`, `TableModule`, `ButtonModule`, `Tooltip`, `ProgressSpinner`). Reason: tree-shakable, matches Angular 20 standalone idiom.
- **File manager route is lazy-loaded**: Reason: PrimeNG-heavy file manager UI pushed the initial production bundle over Angular's default 1 MB budget when eagerly loaded. Lazy `loadComponent` keeps the initial bundle at ~468 kB while preserving the PrimeNG choice.
- **Container provides stores + `FileSystemApi` mapping**: tokens (`MOCK_CONFIG`, `FILE_MANAGER_CONFIG`) keep their `providedIn: 'root'` defaults. Reason: stores hold state and must die with the component (SPEC §2.5); tokens are pure config, root-scoped is fine.
- **Auto-load-on-nav uses `queueMicrotask` inside the effect, not a direct call**. Reason: calling `loadChildren()` synchronously from the constructor `effect()` body causes an infinite effect-rerun loop because `loadChildren` writes signals (`setLoading`, `setError`) inside the effect's reactive run. Wrapping the call in `queueMicrotask` (or `untracked`/`afterNextRender`) defers the writes onto a fresh task, breaking the loop. Same wrap applied to `onTreeNodeExpanded` for consistency. This was a notable design trap — flagged in case Phase 2+ adds more "react to signal change → call store method" patterns.

---

## Deferred / Known Issues

_Things noticed during implementation but not fixed in the current phase. Review before starting the next phase._

- **`loadChildren` does not prune stale entities**: Phase 1 only ever adds/upserts. If a folder is deleted on the server between two `listChildren` calls, the deleted child stays in the entity cache. Acceptable for read-only Phase 1; in Phase 2 the mutation methods will remove entities directly. If `invalidate(parentId)` is followed by another `loadChildren`, stale siblings can still linger — fix in Phase 2 by tracking entities-by-parent and removing the diff.
- **`FileSystemStore.upload` signature is `(parentId, files)`** in the store stub but the underlying `FileSystemApi.upload` takes a single `File` plus progress callback. The mismatch is intentional — the store will fan out to `UploadService` in Phase 5 — but worth flagging now so the Phase 5 implementer doesn't try to wire them 1:1.
- **Karma runner in agent sandbox** — current sandbox cannot bind Karma's local server on port 9876 (`listen EPERM`). Specs compile here, but browser tests cannot execute in the agent environment. User confirmed local `npm test` works.
- **`@primeng/themes@20.4.0` shows a deprecation warning on install** advising migration to `@primeuix/themes`. The package still works — the Aura preset import path (`@primeng/themes/aura`) is unchanged. Migrate to `@primeuix/themes` when convenient (likely Phase 2 or 3); not blocking.

---

## Session Notes

_One line per session, newest at top. Include date, phase, what was completed, and any blockers._

- **2026-05-07 — Phase 1 verification complete**: user confirmed browser acceptance and local Karma tests are working. Marked Phase 1 complete and advanced active work to Phase 2 — Mutations.
- **2026-05-06 — Phase 1 test cleanup**: replaced the no-op navigation initial-state spec with concrete assertions for current folder, history, expanded/selected/focus/rename state, and derived computeds. Development build passes; `npm test` compiles specs but cannot execute in sandbox because Karma cannot bind port 9876.
- **2026-05-06 — Phase 1 review fix**: added `loadingByParentId` input to `FolderTreeComponent` and maps it to PrimeNG `TreeNode.loading` with `loadingMode="icon"`, so expanded folders can show per-node loading feedback. Production and development builds pass.
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
- IDs are the primary key everywhere; `path` is display-only
- When in doubt, re-read SPEC.md and PHASES.md before writing code
- Update this file at session end
