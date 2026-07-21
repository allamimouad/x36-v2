# TODO — Open Review Findings

> Open items from the 2026-07-06 working-tree code review (partial document-root
> initialization + `ProjectDocuments` rename). Findings 1–3 from that review
> were fixed the same day; these are the ones deliberately left for later.
> Items 1–2 are also tracked in `PROGRESS.md` → "Deferred / Known Issues"; this file
> carries the full detail. Remove entries here (and in PROGRESS.md) as they are fixed.
>
> Line numbers are as of 2026-07-06 and will drift — anchor on the quoted code.

---

## 1. Address bar accepts list keys whose root is unavailable

- **Where**: `src/app/project-documents/project-documents.ts` — `onPathSubmitted` validates the typed key with `DOCUMENT_LIST_KEYS.find((key) => key === first)` only; it never checks the corresponding `initializedRoots()[listKey]` status.
- **Problem**: when a root failed to load (`not-found` or `error` status), its tree section is hidden, but the user can still type e.g. `execution/Contracts` into the address bar.
  - Against the **mock**: the path resolves anyway (the seed always contains both roots), so the user lands in a folder of a list the UI presents as nonexistent — table and breadcrumb show an "execution" location with no matching tree pane.
  - Against the **real backend**: the resolve would fail and surface the misleading generic "No folder matches that path." instead of saying the list itself is unavailable.
- **Suggested fix (small)**: in `onPathSubmitted`, after resolving `listKey`, require `this.fileSystem.initializedRoots()?.[listKey].status === 'loaded'`; otherwise set a path error like "That document list is not available." and return. A few lines; no store change.
- **Priority**: do first among these — it is the only remaining user-facing inconsistency.

## 2. Missing/errored document root cannot be simulated in the mock

- **Where**: `src/app/project-documents/services/mock/mock-file-system-api.ts:30` — `listDocumentRoot` can never fail: both roots are always seeded and mock reads skip the random error rate (`maybeFail` applies to writes only).
- **Problem**: the entire partial-root feature — hidden tree sections, "No documents found for this project.", "Documents could not be loaded. Try refreshing.", the retry path — is exercised only by spec spies. No manual browser verification or QA smoke test can reach it; a regression in that UI would pass every manual check.
- **Suggested fix**: extend `MOCK_CONFIG` with an optional `unavailableListKeys?: readonly DocumentListKey[]` that makes `listDocumentRoot` throw `FileSystemError('not-found')` for the listed keys, mirroring the existing `unavailableFolderPaths` pattern (see the 2026-07-03 session note). Optionally a second option (or an error-code field) to simulate the `error` status too, so the healthy-list-plus-console-error branch is also reachable.

> (Two former items were resolved: `initialize`'s reduce-with-spread pipeline —
> 2026-07-06, by the reactive `connectProject` refactor — and the duplicated
> template tree sections — 2026-07-08, by the tree-splitter work plus a
> follow-up: ONE parameterized `#treeSection` `ng-template` (context: `label`,
> `nodes`, built by per-list context computeds) placed via `ngTemplateOutlet`
> in both the split and single-tree arrangements. An initial version kept two
> near-identical per-list templates; a cross-session review caught that only
> placement, not definition, had been deduplicated.)
