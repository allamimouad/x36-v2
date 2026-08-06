# TODO — Open Review Findings

> Open findings from the ongoing working-tree reviews. Findings 1–2 came from
> the 2026-07-06 partial document-root / `ProjectDocuments` review; findings
> 3–6 came from the 2026-07-31 copy/paste reviews. These are deliberately left for
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

- **Where**:
  - `src/app/project-documents/stores/file-system.store.ts`, currently visible
    in `copy`: it starts the API call with the current project id, awaits the
    response, and then unconditionally inserts the returned node and adjusts
    the destination parent's child count;
  - `src/app/project-documents/project-documents.ts`, in the external-drop
    upload flow: it awaits `ExternalDropService.read(...)` before enqueuing the
    decoded files/directories, without checking that the project session is
    still the one in which the drop started;
  - `src/app/project-documents/services/upload.service.ts`: `reset()` aborts
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
  - `src/app/project-documents/services/sharepoint-file-system-api.ts`,
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

## 6. Confirm the real API rejects descendant folder copies

- **Where**:
  - `ProjectDocuments.isAncestorOrSelf` walks through the frontend entity cache;
  - `FileSystemStore.copy` enumerates only cached descendants;
  - `docs/backend-operations/copy.md` does not currently confirm that the existing
    backend copy service performs an authoritative descendant check.
- **Why verification is needed**: the normal tree flow usually has enough ancestors
  cached for the frontend to block the operation. Typed-path resolution intentionally
  returns only the target listing, however, so an intermediate ancestor may be absent
  from the cache. Both frontend guards can then miss that the destination is beneath
  the copied folder. `MockFileSystemApi` still rejects the operation because it owns
  the complete in-memory tree; the existing real backend behavior is unconfirmed.
- **Manual real-API check planned for 2026-08-01**:
  1. Create or use a disposable hierarchy such as `Contracts/Vendors/2026`.
  2. Copy `Contracts`.
  3. Open `2026` through the typed address path so the test does not depend on a fully
     expanded frontend tree.
  4. Attempt to paste `Contracts` into `2026`.
  5. Capture the HTTP status and public error body.
  6. Confirm that no folder or partial recursive copy was created anywhere.
- **Expected result**: the backend rejects the request before starting the copy and
  returns a deterministic error that Angular can map to `descendant-move`. A generic
  SharePoint failure is safe only if the copy definitely did not start.
- **If the backend already rejects it explicitly**: record the controller/service
  location, add backend coverage, and update `docs/backend-operations/copy.md` with the
  guard and error mapping. No frontend change is required for correctness, although
  the cache guards remain useful for immediate feedback.
- **If it does not reject it explicitly**: add an authoritative backend guard using
  normalized, separator-aware paths. Let `sourceFolderPath` be
  `sourceParentPath + sourceName`; reject when `targetParentPath` equals that path or
  begins with `sourceFolderPath + '/'`. Normalize casing and separators according to
  the existing SharePoint path rules so `/Contracts2` is not treated as a descendant
  of `/Contracts`.
- **Status / priority**: verification pending; potential P1 if the real backend does
  not reject the operation safely.

> (Two former items were resolved: `initialize`'s reduce-with-spread pipeline —
> 2026-07-06, by the reactive `connectProject` refactor — and the duplicated
> template tree sections — 2026-07-08, by the tree-splitter work plus a
> follow-up: ONE parameterized `#treeSection` `ng-template` (context: `label`,
> `nodes`, built by per-list context computeds) placed via `ngTemplateOutlet`
> in both the split and single-tree arrangements. An initial version kept two
> near-identical per-list templates; a cross-session review caught that only
> placement, not definition, had been deduplicated.)
