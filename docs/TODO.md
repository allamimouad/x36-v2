# TODO — Open Review Findings

> Open items from the 2026-07-06 working-tree code review (partial document-root
> initialization + `ProjectDocumentsComponent` rename). Findings 1–3 from that review
> were fixed the same day; these are the ones deliberately left for later.
> Items 1–2 are also tracked in `PROGRESS.md` → "Deferred / Known Issues"; this file
> carries the full detail. Remove entries here (and in PROGRESS.md) as they are fixed.
>
> Line numbers are as of 2026-07-06 and will drift — anchor on the quoted code.

---

## 1. Address bar accepts list keys whose root is unavailable

- **Where**: `src/app/project-documents/project-documents.component.ts:222` — `onPathSubmitted` validates the typed key with `DOCUMENT_LIST_KEYS.find((key) => key === first)` only; it never checks `fileSystem.rootIdByList()[listKey]`.
- **Problem**: when a root failed to load (`not-found` or `error` status), its tree section is hidden, but the user can still type e.g. `execution/Contracts` into the address bar.
  - Against the **mock**: the path resolves anyway (the seed always contains both roots), so the user lands in a folder of a list the UI presents as nonexistent — table and breadcrumb show an "execution" location with no matching tree pane.
  - Against the **real backend**: the resolve would fail and surface the misleading generic "No folder matches that path." instead of saying the list itself is unavailable.
- **Suggested fix (small)**: in `onPathSubmitted`, after resolving `listKey`, if `this.fileSystem.rootIdByList()[listKey] === null` set a path error like "That document list is not available." and return. A few lines; no store change.
- **Priority**: do first among these — it is the only remaining user-facing inconsistency.

## 2. Missing/errored document root cannot be simulated in the mock

- **Where**: `src/app/project-documents/services/mock/mock-file-system-api.ts:30` — `listDocumentRoot` can never fail: both roots are always seeded and mock reads skip the random error rate (`maybeFail` applies to writes only).
- **Problem**: the entire partial-root feature — hidden tree sections, "No documents found for this project.", "Documents could not be loaded. Try refreshing.", the retry path — is exercised only by spec spies. No manual browser verification or QA smoke test can reach it; a regression in that UI would pass every manual check.
- **Suggested fix**: extend `MOCK_CONFIG` with an optional `unavailableListKeys?: readonly DocumentListKey[]` that makes `listDocumentRoot` throw `FileSystemError('not-found')` for the listed keys, mirroring the existing `unavailableFolderPaths` pattern (see the 2026-07-03 session note). Optionally a second option (or an error-code field) to simulate the `error` status too, so the healthy-list-plus-console-error branch is also reachable.

## 3. `initialize`'s reduce-with-spread pipeline (cleanup, optional)

- **Where**: `src/app/project-documents/stores/file-system.store.ts:132` and `:136` — two `reduce`s with object-spread-per-iteration (`(acc, …) => ({ ...acc, [listKey]: … })`) build `listingByList` and `roots` from `loadedRoots`.
- **Problem**: no functional impact at n=2, but the spread-in-reduce shape is the accidentally-quadratic pattern that gets copied onto longer lists, and the `{ listKey, … }` wrapper + `ListingByDocumentList` type exist only to feed the reduces.
- **Suggested fix**: `DOCUMENT_LIST_KEYS` is a fixed ordered tuple and `Promise.all` preserves order, so `const [execution, marketing] = await Promise.all(DOCUMENT_LIST_KEYS.map(loadRoot));` lets both records be built as plain object literals, deleting the wrapper field, both reduces, and the extra type.

## 4. Duplicated template tree sections (cleanup, optional)

- **Where**: `src/app/project-documents/project-documents.component.html:84` and `:97` — the marketing and execution `@if (fileSystem.rootIdByList().<key>)` blocks are ~13-line near-duplicates differing only in key, label, and tree signal.
- **Problem**: any tree-section change (new input, a11y attribute, loading binding) must be hand-applied to both blocks; duplicated template blocks reliably drift. The presence check also lives at three altitudes (store `rootIdByList`, `buildTreeSection`'s `[]` return, template `@if`).
- **Suggested fix**: a `@for` over an ordered `[{ key, label, tree }]` array (marketing first, preserving the deliberate ordering), replacing the two per-list computeds with a keyed accessor. Best done together with the Phase 2 template work (context menus touch this template anyway).
