# Progress Tracker

> **Read this FIRST at the start of every session. Update this LAST before ending a session.**

---

## Current Status

**Active Phase**: Phase 1 — Foundation & Read-Only Browsing (code complete; awaiting in-browser acceptance run)
**Overall Progress**: 0 / 5 phases complete (Phase 1 ready for verification)

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
- [x] `stores/clipboard.store.ts` (shell)
- [x] `components/folder-tree/folder-tree.component.ts` (read-only, p-tree, lazy via container-built nodes)
- [x] `components/file-table/file-table.component.ts` (read-only, p-table, dblclick → output)
- [x] `components/path-bar/path-bar.component.ts`
- [x] `components/nav-toolbar/nav-toolbar.component.ts` (new-folder + upload buttons disabled with tooltip pointing at later phases)
- [x] `file-manager.component.ts` (container; provides stores + Mock as `FileSystemApi`; computed tree; effect auto-loads on nav)
- [x] `stores/navigation.store.spec.ts` (one test per public method + computeds)
- [x] `ng build --configuration development` succeeds
- [ ] **Demo runs in browser, all acceptance checks pass** ← user-facing verification still pending
- [ ] **Unit tests run** (Karma needs ChromeHeadless; can't run in current WSL env — run locally with `npm test`)

---

## Phase 2 — Mutations

- [ ] Not started — blocked by Phase 1 acceptance verification

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

1. **Verify Phase 1 in the browser** — `npm start`, click the tree, confirm:
   - Tree renders root + 3 seed folders, expand fetches children with loading spinner per node
   - Double-click in right pane navigates into folder
   - Single-click on tree node navigates
   - Current folder highlights in tree
   - Back / forward / up enable/disable correctly
   - Breadcrumb segments are clickable
   - F5 refreshes the current folder
   - No console errors
2. **Run `npm test` locally** to confirm `navigation.store.spec.ts` passes (couldn't be run in agent env — no Chrome binary).
3. If both pass, mark Phase 1 complete and proceed to Phase 2 (Mutations).

---

## Decisions Log

_Keep a running record of non-obvious choices. Update as you go. Future you will thank present you._

- **State management**: NgRx Signal Store over custom store, classic NgRx, or other libraries. Reason: `withEntities` solves the tree+table dual-view sync problem cleanly, signal-native, minimal boilerplate. Non-entity state (navigation, clipboard) also uses Signal Store for consistency.
- **Drag-and-drop**: Native HTML5 DnD over PrimeNG DnD or CDK DragDrop. Reason: uniform API for internal + external drops, single drag-state source of truth.
- **Backend abstraction**: `FileSystemApi` as abstract class (not interface + token). Reason: abstract classes work directly as DI tokens in Angular; cleaner idiom.
- **ID vs path**: Interface uses `id` (stable) + `path` (display). SharePoint impl maps `id` ↔ `serverRelativeUrl` internally. Reason: keeps interface backend-agnostic; `path` changes on move, `id` doesn't.
- **Optimistic for single ops, pessimistic for bulk**: Reason: no-batch SharePoint means partial failures on bulk are common; pessimistic + per-item progress is clearer UX than mass-rollback.
- **Mock persistence**: fresh state every refresh, no localStorage. Reason: matches user's request; simpler mental model during dev.
- **Copy is pessimistic even as single op**: copy creates a new entity on the server, so we need the real id before inserting into the store.
- **Mock id strategy**: `id = path` for the mock seed. Reason: matches SPEC §4 hint ("id can equal the initial path of the node, or be a UUID"); keeps debugging trivial. SharePoint impl will internally map `id` to `serverRelativeUrl` (same idea, different shape).
- **NavigationStore depends on FileSystemStore via `inject()` inside `withComputed`**: Reason: the path-segment / parent-id / current-folder-children computeds need entity lookups. One-way coupling only (FS store does not import nav store).
- **PrimeNG version pinned to v20.4.0** (`primeng@20.4.0`, `@primeng/themes@20.4.0`). Reason: PrimeNG `*` resolves to v21 which requires `@angular/cdk@^21` and Angular 21; we are on Angular 20. The `20.5.0-lts` line was avoided because LTS releases are gated behind a paid licence — 20.4.0 is the latest free Angular-20-compatible release.
- **PrimeNG theme**: Aura preset, dark-mode opt-in via `.dark` class on the host. Reason: latest PrimeNG-native styling system; dark mode toggleable later without theme swap.
- **Standalone components for PrimeNG imports**: each component imports the specific PrimeNG primitive it needs (`Tree`, `TableModule`, `ButtonModule`, `Tooltip`, `ProgressSpinner`). Reason: tree-shakable, matches Angular 20 standalone idiom.
- **Container provides stores + `FileSystemApi` mapping**: tokens (`MOCK_CONFIG`, `FILE_MANAGER_CONFIG`) keep their `providedIn: 'root'` defaults. Reason: stores hold state and must die with the component (SPEC §2.5); tokens are pure config, root-scoped is fine.
- **Auto-load-on-nav uses `queueMicrotask` inside the effect, not a direct call**. Reason: calling `loadChildren()` synchronously from the constructor `effect()` body causes an infinite effect-rerun loop because `loadChildren` writes signals (`setLoading`, `setError`) inside the effect's reactive run. Wrapping the call in `queueMicrotask` (or `untracked`/`afterNextRender`) defers the writes onto a fresh task, breaking the loop. Same wrap applied to `onTreeNodeExpanded` for consistency. This was a notable design trap — flagged in case Phase 2+ adds more "react to signal change → call store method" patterns.

---

## Deferred / Known Issues

_Things noticed during implementation but not fixed in the current phase. Review before starting the next phase._

- **Production build budget**: lazy chunk for `file-manager` is ~1.82 MB raw. Default `production` budget is 1 MB error / 500 kB warn. This will fail `ng build` (production) once we ship more code. Fix later by raising the chunk budget in `angular.json`, splitting the container, or auditing PrimeNG bundle. Not a Phase 1 requirement (`npm start` development build works fine).
- **`loadChildren` does not prune stale entities**: Phase 1 only ever adds/upserts. If a folder is deleted on the server between two `listChildren` calls, the deleted child stays in the entity cache. Acceptable for read-only Phase 1; in Phase 2 the mutation methods will remove entities directly. If `invalidate(parentId)` is followed by another `loadChildren`, stale siblings can still linger — fix in Phase 2 by tracking entities-by-parent and removing the diff.
- **`FileSystemStore.upload` signature is `(parentId, files)`** in the store stub but the underlying `FileSystemApi.upload` takes a single `File` plus progress callback. The mismatch is intentional — the store will fan out to `UploadService` in Phase 5 — but worth flagging now so the Phase 5 implementer doesn't try to wire them 1:1.
- **Karma + ChromeHeadless** — current WSL env has no Chrome binary; spec compiled clean during build but didn't execute. Noted in Current Focus; user runs `npm test` locally.
- **`@primeng/themes@20.4.0` shows a deprecation warning on install** advising migration to `@primeuix/themes`. The package still works — the Aura preset import path (`@primeng/themes/aura`) is unchanged. Migrate to `@primeuix/themes` when convenient (likely Phase 2 or 3); not blocking.

---

## Session Notes

_One line per session, newest at top. Include date, phase, what was completed, and any blockers._

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
