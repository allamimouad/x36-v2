# TODO — Open Review Findings

> Open findings from the ongoing working-tree reviews. Findings 1–2 came from
> the 2026-07-06 partial document-root / `ProjectDocuments` review; findings
> 3–6 came from the 2026-07-31 copy/paste reviews; findings 7–11 came from the
> 2026-11 internal drag-and-drop reviews, items 10–11 from its quality pass. These are deliberately left for
> later and are also tracked in `PROGRESS.md` → "Deferred / Known Issues".
> This file carries the full detail. Remove entries here (and in PROGRESS.md)
> as they are fixed.
>
> Line numbers drift — anchor on the named methods and quoted behavior.

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

## 3. A stale async result can be written into a newly selected project

> **Status (2026-11-02): the store half is done; the rest is still open.** Every
> `FileSystemStore` mutation now captures `connectionRevision` and calls
> `_checkConnection` after its request — `move` and `copy` already did, and
> `createFolder`, `rename` and `delete` were added. `loadChildren` discards a listing
> from a replaced connection, and also one whose folder was deleted while it was in
> flight. Callers route failures through `reportMutationFailure`, which suppresses the
> `cancelled` code so a discarded-but-successful operation is not reported as a failure.
>
> **Still open, and the reason this item stays:**
> - `loadPathListing` has **no** check at all. An existence check would be wrong there
>   — resolving an uncached folder is the method's purpose — but a revision check
>   belongs. It needs `resolveAndOpen`'s caller to suppress a stale completion too,
>   since it feeds the path editor's error state rather than a toast.
> - The external-drop upload flow still awaits `ExternalDropService.read(...)` without
>   confirming the project session.
> - `UploadService.reset()` still retains the single-worker directory-preparation queue.

- **Where**:
  - `src/app/project-documents/stores/file-system.store.ts`, currently visible
    in `copy`: it starts the API call with the current project id, awaits the
    response, and then unconditionally inserts the returned node and adjusts
    the destination parent's child count;
  - `src/app/project-documents/project-documents.ts`, in the external-drop
    upload flow: it awaits `ExternalDropService.read(...)` before enqueuing the
    decoded files/directories, without checking that the project session is
    still the one in which the drop started;
  - `src/app/project-documents/services/upload/upload.service.ts`: `reset()` aborts
    directory-preparation controllers but retains the same single-worker
    `directoryPreparationQueue`.
- **Problem**: a request belongs to the project session in which it started, but
  its response may arrive after that session has been replaced. For example:
  1. A copy starts in project A.
  2. The host changes `projectId` to project B; initialization clears the cache
     and loads B.
  3. The copy response from A arrives and inserts A's node into B's cache (and
     may change a B parent count).

  Resetting the stores on project change is therefore necessary but not
  sufficient: it removes the old state immediately, but it does not cancel or
  invalidate already awaited `firstValueFrom(...)` operations.

  The same reset timing affects an external drop before it reaches the upload
  queue:
  1. Decoding a dropped directory starts in project A.
  2. The host switches to B; `uploads.reset()` clears and aborts the old queue.
  3. A's decoding finishes after that reset and enqueues new tasks targeting A's
     folder into B's active upload panel.

  This is the same project-session invalidation bug, not a separate upload
  issue.

  The retained preparation queue also creates an availability failure. If
  project A's browser directory iterator stalls inside `handle.values()`,
  aborting its controller cannot force that pending browser promise to settle.
  After switching to B, a B directory is placed behind A's still-occupied
  worker and can remain `queued` indefinitely even though the visible upload
  state was reset.
- **Confirmed scope**: `copy` demonstrates the race. Before fixing it, audit
  every project-scoped asynchronous store operation, including create, rename,
  delete, move, upload, child/path reads, and their success, error, loading, and
  `finally` state writes. The audit must also cover project-scoped asynchronous
  orchestration before a store/service owns the operation, especially external
  drop decoding before upload enqueueing. It must also audit queues and other
  long-lived schedulers owned by project-scoped services: clearing their visible
  task state is not enough when an old worker can block new-session work. A
  copy-only or store-only guard would leave the same class of bug elsewhere.
- **Candidate design to evaluate**: establish one project-session identity that
  is replaced whenever project initialization begins. Each asynchronous store
  operation captures it before starting and, after every await, applies state
  only if that exact session is still active. Pre-enqueue orchestration such as
  external-drop decoding must capture the same identity (or an equivalently
  invalidated upload generation) and stop before creating tasks when it is
  stale. `UploadService.reset()` must also replace its single-worker directory
  preparation queue, so the new session never waits for a non-cooperative old
  iterator; queued/preparing callbacks capture the corresponding upload
  generation and ignore late completion from abandoned queues. Use identity
  rather than only comparing `projectId`, so a rapid A → B → A switch cannot
  make work from the first A session look current. Keep this plumbing private
  to the store/services where practical; the newly confirmed pre-enqueue and
  scheduler windows mean the solution cannot be assumed to live only inside
  `FileSystemStore`.
- **Important mutation caveat**: ignoring a stale response protects the
  frontend cache, but the backend mutation may already have succeeded. The fix
  must not automatically retry it or report that it failed. We still need to
  decide the intended reconciliation/notification behavior when implementing
  this item.
- **Acceptance coverage**:
  - a delayed copy from A cannot add a node or alter a parent count after B is
    selected;
  - an A → B → A switch still rejects the response from the first A session;
  - reinitializing the same project also invalidates older operations;
  - every mutation is guarded, not only copy;
  - stale read successes and failures cannot overwrite the active project's
    entities, errors, or loading markers;
  - delayed external-drop decoding followed by A → B cannot enqueue a task or
    batch after `uploads.reset()`, and no A target appears in B's upload panel;
  - the same external-drop guard rejects work from the first session after an
    A → B → A switch;
  - when A's directory iterator never settles, switching to B gives B a fresh
    preparation worker and its first directory advances from `queued` without
    waiting for A;
  - if the abandoned A iterator later resumes, its generation cannot create
    folders, enqueue files, or update B's batch state;
  - the chosen backend-success/reconciliation behavior is explicit and tested.
- **Status / priority**: confirmed cross-project correctness risk (P0);
  documentation only for now. The candidate design is not yet an implementation
  decision and should be reviewed with the full async-operation audit.

## 4. Retrying an ambiguous copy failure can create duplicate copies

- **Where**:
  - `src/app/project-documents/project-documents.ts`, `pasteInto`: a typed
    `network` error receives a Retry action that calls `pasteInto(target)` again;
  - `src/app/project-documents/services/file-system/sharepoint-file-system-api.ts`,
    `mapCopyError`: status `0`, `408`, `429`, and `5xx` responses are classified
    as `network`;
  - `NotificationService` treats a `network` error with a callback as a
    retryable toast action.
- **Problem**: a transport failure does not prove that the mutation failed. The
  backend may have completed the SharePoint copy and then lost the HTTP response,
  timed out, or failed its canonical post-copy lookup. Retrying calls the copy
  mutation again. Because copy intentionally uses KeepBoth collision handling,
  the second call creates another item rather than detecting the first result.
  The user can therefore create duplicates by following the offered Retry action.
- **Related contract evidence**: the backend copy flow is explicitly a mutation
  followed by a canonical lookup. `docs/backend-operations/copy.md` already says
  that a lookup failure after successful copy must not repeat the mutation and
  that the frontend should refresh the destination when appropriate.
- **Underlying design issue**: `network` currently describes transport/transient
  failure, but the UI also interprets it as "safe to repeat." Retryability and
  outcome certainty are separate properties. The helper named
  `retryForReadError` is safe for idempotent reads, but it is also used by
  mutations; copy is the clearest duplicate-producing example. Audit create,
  rename, move, delete, and upload for the same ambiguous-outcome assumption.
- **Candidate immediate behavior to evaluate**: do not offer direct copy Retry
  without an idempotency guarantee. Explain that the result could not be
  confirmed and offer a destination Refresh/reconciliation action instead. If
  the destination is not loaded, invalidate it so its next opening reloads from
  the backend. After reconciliation, the user may deliberately initiate a new
  paste if no copy exists.
- **Robust future option**: make copy idempotent end-to-end. Generate one
  operation id for a user paste intent, reuse it on transport retries, and have
  the backend atomically deduplicate that id and return the original canonical
  result. Adding an id to the DTO without backend persistence/enforcement is not
  sufficient.
- **Acceptance coverage**:
  - a copy timeout/network/`5xx` error never causes a second copy POST merely
    because the user selects the offered recovery action;
  - recovery refreshes or invalidates only the destination and can reveal a copy
    that completed before the error;
  - a canonical post-copy lookup failure cannot create another KeepBoth copy;
  - if idempotency is implemented, retry reuses the same operation id and returns
    the same copied node id;
  - the mutation audit documents which failures are known-not-applied,
    ambiguous, and safe to retry.
- **Status / priority**: confirmed data-correctness risk (P1); documentation only
  for now. Refresh/reconciliation is the safest immediate candidate, while
  idempotency requires a backend contract decision.

## 5. Copy must be authorized against the project's configured document list

- **Where**: `docs/backend-operations/copy.md` currently records a public DTO with
  client-controlled `sourceParentPath`, `sourceName`, `targetListKey`,
  `targetParentId`, and `targetParentPath`. Its controller guidance validates and
  delegates but does not yet require canonical project/list ownership checks.
- **Problem**: frontend values are untrusted. Without independent backend
  validation, a modified request could name a source or destination outside the
  document list configured for `projectId`, as long as the user's SharePoint token
  can access it. `targetListKey`, `targetParentId`, and `targetParentPath` can also
  contradict one another. This is a project-boundary authorization risk, not only
  malformed input.
- **Product rule now implemented in the frontend**: copy/paste may cross between the
  current project's Execution and Marketing document lists, including when they
  resolve to different SharePoint sites. The frontend sends the same path-based copy
  request for same-list and cross-list destinations.
- **Backend design to decide**: prefer an id-based, list-scoped public operation,
  for example
  `POST /projects/{projectId}/document-lists/{sourceListKey}/documents/{sourceId}/copy`
  with `kind`, `targetListKey`, and `targetParentId`. The backend should authorize
  `projectId`, resolve both configured list roots, resolve each id in its corresponding
  list, verify both canonical locations are descendants of those roots, construct the
  paths itself, and only then delegate to the existing copy service.
- **If the path DTO is retained**: the backend must still resolve the configured
  source and target roots for the current project, reject paths outside them, resolve
  `targetParentId` under `targetListKey`, and require its canonical path to equal
  `targetParentPath`. Prefix checks must be normalized and segment-aware rather than
  raw string-prefix comparisons. Adding `sourceListKey` is the clearest way to select
  the source configuration without guessing from `sourceParentPath`.
- **Acceptance coverage**:
  - a modified request cannot copy from or into another project, list, library, or
    accessible SharePoint location;
  - source and destination must each resolve beneath the configured root selected for
    its domain list;
  - a mismatched target id/path/list key is rejected before the copy mutation;
  - the backend, not Angular, constructs or validates every SharePoint location used
    by the existing copy service;
  - valid same-list and cross-list copies retain the canonical KeepBoth behavior and
    response.
- **Status / priority**: unresolved backend authorization boundary (P0). The
  frontend permission to copy across lists does not close this item.

## 6. The real API answers a descendant copy with a generic 500

- **Verified 2026-11-05** against real SharePoint, by hand through Postman: the request
  returns **HTTP 500**, and **nothing is created** — no folder, no partial recursive
  copy. The question this item was opened for is answered.
- **No longer a P1.** It carried that only because an unverified generic failure might
  have left a half-finished copy behind. It does not.
- **What remains is message quality, and it is the backend's to fix.** A 500 carries no
  descendant signal, so nothing in the response can be mapped to `descendant-move`.
  `sharepoint-error.mapper.ts` classifies `>= 500` as `network`, so a request that did
  reach the server would surface as "We could not complete this action. Try again
  later." — a safe fallback, but not the truth.
  - **Deliberately not mapped in the frontend**: keying `descendant-move` off a 500
    would relabel every server-side copy failure as a descendant problem, which is
    worse than the generic message. Revisit only if the API starts returning something
    deterministic.
- **So the frontend guard is the only source of the specific message**, which is why it
  is now **case-insensitive** (`pathContainsOrEquals` in
  `utils/node-containment.utils.ts`, used by `containsNode`'s fallback,
  `FileSystemStore.targetsOwnSubtree` and `ProjectDocuments.isNodeAncestorOrSelf`).
  SharePoint addresses the same folder as `/Contracts` or `/contracts`, and the previous
  exact compare would have let a differently-cased destination past every guard.
- **Recipe for whoever adds the backend guard** (unchanged, still wanted so the API
  answers deterministically rather than with a 500): let `sourceFolderPath` be
  `sourceParentPath + sourceName`; reject when `targetParentPath` equals it or begins
  with `sourceFolderPath + '/'`. Normalize casing and separators per the existing
  SharePoint path rules, so `/Contracts2` is not treated as a descendant of
  `/Contracts`. Then record the controller location and update
  `docs/backend-operations/copy.md`.
- **Status / priority**: frontend side closed. Backend improvement open, P3 — the
  current behaviour is safe, only poorly worded.

## 7. A missed `dragend` can leave a drag session latched

- **Where**: `src/app/project-documents/services/interaction/drag-drop.service.ts` —
  `handles()` returns true whenever `state()` is set, and there is no document-level
  `dragend`/`drop` fallback.
- **Problem**: if `dragend` is never delivered — the source element torn out of the DOM
  mid-drag, or the drag ending outside the window in some browsers — the session stays
  latched and the next external file drag is routed as internal. The MIME token still
  prevents a wrong mutation; the cost is one silently lost upload. `Escape` recovers it.
- **Suggested fix**: reproduce it first. Both reviews agreed it is unproven, and a
  document-level fallback is not worth adding against a hypothesis.
- **Priority**: P3 until reproduced.

## 8. A project may initialize twice, and a late one aborts work in flight

- **Where**: `project-documents.ts` constructor — `this.fileSystem.connectProject(this.id)`
  — reaching `_beginInitialize` through `_initialize$`'s `defer` (`file-system.store.ts`).
- **Problem**: in both integration specs the store's `connectionRevision` reaches 2 for a
  single component, so `_beginInitialize` runs twice per startup. Instrumenting the
  second call shows every stack frame below it is rxjs internal — it is `connectProject`'s
  own effect firing again, not a second call site. `observeInitialFolderPath` is ruled
  out: it is `untracked` and returns early without query params, which these specs have.
- **Why it matters beyond tests**: `_beginInitialize` bumps the connection revision, and
  every guarded mutation throws `cancelled` when that happens mid-flight. A delete or
  move that overlaps the second initialization is silently discarded — correct behaviour
  given a genuine project change, but wrong if the second initialization is spurious. It
  also means two sets of root listings per project open.
- **Why it was not chased further**: it only surfaces with prolonged waiting, so the
  drag specs never see it; `project-documents-bulk.spec.ts` resolves its API
  synchronously to stay deterministic, with a comment pointing here. Confirming whether
  it reproduces outside TestBed needs the app in a real browser.
- **Suggested next step**: log `_beginInitialize` in the running app and open a project.
  If it fires twice there too, inspect how `rxMethod` subscribes to the `id` input
  signal — a required input set after `createComponent` is the most likely source of the
  extra emission.
- **Priority**: P2 — invisible today, but it makes mutations abort unpredictably and
  doubles startup reads.

## 9. A renamed folder's search results keep their old path and launch URLs briefly

- **Where**: `src/app/project-documents/services/search/document-search.service.ts` —
  `replaceResult`, and the `refresh()` that follows it in `project-documents.ts`'s
  inline rename.
- **Problem**: `replaceResult` corrects only the renamed row, from the server's own
  node. A search result *beneath* that folder keeps its old `path` and its old
  `onlineUrl` / `desktopUrl` / `downloadUrl` until the reconciling search returns —
  the full search latency, which is seconds and occasionally much worse. "Open File
  Location" navigates by that path, and Open / Download use those URLs, so both act on
  a location the rename has already invalidated.
- **Why it is this way**: descendants are deliberately left to `refresh()`. The local
  alternative is a path-prefix rewrite over the results, which existed and was deleted
  in `e8a1dc6` after producing four defects across three review rounds — including one
  that rewrote results from an unrelated document list, because the prefix test never
  compared `listKey` and the paths are server-relative.
- **Why it is not a regression**: before the deletion, those rows showed the *new* path
  with the *old* URLs, so the links were equally broken and additionally looked
  correct. The window is now self-consistent and self-healing.
- **Suggested fix**: ideally a rename response that names the affected descendants, so
  no client-side matching is needed. Failing that, blank `onlineUrl` / `desktopUrl` /
  `downloadUrl` on results beneath the renamed node — which disables the launch actions
  rather than pointing them somewhere wrong, and needs the `listKey` guard the deleted
  code lacked. Worth doing only if the window is observed to matter.
- **Priority**: P3 — bounded, self-healing, and no worse than the behaviour it replaced.

## 10. `ProjectDocuments` is 1,548 effective lines behind an eslint waiver

- **Where**: `src/app/project-documents/project-documents.ts:1`, which opens with
  `/* eslint-disable max-lines -- Existing orchestration container; split by
  responsibility later. */` against a repository limit of 500.
- **Problem**: it is the only file in the feature with no size discipline, and the
  internal drag-and-drop work added roughly 150 lines to it — selection resolution,
  bulk orchestration, the search-selection reconciliation — without paying any of it
  back. Everything in it is reachable from everything else, so each addition is cheap to
  make and the file is progressively harder to read.
- **The seam that is already clean**: the ten context-menu builders, `getContextMenu`
  through `showContextMenu` (around lines 1380–1660, roughly 300 lines). They take a
  node and a surface and return `MenuItem[]`; they depend on the stores and a handful of
  predicates, not on the container's own state machine. A `ProjectDocumentsMenus`
  service, or a plain module of builder functions taking an explicit context, would move
  them out without touching behaviour.
- **Why it was not done with the drag work**: that branch carries fifteen-plus commits of
  behaviour change that someone has to review. Burying a 300-line move inside it makes
  that review harder, not easier, and a refactor whose diff is indistinguishable from the
  feature it travels with is the kind nobody checks. It wants its own branch and its own
  "no test edits" rule, the same one the 2026-11-05 quality pass used.
- **Priority**: P3 — no defect, pure maintainability, but it compounds with every feature
  added to the container.

## 11. `no-unnecessary-condition` needs `noUncheckedIndexedAccess` first

- **Where**: `eslint.config.mjs` (the rule is deliberately absent, with a comment
  pointing here) and `tsconfig.json` (`noUncheckedIndexedAccess` is off).
- **Why it is not simply enabled**: it reports **57** problems in `src`, and **37 of them
  are correct guards it wants deleted**. With `noUncheckedIndexedAccess` off, a
  `Record<string, FileSystemNode>` lookup is typed as always-defined, so every
  `if (!entityMap()[id])` reads as "always falsy" — while at runtime those lookups do
  return `undefined` for an uncached search hit, a deleted node, or a project switch.
  Acting on those reports would remove the guards this feature depends on.
- **Measured cost of doing it honestly** (2026-11-06): turning
  `noUncheckedIndexedAccess` on drops the rule's reports from 57 to 20 but produces
  **134 TypeScript errors** — 12 in `tsconfig.app.json`, 122 in `tsconfig.spec.json`.
- **What the 20 survivors actually are**: 16 redundant `?.` (13 in specs, 3 in
  `folder-tree.ts`), two `while (true)` loops, one dead `if (listKey)` on a required
  field, and two deliberate guards against DOM and Angular-forms types that lie
  (`external-drop.service.ts:41`, `name-dialog.utils.ts:7`). **No defects.** That is the
  argument for leaving it off: it costs 134 type errors to make meaningful and finds
  nothing wrong.
- **Not actually reported by the other laptop.** This item came out of misreading a
  report of `no-nested-ternary` as this rule. It is kept because the measurement is
  real and worth having before anyone enables it. The single thing it flags in
  `project-documents-drag.spec.ts` is the `files[0]` guard, which is correct and
  must stay.
- **What would change the decision**: enabling `noUncheckedIndexedAccess` for its own
  sake, since honest index types are worth having independently. Then enable this rule
  in the same change and clear the 20.
- **Priority**: P3, and explicitly a decision rather than a defect.

## 12. Local stand-ins are looser than the real dependencies they stand for

Every local stand-in under `src/local/` and `src/services/` exists so this repo can
build without the host application. Each time one has been **more permissive** than the
real thing, the suite stayed green here and failed on first contact with the host. Three
instances so far, all the same shape:

- **`ProjectDTO` / `FolderNodeResponseAccessLevelEnum`** (resolved 2026-11-06, commit
  `ee0bfd6`): the stubs were a loose `interface` and a string union where the generated
  client has required fields and a real `enum`. Two test fixtures did not compile.
- **`HttpClient`** (resolved 2026-11-06, commit `815571e`): the container's dependency
  graph reaches `HttpClient` through the real API, which the specs never provided
  because the mock short-circuits it here. `NG0201` on every container spec.
- **`PopupService`** (resolved 2026-11-06): the stand-in was
  `@Injectable({ providedIn: 'root' })`; the library's is not root-provided and every
  consumer lists it in its own `providers`. `NG0201: No provider found for PopupService`
  on all 41 container tests.

**The rule this gives us**: a stand-in must be at least as strict as the real thing —
same injector scope, same required fields, same enum identity. A looser stand-in does not
make the tests pass, it makes them stop asking. Where the real shape is unknown, prefer
the stricter guess: it fails here, where it is cheap, instead of after migration.

**The last two were tightened the same day** (2026-11-06):
- `folderNodeResponse.ts` and `fileNodeResponse.ts` are real `enum`s now, as the
  generated client declares them. Zero breakage, as measured.
- `ProjectDTO` in `src/services/project-overview.service.ts` is an exported interface
  whose five fields are **required**. Only `name` is typed, because only `name` is read
  here; the rest are `unknown`, which is honest — their types belong to the overview
  feature and guessing them would invent a constraint the real DTO may not have.
  Required-ness is the part that carries: it keeps a bare literal illegal, so a fixture
  has to assert its shape, and an assertion compiles against both declarations. Broke
  exactly one line (`project-documents-demo.ts:27`, the local harness), as measured.

Both guards were confirmed to bite by compiling the code they are meant to reject:
`const a: FolderNodeResponseAccessLevelEnum = 'READONLY'` gives **TS2322** and
`const b: ProjectDTO = { name: 'x' }` gives **TS2739** — the same error codes the other
repo reported before the stubs were tightened.

**Status**: closed as a backlog item. What remains is the rule, which applies to any
stand-in added later: *at least as strict as the thing it stands for — same injector
scope, same required fields, same enum identity.* Where the real shape is unknown,
declare the part that is known and leave the rest `unknown` rather than guessing a type
or, worse, omitting the field.


## 13. The mock's write latency ignored its own configuration — resolved 2026-11-09

`MockFileSystemApi.latencyMs` added a fixed 200 ms ceiling to **writes** whatever the
injected config said:

```ts
const max = kind === 'read' ? this.config.maxLatencyMs : this.config.maxLatencyMs + 200;
```

Every spec in the feature — 13 files — sets `minLatencyMs: 0, maxLatencyMs: 0`, and not
one of them got it; each write took a random 0-200 ms instead. That is what produced the
flake chased down while the recycle-bin confirmation tests were being converted. Those two
specs were fixed at their own end by running the accepted callback inside the zone, where
`whenStable` waits for the tracked timer; this entry was the cause still standing behind
them.

`latencyMs` now honours the configured range for reads and writes alike, and `kind` is
gone with it. Measured: the suite went from **31.3 s to a 23.96-24.32 s band across five
consecutive runs**, a 23% drop, and the spread between runs fell to 0.36 s. All five were
277/277, so nothing was relying on the extra delay.

Demo behaviour is unchanged in character: `DEFAULT_MOCK_CONFIG` is 150-400 ms, so writes
went from 150-600 ms to 150-400 ms.

**The rule worth keeping**: a caller that configures zero latency is asking for
deterministic timing, and a mock that quietly adds its own is not a mock of anything.

> (Two former items were resolved: `initialize`'s reduce-with-spread pipeline —
> 2026-07-06, by the reactive `connectProject` refactor — and the duplicated
> template tree sections — 2026-07-08, by the tree-splitter work plus a
> follow-up: ONE parameterized `#treeSection` `ng-template` (context: `label`,
> `nodes`, built by per-list context computeds) placed via `ngTemplateOutlet`
> in both the split and single-tree arrangements. An initial version kept two
> near-identical per-list templates; a cross-session review caught that only
> placement, not definition, had been deduplicated.)
