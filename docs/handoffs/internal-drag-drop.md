# Internal drag-and-drop

Implemented on `feat/internal-drag-drop` from merged `main` (`ea8bfd0`).
The feature uses the existing `FileSystemApi.move/copy` and store signatures.

## Behavior

- Drag one ordinary tree folder or table file/folder. Drop on a tree folder,
  table folder row, or unused table space (the current folder).
- Default drop moves; hold Ctrl at drop to copy. Same-parent moves are rejected;
  same-parent copies use canonical KeepBoth names, locally `name - Copy` and
  `name - Copy (2)`. There is no multi-selection, cut, or search-result dragging.
- A valid collapsed tree target expands after 700ms hover without changing the view.
  Leaving/end/cancel/drop/project changes/destruction clear drag state and timers.
- Success normally keeps the view. Moving the viewed folder or an ancestor opens
  the destination after success. Failure leaves cache/view/references unchanged.
- Roots/bins cannot be dragged. A bin receives drops and deletes (see below); deleted
  records inside one are not bins and still receive none.
- Search results are draggable, one row at a time (no multi-selection outside the
  right-pane table). Multi-selection in the table is implemented.
  Readonly/protected sources can be copied to a writable target. Moves additionally
  require an editable source and writable source parent/list. Protected targets
  allow contents; readonly targets/lists do not. Self/descendant/busy/unavailable
  targets and overlapping writes are rejected; checks repeat at drop.
- A custom MIME token and active component/project session authorize the drop.
  Internal gestures take precedence over external `Files`; external uploads retain
  their previous flow. No new dependencies are required.

## Files to transfer

Copy the new drag model, policy/service, `utils/node-containment.utils.ts`, their
specs, and the changed container,
tree, table and filesystem store. The new service is component-provided alongside
the existing stores/clipboard/notification services. Child components remain dumb.
PrimeNG `rowTrackBy` / tree `trackBy` keep source DOM elements alive during loading.
Native drag start/end propagation is stopped before PrimeNG's disabled DnD
handlers can cancel or replace the feature's drag behavior.
The filesystem store adds a private connection revision around move/copy; public
method signatures and return types remain unchanged. Move finds the removed cached
subtree at completion, including descendants resolved without cached ancestors or
loaded while the request was pending, so their references are pruned too.

Keep the destination's working SharePoint adapter, generated `@api` services/models,
mappers, providers, shared popup integrations and project overview service, following
[the synchronization handoff](pr-sync.md). The bin `slice(3)` display formatter and
broad current-bin activation guard are unchanged by this work. Existing permission
gaps outside internal drag-and-drop are not expanded into this task.

## Backend follow-up

`move(projectId, sourceNode, destinationFolder)` and `copy(...)` each return one
canonical `FileSystemNode` Observable. Source and destination provide their own
list keys and opaque IDs. Return the persisted parent ID, list key, ID, path, name,
access flags and folder child count. A cross-list move may return a changed ID;
the store removes the old cached subtree and inserts only the returned node.
Copy must resolve collisions using KeepBoth and return the canonical name/ID.

The local mock implements both operations across Execution/Marketing. The local
SharePoint move method remains unimplemented; no backend endpoint or actual
cross-site support is inferred from this UI. On the backend machine, confirm the
existing endpoint/generated client and implement the adapter using the established
authentication, error mapping and returned-node mappers. Verify real permissions,
collision behavior, cross-list/site capability, and a folder move with descendants.

## Desktop acceptance

Use a desktop Edge/Chrome session to check move/copy/no-drop cursor icons and
Escape while holding the mouse, including after hover expansion. The headless CDP
check did not deliver key or dragend events for its emulated Escape cancellation;
physical-input details therefore still require desktop confirmation. Automated DOM Escape/dragend
cleanup and the policy/session/mutation behavior are covered by tests.

## Reviewed fixes (2026-10-27)

A code review of the uncommitted feature found five issues. Three are fixed here.

- **Hover expansion no longer invalidates its own target.** `NavigationStore` gained
  `expandWithoutReload`, used by the 700ms expansion: it skips the refetch when
  `folderIdsWithLoadedChildren` already holds the folder. Plain `expand` still always
  refreshes, so user-initiated expansion is unchanged. `FileSystemStore` now reuses the
  children load already in flight for a folder and exposes `pendingChildrenLoad`, so a
  drop onto a folder loading for the first time awaits that listing and re-checks before
  mutating — which also keeps the listing's stale-entity pruning from removing the node
  the drop just added. Drop feedback (`canDropOn`) deliberately ignores an in-flight
  load so the highlight does not flicker; the drop's own check does not.
- **Paste no longer reports a successful copy as cancelled.** `reportPasteFailure`
  swallows `FileSystemError('cancelled')`, which the store throws when the project
  changed mid-request. The store's connection guard is unchanged.
- **The current-folder space only invites a drop the policy accepts.** New
  `internalCurrentFolderDropActive` computed, bound to a new `FileTable` input. It is
  separate from `internalDragActive` on purpose: that input also routes drag events and
  must stay true for the whole gesture.

Transfer these with the feature: the changed `navigation.store.ts`, `file-system.store.ts`
(in-flight load map, `pendingChildrenLoad`), `drag-drop.service.ts`, container and
`file-table` input, plus the new `file-system.store.children-load.spec.ts` and the two
new drag specs.

A follow-up review found that the in-flight load map introduced above initially had no
lifecycle, and that is fixed too. It replaced a guard that read
`folderIdsWithLoadingChildren` — state that `_beginInitialize` resets — with a closure
map keyed only by folder id, so a request issued before a reinitialization kept
answering for its folder: the next expand, navigate or refresh of that folder returned
the old promise and issued no request. The map now clears in `_beginInitialize`, a
settling request deletes only its own entry (entries are boxed so cleanup can check
identity, since a newer load may already own the id), and that deletion happens in the
same `finally` as `_unmarkLoading` so the marker and the map cannot disagree — a window
in which a caller gated on the marker would otherwise receive an already-settled
promise instead of a fresh fetch. Entries are cleared rather than keyed by connection
revision: after `_beginInitialize` every entity is gone and folder ids are re-resolved,
so no later caller should reuse an earlier load.

A discarded children load is now inert in every respect. Releasing the loading marker
is owner-only, inside the same ownership check as the map entry: previously
`_unmarkLoading` ran unconditionally, so an old request settling after a
reinitialization cleared the *replacement* request's marker. That one predates this work
— the committed original clears it the same way — but the drag path depends on the
marker, since `pendingChildrenLoads` filters by `folderIdsWithLoadingChildren` and the
policy folds it into `unavailableIds`; a false clear would make a folder look droppable
while its listing was in flight and stop the drop from awaiting it. `_loadChildren` also
captures `connectionRevision` up front and skips both post-await writes when it moves,
so a discarded request no longer inserts its listing (nor marks the folder loaded) or
records its error against the connection that replaced it. The revision is compared
directly rather than through `_checkConnection`, whose `cancelled` throw would land in
this function's own `catch` and be stored as a folder error.

Two issues are deliberately open. A missed `dragend` can leave a session latched, since
there is no document-level `dragend`/`drop` fallback — the MIME token still prevents a
wrong mutation, the cost is one silently lost external upload, and `Escape` recovers it;
reproduce it before adding the fallback. Separately, `connectionRevision` guards only
`move`, `copy` and now `loadChildren`: `createFolder`, `rename` and `deleteNodes` still
patch state after their awaits. That gap predates this feature and belongs in its own
commit.

## Multi-item drag (2026-10-28)

A drag now carries a set. Grabbing a row inside the table selection drags the whole
selection; grabbing one outside it drags that row alone, and the tree stays single-item.

- The set is collapsed to its **top-most ancestors** (`topMostNodes`, beside
  `containsNode`). A selection holding a folder and something inside it drags the folder
  only — otherwise the folder moves first and the descendant's path changes underneath
  its own queued request.
- Validation is set-wide at both ends: if any item cannot be dragged, or cannot be
  dropped on the target, the whole gesture is refused. Silently filtering would move
  part of what the user grabbed and explain nothing.
- Execution loops the **single-item** `FileSystemStore.move`/`.copy` through the existing
  `ConcurrencyQueue` at `bulkOpConcurrency`, each item's failure isolated. This
  supersedes the PHASES line about the store accepting arrays; see PHASES for why.
- A move prunes per item but decides **once** whether the viewed folder went with the
  batch and should open the destination.
- Partial failure never rolls back: successes are already applied, and undoing them
  would mean issuing deletes that can fail in turn. One summary reports the batch, and
  for a move it names what stayed in place, since the selection is now split across two
  folders.
- Selection itself is new (`select`, `setSelection`, `clearSelection`, plus a
  `selectionAnchorId`), cleared whenever the viewed folder changes. The table resolves
  Shift-ranges against its rendered order — see SPEC 3.7.
- While several rows are selected, single-item Rename/Copy/Delete are disabled.

Transfer with the feature: the changed `navigation.store.ts`, `drag-drop.service.ts`,
`drag-state.model.ts`, `node-containment.utils.ts`, the new
`models/selection-request.model.ts`, the table/tree `internalSourceIds` input, the
container wiring, and the new selection and multi-drag specs.

A queued batch item is no longer issued after the project changes. `performOne` checks
`isCurrentProject` **before** touching the store, not only after the queue drains: a
selection larger than `bulkOpConcurrency` leaves the overflow waiting, and a project
reinitialization while it waits must stop it going out. Abandoned items are marked and
filtered out before the summary and the move bookkeeping, both of which read a missing
error as success. Nothing is reported — a toast about the previous project would land
while the new one is on screen — and the items that never ran simply stay where they
are, so re-selecting and dragging again is the recovery.

The same check covers this component being destroyed, since `isCurrentProject` already
includes `destroyed`. `ConcurrencyQueue` needs no cancellation, so uploads are untouched.

Two limits worth keeping in mind. Requests already **sent** cannot be recalled: their
results are discarded by `connectionRevision`, so a batch interrupted mid-flight can
still end up half-applied, silently and by design. And every caller currently has to
remember this kind of check for itself — `move`/`copy` guard their results,
`createFolder`/`rename`/`deleteNodes` still do not, and the batch needed its own. If
project switching becomes routine, the systemic fix is for the store to own connection
scoping: callers capture a connection token and mutations refuse at entry. That would
close the deferred gap in the same stroke. Bulk paste will need the per-item guard too,
the moment paste loops through the queue — today it is single-node, so it has no
queue to go stale.

## Drag to the recycle bin (2026-11-01)

Dropping on a bin deletes. `DropIntent = 'move' | 'copy' | 'delete'` is resolved from
the **target**, not the keyboard; `DragEffect` stays move/copy because it is assigned
straight to `dataTransfer.dropEffect`, and a delete still shows `move` since the item
leaves. Ctrl keeps the intent at `copy`, which a bin cannot satisfy, so the policy
rejects it instead of deleting something the user asked to copy.

Only the bin of the source's own list accepts the drop: `FileSystemApi.delete` takes no
target and the backend routes the item to its own list's bin regardless of which was
aimed at, so any other bin would show the item going somewhere it will not go.
`canDeleteItem` and `canMoveItem` share `canLeaveParent`, so a delete refuses exactly
what a move out of the same parent would refuse.

`FileSystemStore.delete` now returns the cache ids it removed, as `move` does. That fed
the batch's pruning and removed the duplicate subtree walk the container kept; the queue,
per-item failure isolation, abandoned-item guard and summary all applied unchanged.
`finishBatch` replaces `finishMove`: when a delete takes the viewed folder it opens that
item's **parent**, matching the context-menu delete, since a bin is not somewhere to
open.

One wiring trap, worth knowing if a drop ever seems to do nothing: the tree renders bins
through a separate template branch which carried `dragenter`/`dragover` but **no
`drop`**. The target highlighted and the drop vanished. That branch now has a `drop`
binding, and `onExternalFolderDrop` turns away external file drops with
`isNodeDroppable` — previously the missing binding did that job implicitly.

Known gap: `deleteNode` refreshes an active search, the drag path does not, and the move
path never did either. Deleting by drag while a search is open leaves a stale result row,
exactly as moving by drag already does. It belongs with search work, not here.

Still deferred: bulk delete from the context menu, which stays disabled on a
multi-selection, so the menu and the drag disagree — it needs a bulk confirmation of its
own. Dragging *out* of a bin to restore is deliberately absent:
`restoreRecycleBinItem` returns an item to its original location, not the drop target.

### Store fixes that drag-to-bin exposed (2026-11-01)

Both were pre-existing limits of `delete`, reachable far more easily once a drag could
delete a whole selection.

- **`delete` discarded nothing on a stale connection.** `move` and `copy` capture
  `connectionRevision` and call `_checkConnection` after their request; `delete` did
  neither, so a late response still edited the refreshed cache. The visible symptom was
  not in the drag path — `perform`'s project check already short-circuits `finishBatch` —
  but in the container's `deleteNode`, which compares a pre-await `currentId` against the
  returned ids and could `navigateTo` a parent belonging to the project you just left.
  `delete`, `createFolder` and `rename` now all capture and check the revision.
- **`delete` left descendants behind.** It snapshotted its subtree *before* the request
  using parent links only, so it missed descendants loaded while the request was in
  flight and descendants whose intermediate parents were never cached. Those survived as
  orphans holding clipboard and selection references. It now resolves the set *after*
  the request through the shared `removedSubtreeOf`, which `move` already used — the two
  no longer differ — and uses `clearRemovedFolderMarkers` rather than a bare
  `_unmarkLoaded`.

- **A folder listing could resurrect a deleted subtree.** `_loadChildren` discarded a
  response whose connection had changed, but a delete does not bump the connection
  revision — so a listing still in flight when its folder was deleted applied anyway,
  reinserting the removed nodes as orphans and marking a folder that no longer exists as
  loaded. It now also checks the folder is still cached before applying.

Because `_checkConnection` throws `cancelled`, adding it to three more mutations would
have produced three new false-error toasts for operations that actually succeeded — the
bug already fixed once on the paste path. `reportPasteFailure` is therefore generalised
to `reportMutationFailure`, and create, rename, delete and paste all report through it.

## Drag from search results (2026-11-03)

The blocker was never the backend — `api.move` takes a node — but four client-side cache
assumptions. Search results live in `DocumentSearchService._results` and never enter
`FileSystemStore`.

The substantive one was the policy requiring the item's **parent** to be cached, to check
whether that folder was read-only. That turned out to be the only parent permission check
in the app: every other gate reads the item's own access, the current folder, or the
list. So the drag was the outlier, and it is now aligned — `canLeaveParent` became
`isMutable` (item and list only) and `canStartDrag` no longer needs the parent. The
search blocker disappeared as a consequence rather than through a special case.

The rest followed: the session keeps a `sessionNodes` snapshot so an uncached source
survives the gesture, and `move` accepts a node as `copy`/`delete`/`rename` already did.
The part that is easy to miss — `performOne` had to pass the **node** rather than
`node.id`, or `_mutationNode` resolves through the cache and throws `not-found`.
Widening `move` alone changed nothing while the caller still passed an id.
`targetsOwnSubtree` now serves both `move` and `copy`, so an uncached folder dropped into
its own subtree is still refused through the path comparison.

Trade recorded with the user: if a file inside a read-only folder is ever returned
without its own read-only flag, the drag is offered and the server refuses — the same
behaviour the context-menu delete has always had.

Stale result rows are handled by `DocumentSearchService.pruneReferences`, called in
`finishBatch` beside the navigation and clipboard ones. Scoping by removed ids is right
per intent on its own: delete and move remove ids so the row goes, copy removes none so
the list is untouched. The search is **not** re-run — it can take seconds, and re-running
it after every action was the thing to avoid. This also closes the stale-search gap for
move and copy from the tree and table.

## Review fixes, and one strategy change (2026-11-04)

A review raised five issues; all five were real and all are fixed. One prompted a
broader change the user asked for.

**Search results are now maintained from operation results everywhere, never by
re-running the query.** Previously rename, single delete, bulk delete and paste called
`refreshActiveSearch()` while the drag pruned by id — two strategies, and the drag's
had a hole: `removedSubtreeOf` only reports cached nodes, so an uncached search hit
produced no ids and its row survived a successful delete. Rather than give the drag a
refresh too, the pruning approach won everywhere: it costs no query, and it is *more*
accurate than a refresh for a move, which a refresh would re-show at its new path
inside a result set the user did not ask for. `refreshActiveSearch` is gone;
`DocumentSearchService` gained `replaceResult` for rename, and pruning now includes the
operation's own source ids. Only operations that take something away prune — a copy
prunes nothing, or it would clear its own clipboard entry.

The other four:

- **A confirmation could outlive its project.** `requestBulkDelete` now captures the
  session guard when the dialog opens, not when it is accepted, so confirming after a
  project switch does nothing instead of sending the old project's nodes.
- **The menu's session guard ignored component lifetime.** It now checks a `destroyed`
  flag as the drag guard always did, so navigating away stops queued work.
- **A cut-paste could leave the view on a removed folder.** `runPaste` now applies the
  same affected-view handling as a drag: if the move took the viewed folder, the
  destination opens.
- **A finishing cut-paste could clear a newer clipboard.** It now clears only when the
  clipboard still holds exactly what that paste consumed.

### Follow-up round (2026-11-04)

Four more findings, all real, all fixed. Two shared one missing capability: a search
result's **descendants** are uncached results of their own, and nothing related them to
an operation on their ancestor.

- Deleting a folder left its children's rows, because an uncached folder contributes no
  removed ids and only its own id was pruned. `pruneReferences` now also takes the nodes
  the operation acted on and drops results whose path sits beneath them.
- Renaming a folder left its children's paths stale, which "Open File Location" then
  navigated by. `replaceResult` became `applyRename`, rewriting the path prefix of
  results underneath, mirroring the store's `_updateCachedSubtreePaths`.
- A cut-paste read the viewed folder from when it *started*. Opening a child of a moving
  folder mid-paste made that child the one removed, and the stale check missed it. The
  move already resolves removals at completion, so reading the view there is enough.
- The clipboard guard compared ids, so re-copying a file that was mid-cut passed it. The
  explicit clear and its comparison are **deleted** rather than replaced with version
  tracking: `ClipboardService.pruneReferences` already drops what actually moved, so a
  full cut empties the clipboard, a partial one keeps exactly the failures for a retry —
  better than clearing — and a clipboard taken during the paste is untouched.

### Search reconciliation, revised (2026-11-04)

The 30-second search turned out to be an edge case rather than the norm, so one request
per mutation is affordable — which changes the calculus behind the local-only strategy
below.

The premise that prompted the change was wrong, and worth recording: the local
maintenance was *not* expensive. It ran once per operation at a `Set` lookup plus one
prefix compare per folder. The costly thing was the per-row drag policy, unrelated and
already fixed.

The real argument is **defect density**. Local maintenance produced four defects across
three review rounds — uncached sources contributing no ids, uncached descendants missed,
rename leaving descendant paths stale, and source ids in the shared prune clearing a
copy's own clipboard. A refresh has one failure mode, latency.

So `DocumentSearchService.refresh()` re-runs the last submitted search after every
mutation, and the path-prefix matching is **deleted**: `pruneReferences` is ids-only
again, `applyRename` is back to an id-only `replaceResult`, and the `removedRoots`
plumbing is gone from `BulkOperationService` and its callers. The id prune and
`replaceResult` stay because they are two lines each and give instant feedback on the
row the user touched.

Two details that matter. `refresh` must **not** blank the list — `search()` does
`_results.set([])` up front, and doing that on a refresh would trade one stale row for
an empty table for the length of the query; both paths now share a private `run` with a
`reset` flag. And no container seam was needed after all: the service remembers its own
project id, scope and query, so the drag service — which already injects it — calls
`refresh()` directly, dissolving the seam problem recorded earlier as a blocker.

### Cost of maintaining results (2026-11-04)

Prompted by asking what the search path now costs per operation.

Pruning is cheap and deliberately so: it runs **once per operation**, not per item — a
single pass doing a `Set` lookup plus one prefix compare per folder in the batch, and it
writes the signal only when something changed, since a write re-renders the table.

Marking search rows draggable was not. `draggableSearchResultIds` called a per-node
`canDrag`, and `policy()` scans every cached entity to find the recycle bins — so it was
O(results x entities), rebuilt on every signal `policy()` reads, which includes
`pending` and therefore **every drag start and end**. `canDrag` is now `draggableAmong`,
taking the whole list and building the policy once, as `draggableIds` always did for the
tree and table. A test pins that intent by counting `entityMap` reads, because nothing
else would stop the per-row form returning.

### Third review round, retired by the deletion (2026-11-05)

A further three findings arrived from the other session, written against `76101fa` —
the commit that introduced the path matching. All three were verified real against that
commit, and all three are gone as of `e8a1dc6`, which deleted the construct they live in
rather than fixing them one by one:

- a copy pruned the source folder's children from the results, because the paste handed
  its source nodes to `pruneReferences` as removed roots unconditionally, even though it
  correctly passed an empty `removed` array;
- `applyRename` rewrote a descendant's `path` but left its `onlineUrl` / `desktopUrl` /
  `downloadUrl`, while the store clears exactly those three for the same case in
  `_updateCachedSubtreePaths`;
- neither prefix test compared `listKey`, and the paths are server-relative, so two
  document lists with identically-named trees would prune or rewrite each other's rows.

That makes four review rounds and seven defects attributable to maintaining the result
set locally, which is the record the deletion was argued from.

One residual is recorded rather than fixed, as `docs/TODO.md` item 9: between a rename
landing and the refresh landing, a descendant row shows its old path and old launch
URLs. Not a regression — it previously showed the *new* path with the *old* URLs, so the
links were equally broken and better disguised — and the only local fix is the
path-prefix sweep just deleted, including the `listKey` guard it lacked.

### Fourth review round: three real bugs in the refresh itself (2026-11-05)

The round that retired the path matching introduced three of its own, all confirmed in
code and all fixed.

**`clear` kept the submitted search.** It unsubscribed but left `lastSubmitted`, and
`clear` runs on every navigation away from a search (`observeSearchHistory` →
`resetSearchState`), so the dead query was retained constantly. A later mutation's
refresh then re-ran it — against the previous project's id after a switch, since the
service outlives one project. The sharp part is downstream: the revived `activeQuery`
and `activeScopeId` are exactly the two fields the container's `alreadyLoaded` check
compares (`project-documents.ts:1240`), so re-entering the same search on the same
folder was **skipped** and those rows were shown instead — another project's documents
rendered as this one's results. One line: `clear` now forgets the search.

**Drag-copy never reconciled.** `perform` guarded `if (intent !== 'copy')` around
`finishBatch`, which is the only caller of `bulk.pruneReferences` and therefore of
`refresh`. Paste-copy called it with an empty array and did refresh, so the two copy
paths had diverged. Copy now goes through `finishBatch` like everything else, with
`removed` computed as `[]` for a copy — pruning its sources would drop the rows of the
items it just duplicated, which is the previous round's first finding reintroduced. Two
things had to move with it: `viewWasTaken`'s containment clause fires for a view inside
a *copied* folder, since the source survives, so a copy is excluded from the navigation
decision outright.

**The refresh hid the results anyway.** `[loading]="search.isSearching()"` fed a
template that replaces the whole table with "Searching…", so `reset: false` preserved an
array nothing rendered — the user saw precisely the empty table the flag existed to
prevent, for the full query. The service now exposes `isRefreshing` alongside
`isSearching`; `loading` is bound for the initial run only, and a refresh renders a
non-blocking "Updating results…" line above the live table with `aria-busy` set.
`searchStatusText` had the same conflation and keeps its result count during a refresh.

**The lesson worth keeping.** The test covering the previous round asserted
`service.results()` stayed populated. Right property, wrong layer: it passed while the
screen was blank. A claim about what the user sees needs an assertion at the rendered
level, so the covering test for this one submits a search, deletes a row, holds the
re-query open and asserts the surviving row is still in the DOM
(`project-documents-bulk.spec.ts`).

### Selection cleared on the search boundary (2026-11-05)

Prompted by asking why the search table has no multi-selection. It has none because it
was scoped out when selection was built — at that point even the table had no bulk
actions — and because `selectedNodes` resolves ids through `fileSystem.entities()` while
a search hit is never cached, so a search selection would resolve to zero nodes in every
bulk action. That is recorded, not fixed.

What was fixed is the rule underneath it. Every change of view starts with a fresh
selection, enforced in `_clearedSelection()`, and every folder path honoured it —
`navigateTo`, `up`, `back`/`forward` via `_goToHistory`, `openResolvedFolder`,
`initialize`. Two paths skipped it, both on the search boundary: `openSearch` patched
history, index and error but not the selection, and `exitSearch`'s in-place branch
patched only history. Invisible today because nothing in the search view reads the
selection, and a live bug the moment one does.

Note on the second one: `exitSearch`'s in-place branch is **unreachable** through the
public API. Index 0 is always a folder entry — `initialize` writes one, `navigateTo` and
`openResolvedFolder` append folder entries after a truncation, `openSearch` appends after
a folder entry or replaces at an index above 0 — so `exitSearch` always finds a previous
entry and goes through `_goToHistory`. The clear is added there for consistency and
carries no test, because none can be written without reaching past the store's API. The
new test covers `openSearch`, which is reachable, and pins `exitSearch`'s reachable
branch alongside it.

### Multi-select in the search table (2026-11-05)

Prompted by asking why it did not work. It had been scoped out when selection was built
— the right-pane table had no bulk actions then either — and it was not a cheap
extension afterwards, for one reason worth keeping: **two places resolved a selection
through the cache, and a search hit is never cached.** `selectedNodes` filtered
`fileSystem.entities()`, so a search selection resolved to zero nodes and every bulk
action silently did nothing; `dragSet` mapped the ids through `entityMap()` and refused
the whole gesture when one was missing.

The ids themselves were never the problem: `NavigationStore` holds one surface-agnostic
`Set<string>`.

**Why the results are not simply cached.** Inserting search hits into `FileSystemStore`
would make everything that resolves ids through the cache work for free, now and later.
It would also corrupt the right-pane table: `currentFolderChildren`
(`navigation.store.ts:165`) is a computed that takes every entity whose `parentId`
matches the viewed folder, with no check that the folder's listing was ever fetched. A
search that found `/A/B/report.pdf` would make that one file appear on opening `/A/B`,
showing 2 of 50 files as the whole folder. So the cache keeps meaning "things we have
listed", and resolution falls back to the surface instead — `selectedNodes` reads
`search.results()`, and `ItemDragRequest` carries `selectedNodes` beside `selectedIds`.
A selection naming something neither source knows is still refused: stale is not the
same as uncached, and that guard is what the rejection was written for.

`resolveSelection` and `renderedRangeTo` moved out of `file-table.ts` into
`utils/selection.utils.ts`, so both tables share one implementation and each passes its
own rendered ids — which is what keeps a Shift-range in the current sort order.
`isMultiSelected` became `source !== 'tree'`, and because `requestDelete`,
`copyToClipboard` and `cutToClipboard` already branch on it, the existing search context
menu started acting on the whole selection with no further change; only Rename needed
the multi guard the table already had.

Two deliberate differences from the table: Enter/Space still **opens** a search result
rather than selecting it, and Paste is not offered there, as that surface has no target
folder.

A search selection may span document lists, since one result set can. Accepted
asymmetry: the menu Delete works across lists, each item routed to its own bin, while a
mixed set dragged onto a bin is refused as a whole. Not worth relaxing the bin policy
for until someone hits it.

**Still unverified in a real browser.** Click-and-drag is the one part the headless suite
cannot judge: Ctrl and Shift ranges across sorted columns, dragging a search selection
into a tree folder, Ctrl-drag to copy, and the two mixed-list outcomes above.

### Deselecting did not look like deselecting (2026-11-05)

Reported from manual use: Ctrl-clicking a selected row left it looking selected, and
clicking outside the rows did not appear to clear anything — while a drag correctly
acted on the right items. The diagnosis in the report was right: the state was correct
and only the paint was wrong.

One cause behind both symptoms. `file-table.scss` gave `pd-row-focused` and
`pd-row-selected` the **same** `--pd-selection-bg`, and `onRowClick` focuses on every
click, so the row just clicked was always painted as selected whether or not it was:

- Ctrl-click to deselect removed it from `selectedIds` but focused it, so the fill
  stayed;
- clicking the empty space called `clearSelection`, which cleared `selectedIds` and the
  anchor but **not** `focusedId`, so the last-clicked row kept the fill.

A third instance nobody had reported: recycle-bin rows only ever focus — `onBinRowClick`
emits no selection — so a bin row looked selected even though a bin cannot be selected.

Fixed in two places. Selection keeps the background fill; focus now gets only the inset
accent edge that the combined `selected.focused` rule already used, which also keeps the
focused row findable inside a block of selected ones. And `clearSelection` clears
`focusedId` too, which additionally removes an asymmetry: right-clicking the empty space
already cleared focus (`project-documents.ts:572`) while left-clicking it did not.

`focusedId` is read for exactly one thing — that class — so widening what clears it
carries no other behaviour.

The covering test asserts the **computed background colour**, not the class list: the
classes were always correct, so a class assertion would have passed throughout the
defect. It has to set the theme custom properties on the host first, because they come
from an ancestor in the running app and otherwise every colour resolves to nothing and
the comparison passes for the wrong reason.

The search table never had this: it has no focused class, and its hover colour
(`#f0f1f2`) is plainly distinct from the selection fill (`#e8f4ef`).

### Descendant guard made case-insensitive, and item 6 answered (2026-11-05)

You tested the real API by hand through Postman: copying a folder into its own
descendant returns **HTTP 500** and **creates nothing**. That closes `docs/TODO.md`
item 6, which had been open since July, and closes it in the "the backend does not
reject explicitly" direction.

Two conclusions, one of them a reversal of what I had planned.

**No mapper change.** I was going to add a `descendant-move` case to
`sharepoint-error.mapper.ts`. There is nothing deterministic to key on: a 500 carries no
descendant signal, and keying the code off it would relabel every server-side copy
failure as a descendant problem — worse than the generic message it would replace. For
the record, `isNetworkFailure` classifies `>= 500` as `network`, so such a response
surfaces as "We could not complete this action. Try again later.", which is a safe
fallback.

**The frontend guard is therefore the only thing that can ever produce the specific
message, so its remaining hole mattered.** The path comparison was case-sensitive, and
SharePoint addresses the same folder as `/Contracts` or `/contracts`. It is now one
helper, `pathContainsOrEquals` in `utils/node-containment.utils.ts`, used by
`containsNode`'s path fallback (which feeds the drag policy's drop decisions),
`FileSystemStore.targetsOwnSubtree` and `ProjectDocuments.isNodeAncestorOrSelf`. Only
the comparison is normalized; a stored path is never rewritten, because a guard that
edits identity can end up disagreeing with the server about which folder it means. The
trailing slash stays — it is what keeps `/Contracts2` from reading as a child of
`/Contracts`.

Item 6 also carried two stale claims, now removed: that both frontend guards were
cache-only. They have compared paths since the drag work, so the typed-path scenario the
item was written about was already covered — the casing was the only part still open,
and the item had itself predicted it by asking for normalized casing.

The store-level test is the one worth keeping in mind: it moves an **uncached** source,
because that is the only shape where the cached-subtree check finds nothing and the path
comparison is the sole guard — which is exactly a dragged search result.

### Two consequences of search multi-select (2026-11-05)

Both found by review, both real, and both reachable only because search rows became
selectable in `51b7392`.

**A bulk action treated a folder and its own child as two items (P1).** `topMostNodes`
existed and was used in exactly one place — `dragSet`. `selectedNodes` never collapsed,
and it feeds bulk delete, copy and cut. Until search multi-select this could not happen:
the right-pane table lists one folder's children, so its rows are always siblings. A
result set is recursive, so `A` and `A/report.pdf` can both be rows. A cut then moved
both independently and pulled the file out of the folder it was travelling with; a copy
duplicated it, since the server copy of `A` is already recursive; a delete removed the
subtree and then failed on the child, reporting "1 of 2 items deleted". The telling part
is that the **drag already collapsed**, so the same selection behaved differently
depending on the gesture.

Collapsing now happens in `selectedNodes`, not inside `BulkOperationService.run` — the
other candidate chokepoint. Callers build their counts and confirmation text from their
own list, so collapsing below them would make the summary disagree with what ran. One
consequence to keep in mind: `requestBulkDelete` is only reached with more than one row
selected, but after a collapse its list can hold one, so it needed a singular message.

**A selected row could survive its own disappearance (P2).** A re-query drops a row that
no longer matches; its id stayed in `selectedIds`, and if the node was cached — renaming
through the tree caches it — both `selectedNodes` and `dragSet` resolved it happily. The
user acted on something not on screen. Rename is just the easiest repro; any refresh does
it.

Three changes, deliberately overlapping, because this is a class of bug rather than one
path: the container reconciles the selection against the current result ids
(`observeSearchSelection`); `selectedNodes` resolves from the **active surface only**
instead of merging cache-then-results, which makes a hidden row unresolvable rather than
absent (and the merge only ever covered a selection spanning both surfaces, which cannot
happen since `9804667` clears it on entering and leaving a search); and the search surface
reports only the ids it is showing when a drag starts.

**One of my own tests had to be repaired, and it was wrong rather than inconvenient.**
`deletes a whole selection of search rows the cache never held` drove
`DocumentSearchService.search` directly without opening a search through navigation, so
`searchActive()` was false — a state the app cannot produce, since search rows are only
selectable while that surface is up. It now goes through `navigation.openSearch` and
selects afterwards, because entering a search clears the selection. Its two hits also
shared one path; they are proper siblings now.

### Quality pass (2026-11-05)

Asked for a quality review rather than a bug hunt, since the other reviews only looked
for defects. Six findings, two of them mine from this branch. Behaviour unchanged: the
suite stayed at **258 with no test edits**, which was the condition set in advance — a
refactor needing its tests rewritten has changed behaviour.

**The duplication I had walked past.** `file-table.ts` and `search-results.ts` carried
`fileNameParts` **byte-identically** (`diff` confirmed), while `naming.utils.ts` already
had a private `splitExtension` splitting a filename a third time. Earlier the same day I
had extracted `resolveSelection` into a shared util on the explicit reasoning that both
tables need identical behaviour — and left the larger duplication beside it.

Now one `splitFileName` in `naming.utils.ts`, plus `editableName` and `submittedName` for
the two pieces of the inline-rename block that carry logic. The rest of that block — the
`viewChild`s, the focus effects, the three-line emitters — stays duplicated **on
purpose**: `viewChild` and `effect` belong to the component owning the elements, and
extracting thin emitters buys indirection rather than meaning. Of ~70 duplicated lines,
about 20 were worth sharing.

One behavioural consequence, stated rather than smuggled: the unified split treats a
trailing dot as part of the name, so inline-renaming a file called `report.` keeps its
dot instead of silently dropping it. `resolveNameCollision` already behaved this way.

**Three ancestry implementations became one.** `isAncestorOrSelf` in `path.utils.ts` was
exported and imported by nobody — deleted. The container's private `isAncestorOrSelf` and
`isNodeAncestorOrSelf` reimplemented `containsNode` and more weakly: no cycle guard,
where `containsNode` keeps a `visited` set. The paste guard now calls `containsNode`
directly, and both private helpers are gone. The one semantic difference —
`containsNode`'s path fallback is strictly beneath, since equality is settled by the id
walk — is unreachable, because two nodes cannot share a path, and that is recorded at
the call site rather than papered over.

**`BulkOperationService.pruneReferences` → `reconcileAfterBatch`.** It pruned three
caches *and issued a search request*; the old name promised cache bookkeeping. Four call
sites.

**One finding settled against my own preference.** I had shipped three overlapping
guards for the hidden-row invariant and called it defence-in-depth. Removing the drag's
visible-ids intersection failed only the test I had written for it — circular evidence,
so it is not load-bearing given the reconciliation effect. It is kept, but the comment now
says the honest reason: a component should not forward an input it can see is stale. It is
no longer claimed to be closing a gap.

**Declined, and recorded as `docs/TODO.md` item 10.** `project-documents.ts` is 1,548
effective lines behind an eslint waiver that says "split by responsibility later", and
this branch added ~150 of them. The clean seam is the ten context-menu builders, ~300
lines. Doing it here would bury fifteen commits of behaviour change under a move nobody
could review separately.

Still open from the earlier passes: the tests reach into protected members five times via
`as unknown as` in `project-documents-bulk.spec.ts`, which is now 416 effective lines and
the catch-all for everything container-level, and every test there pays `settle()`'s
three-round render loop — a workaround for item 8.

### Second quality round (2026-11-05)

A further four suggestions came back. Three were right and are applied; one was half
right.

**`BulkOutcome` is now a discriminated union** — `done | failed | skipped`, replacing
optional `error`/`abandoned` flags. The old shape was only expressible as a convention:
a missing error meant success, and every caller had to strip skipped items first or count
them among the successes. The pair

```
const settled = outcomes.filter((o) => o.abandoned !== true);
const done = settled.filter((o) => o.error === undefined);
```

appeared three times across two files, and `report` filtered on `error` alone, trusting
the caller to have done the first half — forget it and a batch where nothing ran reports
"3 items were deleted". The comment that used to sit above it ("both helpers below read a
missing error as success") was a comment compensating for a weak type.

`report` now drops skipped items itself, `doneOf` is the one way to get the items that
ran, and `removed`/`error` exist only on the statuses where they mean something. The
compiler flagged every site that had relied on the convention. **No test changes were
needed**, which is the evidence that the union is behaviour-preserving.

**`naming.utils.ts` had no spec at all.** `validateName` and `resolveNameCollision` were
never covered, and the previous commit added three more functions to that file *and*
changed trailing-dot behaviour while noting "no test covered it either way" — then did
not add one. Sixteen tests now cover extensions, dotfiles, trailing dots, blank rename
input, the validation reasons and collision suffixing. Reverting the trailing-dot rule
fails exactly its own test.

**The container's batch-lifetime guard is no longer covered by inspection.** A new
`project-documents-lifetime.spec.ts` pins `bulkOpConcurrency` to 1 — the default is 4, so
a two-item batch in the existing spec issues both at once and leaves no window to observe
— destroys the fixture between the two items, and asserts the second delete never goes
out. Removing `!this.destroyed` from `projectSessionGuard` fails it. It is a new file
rather than more of `project-documents-bulk.spec.ts`, which had become the catch-all.

**Half right: the "two comments describing deleted helpers".** The stray trailing blank
line in `path.utils.ts` was real and is removed. The two comments could not be
substantiated: every backticked identifier in the feature's comments was cross-checked
against a real definition and nothing dangles. The only mention of a renamed thing is the
deliberate rationale on `reconcileAfterBatch`, and `pruneReferences` still exists on three
services.

**Still deferred, with reasons unchanged**: splitting the container (`docs/TODO.md` item
10) waits for its own branch; replacing the bulk specs' timer flushing with explicit
completion signals waits on item 8, since the flushing exists to absorb the double
initialization.

### ESLint rules mirrored from the other laptop (2026-11-06)

Four rule classes were failing there and passing here, which means the local config was
weaker. Per the standing policy, the rules are mirrored into `eslint.config.mjs` first,
then the code fixed — otherwise the same errors come back on the next sync.

**Four rules added, eight errors fixed.**

- `no-loop-func` (new): three parameterised test loops declared their `it` bodies inside
  the loop, closing over the `let`s that `beforeEach` reassigns. Safe only because the
  body runs after the assignment, which the rule cannot reason about. Fixed by building
  each case through a factory declared outside the loops
  (`connectsCase`, `ignoresPendingCase`) and, in one spot, by reading `destination.id`
  into a `const` before the loop.
- `@typescript-eslint/no-unsafe-assignment` (new): one `const host: HTMLElement =
  fixture.nativeElement`, where `nativeElement` is `any`.
- `@typescript-eslint/no-shadow` was **already enabled and still missed it** — the
  default `hoist: 'functions'` ignores an inner name shadowing an outer one declared
  *later* in the file. With `hoist: 'all'` it reproduced the reported error verbatim:
  two `callFake((_project, node, target) => …)` parameters shadowing a `const target`
  three lines below. The parameters are now named `into`.
- `no-nested-ternary` (new): two nested ternaries in the drag spec, picking the drop
  target and its selector from the surface. Replaced by named helpers — a `switch` for
  the folder and a two-way `nodeSelector` — which also removed the duplicated
  `data-testid` strings.

**A correction worth recording.** The report came as "do not necessary expressions", and
I read that as `no-unnecessary-condition` and went off measuring
`noUncheckedIndexedAccess` before asking for the rule name. The actual message was "Do
not nest ternary expressions" — a different rule with a one-line fix. Ask for the rule
name in brackets at the end of an ESLint line before interpreting a paraphrase; it is
the only part that identifies the rule.

The `no-unnecessary-condition` investigation stands on its own merits as
`docs/TODO.md` item 11, but it was **not** among the reported errors.

**And the "two stale comments" were real after all.** When I could not substantiate them
earlier I checked for dangling *identifiers*, which cannot catch this: both comments were
correct prose left above the wrong declaration after `c22afdf` deleted what they
described. `fileNameParts`' doc comment ended up over `export { isFolder }`, and
`isAncestorOrSelf`' over `getFoldersLengthDependingOnIfRootFolder` — so each actively
misdescribed its neighbour, which is worse than no comment. Both deleted.

Pairing every single-line doc comment with the declaration that follows it, across the
eight files this work touched, found exactly those two and nothing else. That pairing is
the check to run after deleting a function, not an identifier grep.

**One rule deliberately not mirrored**, recorded as `docs/TODO.md` item 11.
`@typescript-eslint/no-unnecessary-condition` reports 57 problems, and **37 are correct
guards it wants deleted**: with `noUncheckedIndexedAccess` off, every
`entityMap()[id]` is typed as always-defined, so the guards this feature depends on read
as "always falsy". Enabling the flag drops the reports to 20 but costs **134 TypeScript
errors** (12 app, 122 spec), and the 20 survivors are 16 redundant `?.`, two
`while (true)`, one dead `if (listKey)` and two intentional guards against DOM and forms
types that lie — no defects. The config carries a comment saying so, so nobody adds it
back without reading the measurement.

The restructured loops were checked against a stashed tree: **275 both before and after**,
so no parameterised case was lost.

### Aligned with the colleague's open-file PR (2026-11-06)

Ported from "Open other file formats in web + [CFO-12577][Projects] Documents" so the
next push does not have to carry it by hand. Three of the four changed files have a
counterpart here.

**Opening a file now defaults to the local application.** `openFile` is the single entry
point behind a table double-click, an activated search result, and the menu's Open: it
uses the desktop application when the file has one and falls back to online. Previously
both activation paths called `openInOnlineApplication` unconditionally, so a Word
document opened in the browser viewer even for a user with Word installed.

**The menu shape follows from the same question.** A file with no local application gets
a single **Open** entry (`pd-menu-open-file`) rather than an **Open File in** submenu
whose only usable child is Online Application. `fileOpenMenuItem` decides that, and
`fileContextMenu` just calls it, so the shape is settled in one place.

The reasoning rests on a backend contract her PR also documents on `fileNodeResponse`:
`desktopUrl` is null for anything that is not an Office document, and `onlineUrl` is
always populated for file nodes and is the fallback. That file is a generated model that
exists here only as an enum stub, so her file had nothing to port — but the same three
fields live on our own `FileNode` domain model, undocumented, so the contract went there
verbatim in meaning. It is also in SPEC 3.5. That is why "can it open locally" is the
right question to branch on.

Also taken: `padding: 0.25rem` on `.pd-tree .p-tree-node-content` in `folder-tree.scss`.

**It arrived untested and does not leave that way.** The suite was 275 before the port
and still 275 after, which means nothing covered either activation path or the menu
shape. Two tests now cover both halves, and reverting each half fails exactly its own
test: the default-open branch, and the single-entry branch.

### Test sync from the colleague's unit-test PR (2026-11-06)

Three files were shown; **only one applied here.**

**`sharepoint-file-system-api.spec.ts` — her id change taken, her matching change not.**

Taken: project ids in that suite were `'project 1'` and `'project'`, which are not ids
at all, and the assertions therefore hardcoded the encoded form
`/projects/project%201/...`. They are `'1'` and `'2'` now. The `uploaded` fixture also
gained its optional fields explicitly, which documents that it has no launch URLs.

Three remaining `'project'` ids at the empty-file, abort and duplicate-name tests are
**left alone on purpose**: her diff does not touch them because those tests match on
`params.get('name')`, so the project id never reaches their assertion. Her change is
complete and self-consistent.

**`candidate.url === …` → path matching: rejected 2026-11-06, then taken the same day.
She was right.**

It was offered as tolerance for a base path prepended in front of the service. It was
rejected on the reasoning that no base path exists on either side, since her *before*
state matched exactly and was passing in her own repo. That reasoning was wrong: it
assumed one adapter where there are two. Her passing *before* state was her repo's
**previous** adapter; the destination's current one routes `copy` through the generated
backend client, which carries a configured base path. The destination's own run shows it
plainly:

```
Expected one matching request for criteria "Match URL: /projects/1/documents/copy", found none.
Requests received are: POST http://<host>/<app-base>/projects/1/documents/copy
```

Same path, prefixed origin. The strictness objection still stands on its own terms —
`endsWith` does accept `/anything/projects/1/documents/copy` — but the prefix is not
this spec's to assert. The adapter contributes a path; the origin and deployment prefix
belong to the HTTP layer carrying it. So the matching now goes through `matchesPath`,
which accepts an exact path or a path at the end of a longer URL, and the comment says
why.

Verified by two control runs rather than asserted: prefixing the copy URL with an
absolute host and application base keeps the suite at **277 SUCCESS**, and
changing the path itself to `/documents/copy-wrong` still fails **3 tests**. Tolerating
the prefix cost no strictness on the part that matters.

**Tell her the rejection was wrong.** The convergence goes her way on this one.

**One coverage loss, repaired, then deliberately given up (2026-11-06).** `'project 1'`
was the only thing proving the service percent-encodes the project segment; after her
change, stripping `encodeURIComponent` from all three call sites left the whole suite
green. An additive test was written to hold it, deliberately using `'a b'` with a
comment saying why an unrealistic id was the point.

That test is now **deleted**. In the destination it produced
`POST .../projects/NaN/documents/copy` — the adapter there converts the project id for
the generated client's numeric parameter, so `Number('a b')` is `NaN`. The test asserts
behaviour for an input the domain forbids: project ids are integers, which is the whole
reason the rest of the suite uses `'1'` and `'2'`. It cannot pass against an adapter
that takes the id as a number, and it was never defending a real scenario.

`encodeURIComponent` stays at all three call sites — a no-op on a numeric id, correct if
ids ever widen — and is now **untested**. That is the accepted cost; the alternative was
a permanently red test in the destination.

**`file-system.store.spec.ts` — not applied, already fixed here.** Her change moves the
repeated-copy test off the execution root onto a Contracts folder found by path, then
`loadChildren`. Ours already copies into Contracts and reaches it through
`store.loadPathListing('EXECUTION', 'Contracts')`, which returns the folder directly —
same intent, one step shorter.

**`navigation.store.spec.ts` — not applied, ours is ahead.** Her change goes from 3 to 4
folders, adding `Unavailable on open`. Ours already asserts **5**: `Contracts`,
`Recycle Bin`, `Schedules`, `Site Reports`, `Unavailable on open`. Applying hers would
drop a folder and lose the recycle bin from the expectation — a regression, not a sync.
Our seed exposes the bin as a child of the root and theirs evidently does not.

### Compile errors reported from the other repo (2026-11-06)

Both reproduced by simulating the stricter types locally rather than guessing, then
fixed, then re-simulated to confirm.

**TS2322, `navigation.store.spec.ts`:** a fixture wrote `accessLevel: 'READONLY'` as a
raw string. Here the access-level type is a union of string literals so it assigns;
there it is a real TypeScript `enum`, where only the member does. Now
`FolderNodeResponseAccessLevelEnum.Readonly` — which is what the production files
already use, and the proof that the member is spelled `Readonly` there is that those
files compile in that repo today. **One occurrence in the whole tree**; swept for
others and there were none.

**TS2345, `project-documents.spec.ts` (4 sites):** `projectDTO.set({ name: 'X' })` and
`set({})`. Our `ProjectOverviewService` is a local stub typed `{ name?: string | null }`;
theirs is the generated `ProjectDTO` with about twelve required fields that say nothing
about documents. The fixtures now assert through `OverviewDto`, an alias **derived from
the service** — `NonNullable<ReturnType<ProjectOverviewService['projectDTO']>>` — rather
than importing a type whose module path differs between the repos. It resolves to the
loose stub here and to the full DTO there, and the assertion is legal both ways because
the DTO is assignable to the partial.

Verified by replacing the stub with a twelve-field required interface and a real `enum`
and running both TypeScript projects: everything in `project-documents` compiles.

**One site was found that their report did not list:**
`project-documents-demo/project-documents-demo.ts:27` sets the same DTO. It is the local
demo route from `app.routes.ts`, not part of the migrated feature, so it is left alone —
a cast there would be dead weight. If that harness is ever migrated it needs the same
treatment.

### Container specs must provide HttpClient (2026-11-06)

Reported from the other repo: every `ProjectDocuments bulk actions` test failing with

```
NG0201: No provider found for `_HttpClient`.
Path: DocumentsAPIService2 -> _HttpClient
```

One cause behind all of them, and nothing to do with the test logic. The four specs that
build `ProjectDocuments` provided no `HttpClient`. That passed here only because the
component hardcoded `{ provide: FileSystemApi, useClass: MockFileSystemApi }`, so nothing
HTTP-backed was ever constructed (that binding has since moved out; see below). In the destination the component graph reaches
`DocumentsAPIService`, which injects `HttpClient`, and the injector has nowhere to get
it.

All four now provide `provideHttpClient(withInterceptorsFromDi())` and
`provideHttpClientTesting()` — inert here, required there.

### Container specs must provide PopupService (2026-11-06)

The same report, one round later: **41 of 46** remaining failures were a single cause.

```
NG0201: No provider found for `_PopupService`. Source: Standalone[ProjectDocuments2]
```

Every test in all four container specs, failing at component construction rather than in
any assertion. The library's `PopupService` is **not** root-provided — each consumer
lists it in its own `providers`, which `project-documents-demo.ts` already did. The local
stand-in was `@Injectable({ providedIn: 'root' })`, so the specs here never had to.

Fixed at the stand-in, not at the symptom: it is now plain `@Injectable()`, which makes
this repo reproduce the destination's requirement. Removing the provider from one spec
afterwards reproduces the reported error verbatim —
`NG0201: No provider found for PopupService. Source: Standalone[ProjectDocuments2]` —
and restoring it returns the suite to green. All four specs now list `PopupService`.

This is the third instance of one pattern and it is now recorded as `docs/TODO.md`
item 12: **a stand-in must be at least as strict as the thing it stands for.** Two
measured, still-loose stubs are listed there.

### PopupService needs two application tokens (2026-11-06)

Providing the real `PopupService` moved the failure one hop down its own dependency
path, reported from the other repo as the single cause of all **46**:

```
NG0201: No provider found for `InjectionToken CurrentAppInjectionToken`.
Path: _PopupService -> CurrentAppInjectionToken (Source: Standalone[ProjectDocuments2])
```

Its constructor injects `CURRENT_APP_INJECTION_TOKEN` and
`IB_PORTAL_SUPPORT_EMAIL_ADDRESS_INJECTION_TOKEN`, which the application supplies in
`app.config.ts` and a test module therefore has to supply too. **Fourth instance of the
same pattern**: the stand-in injected neither, so nothing here could see the
requirement.

Both tokens now exist in `src/local/ibportal-web-ui-commons/app-context.tokens.ts` and
the stand-in injects them, which brought this repo to exact parity — same error, same
path, and **46 failures**, the same number reported. All four specs now provide them,
and the suite is green again.

That count also closes an open question: the earlier tally of 41 was a miscount from
grepping `it(`, not a sign that the spec files had diverged. They have not. The
breakdown reported there — 17 + 16 + 12 + 1 — is this repo's too.

**Not taken: `{ provide: PopupService, useValue: {} }`.** It was recommended over
providing the tokens, on the reasoning that the specs only ever
`spyOn(TestBed.inject(PopupService), …)` so the real class is never needed. That is not
true of these specs, and the difference is measurable rather than arguable: with
`useValue: {}` the suite goes to **12 failures**, in two groups.

- `Error: <spyOn> : showPopup() method does not exist` — jasmine requires the method to
  be present on the object before it can replace it, so an empty object cannot be spied
  on at all.
- `Expected null not to be null` at `project-documents.spec.ts:301` — several tests
  click the **real** rendered dialog:
  ```ts
  const confirm = document.querySelector('[data-testid="confirmation-popup-confirm"]');
  expect(confirm).not.toBeNull();
  confirm?.click();
  ```
  That button exists only because the real service opens a real dialog through
  `DialogService`. Stubbing it deletes the coverage of *a destructive action requires
  confirmation, and cancelling keeps the record* — which is the point of those tests.

So the heavier option is the correct one here. The two `useValue` lines per spec are the
cost of keeping the confirmation flow genuinely under test.

### What the destination still has to answer on the copy tests

After the above, the residue is the `SharePointFileSystemApi` copy suite. Those tests run
against the **destination's** adapter, which the transfer boundaries say to keep, not
against the local reference one. Two differences showed up:

- **Base path** — handled here by `matchesPath` (see the test-sync section above).
- **Numeric project id** — `Number('a b')` produced `NaN` in the URL, so the destination's
  adapter converts the id for the generated client. The unrealistic-id test is deleted;
  nothing else in the suite depends on the id being a string.

If copy tests still fail there after these two changes, the next thing to look at is the
request **body**: this spec asserts the `CopyDocumentRequest` shape the local adapter
sends, and a generated client may name those fields differently. That cannot be settled
from this repo — it needs the destination's `sharepoint-file-system-api.ts`.

**Reproduced before fixing, rather than assumed.** Temporarily pointing this component at
`SharePointFileSystemApi` (which injects `HttpClient`) produced **32 NG0201 errors**, the
same failure. With the providers added and the component still HTTP-backed: **0**.

**One thing to watch on their side.** That simulation left 46 failures after NG0201
disappeared, because a real HTTP API with `provideHttpClientTesting()` has no data unless
the requests are flushed. That is an artefact of forcing this component onto the real
service — but it is also what they will see if their `ProjectDocuments` wires the real
API rather than a mock. The injector error is fixed either way; if a second wave of
"no data" failures follows, the question is what their component provides for
`FileSystemApi`.

## Verification (2026-11-05)

- Full headless suite **275 passed** — 258 through the first quality pass, which edited
  no tests by design, plus 16 for `naming.utils` and 1 for the container's batch
  lifetime. The `BulkOutcome` union needed no test changes either (237 plus 10 for search multi-select, 2 for the
  focus/selection paint fix, 6 for the case-insensitive descendant guard, and 3 for the
  two findings above). Reverting each fix failed exactly its own tests: the paint fix one,
  the clear-focus one, the case-sensitive compare three, and the collapse, the selection
  reconciliation and the drag's visible-ids report one apiece. Reverting
  each of the four fourth-round fixes failed exactly one test: the `clear` line, the
  drag-copy call site, the container's `loading` binding, and the copy guard on the
  navigation decision. Reverting `openSearch`'s clear failed its test; `exitSearch`'s is
  unreachable and has no control. For multi-select, reverting the `dragSet` fallback, the
  `selectedNodes` fallback and the `isMultiSelected` widening each failed exactly one
  test; the `resolveSelection` extraction is behaviour-neutral and is covered by the
  existing table tests passing untouched.
- Production build, both TypeScript projects and repository lint pass (the two
  pre-existing `path-bar` template warnings only).

## Verification (2026-11-04)

- Full headless suite **231 passed**, with two path-matching tests replaced by refresh
  ones. Every fix from both rounds has a regression test
  confirmed to fail without it, except the component-lifetime guard, which is covered by
  inspection: testing it needs a different concurrency harness than that spec uses.
- Production build, both TypeScript projects and repository lint pass.

## Verification (2026-11-03)

- Full headless suite **216 passed**. Reverting the parent-check removal and the
  node-passing failed exactly the two tests that cover them.
- Production build, both TypeScript projects and repository lint pass.

## Verification (2026-11-01)

- Full headless suite **212 passed** (203 plus 9). Reverting the policy branch failed
  exactly the four drag tests; reverting each store fix failed exactly its own tests.
- **Still unguarded: `loadPathListing`.** It has neither a connection check nor an
  existence check, so a path resolved across a project switch applies to the new
  project's cache. An existence check would be wrong there — resolving a folder that is
  not cached is the method's purpose — but a revision check belongs. It is left out
  here because `_checkConnection` throws, and `resolveAndOpen` feeds the path editor's
  error state, so the caller needs the same stale-completion suppression the toasts got.
- Production build, both TypeScript projects and repository lint pass.

## Verification (2026-10-29)

- Full headless suite **202 passed** (199 plus 3). The two guard tests were confirmed to
  fail with the guard removed, while the third — every item issued when the project is
  unchanged — kept passing, showing the guard does not block the normal path.
- Production build, both TypeScript projects and repository lint pass.

## Verification (2026-10-28)

- Full headless suite **199 passed**. The six new tests (three multi-drag, three
  file-table selection) and three store-selection tests were added on top of 190; each
  behavioural one was confirmed to fail against the pre-change code.
- **Type-check with `-p tsconfig.app.json`.** Bare `npx tsc --noEmit` checks nothing:
  the root `tsconfig.json` sets `"files": []` and only references the app and spec
  projects. `tsconfig.spec.json` covers app code transitively through spec imports.

## Verification (2026-10-27)

- Full headless suite: **190 passed** (182 existing, 2 new drag tests, 6 new
  children-load tests). All eight new tests were confirmed to fail against the
  corresponding pre-fix code.
- Production build, both TypeScript projects and repository lint pass. Only the existing
  bundle/container-style budget warnings and two path-bar accessibility warnings remain.
- In this WSL environment the suite needs
  `LD_LIBRARY_PATH=/tmp/x36-browser-deps/root/usr/lib/x86_64-linux-gnu` and
  `CHROME_BIN` pointed at puppeteer's `chrome-headless-shell`; the full `chrome` binary
  still lacks `libcups`, `libcairo` and `libpango`.
- Desktop Escape/cursor confirmation and the real SharePoint adapter remain open exactly
  as described above.

## Verification (2026-10-23)

- Full headless Chrome suite: 182 tests passed, including the existing upload,
  search, access and recycle-bin tests and 37 new drag tests.
- Application production build, spec TypeScript check and repository lint passed.
  The existing initial bundle/container-style budget warnings and two path-bar
  accessibility warnings remain. All 37 focused drag tests passed again after the
  completion helper was extracted to meet the function complexity limit.
- Browser CDP checks passed native table-to-tree move across lists, tree-to-table
  folder move into a protected target, file move, Ctrl-copy with KeepBoth, target
  highlight, 700ms expansion without navigation, and protected-source move rejection.
- Desktop Escape/cursor details and real SharePoint operations remain acceptance
  items as described above. No backend endpoints or adapter methods were changed.

### One point of contact with the shared UI package — tried, then removed (2026-11-09)

A barrel at `tokens/shared-ui.ts` briefly re-exported everything this feature used from
the shared UI package, so the package's names were written once rather than in six files.

**It is gone.** Its reason to exist was the aliasing: it renamed the two
application-context tokens on the way through. Once the specs moved to a popup stub those
tokens had no consumer here, and the barrel was left re-exporting two names unchanged —
pure indirection, and a file a reviewer in the destination would rightly query. The
six consumers import `PopupService` and `TRACE_ID_HEADER` from the package directly
again, which is also what the destination's own code does.

What remains in the migrated tree is five import statements naming the package, which is
unavoidable: an import has to name what it imports. Everything else — the stand-in, the
path alias, the application-context wiring — sits in files that do not travel.

### The component no longer chooses its own backend (2026-11-09)

`ProjectDocuments` used to carry `{ provide: FileSystemApi, useClass: MockFileSystemApi }`
in its own `providers`. That was recorded in PROGRESS as a considered decision — *"one
consumer, one swap; self-contained beats pluggable, and component providers shadow
parents anyway"*. The third clause was the mistake: shadowing is exactly why a host and a
test **cannot** substitute the adapter, which turned out to be the root of two separate
failure reports.

Three costs, each measured rather than argued:

1. **It pulled the mock into the production bundle.** The component imported
   `MockFileSystemApi` statically, so the 1,100-line mock unit and its 446-line seed were
   in the built output. They are now in a lazily loaded chunk of the demo route, out of
   `main`, and a host that provides a real adapter never references them at all.
2. **It caused the `HttpClient` failures.** Once the destination edited that line to its
   own adapter, every container spec constructed the real adapter, its generated client
   and `HttpClient`. Nothing in a spec could override it, because component providers win.
3. **Migration meant editing a shared component.** Phase 6 said "swap `useClass` in
   `project-documents.ts`". Configuring a component by editing it is what DI exists to
   avoid.

`provideProjectDocuments({ api })` replaces it, returning `EnvironmentProviders` so the
choice can only be made in a route or the application config — never buried in a
component again. The demo route makes that choice with the mock; a host makes it with its
adapter. The feature's other providers stay on the component, because they are
per-instance state rather than a choice of implementation.

The four container specs now provide the adapter the same way the **nine other specs in
this feature already did**. That consistency was the strongest argument for the change:
the component was the only exception to a pattern the codebase had already settled on.

### Popup assertions moved to the service boundary (2026-11-09)

Four tests in `project-documents.spec.ts` asserted the *markup* of the popups —
`[data-testid="confirmation-popup-confirm"]`, `<pr-error-popup>`. Those attributes and
that selector belong to the local stand-ins; the real shared components use classes and a
different element name, so the tests could not pass in both repos. Fifth instance of a
stand-in differing from the real thing.

Rewriting the selectors to match the real markup was rejected: it would couple these
specs to another team's CSS and break here, where that markup does not exist. The
assertions moved down to the service boundary instead — what this component *asks* the
popup for — which is identical in both repos and was already the style of the other three
container specs:

```ts
expect(showError).toHaveBeenCalledOnceWith({
    title: 'Cannot restore the item',
    message: '<b>Original name exists</b>',
    escapeMessage: true,
    traceId: 'restore-trace-123',
    isClosable: true
});
```

No behavioural coverage was lost: confirmation is still required before a permanent
delete, accepting still deletes, declining still keeps the record, and the restore errors
still carry their message and trace id. What was dropped is the re-testing of a shared
component this feature does not own.

With that done, `PopupService` is reached only through spies, so the specs provide a
small stub instead of the real class. That also removes the need for the two
application-context tokens in test setup, and sidesteps the destination's report that the
real service's generated factory crashes under Karma.

### A latent race the old test was too quick to see (2026-11-09)

Converting those tests surfaced a genuine flake. `MockFileSystemApi.latencyMs` adds a
fixed 200 ms ceiling to **writes** regardless of configuration:

```ts
const max = kind === 'read' ? this.config.maxLatencyMs : this.config.maxLatencyMs + 200;
```

So a spec configured with `maxLatencyMs: 0` still gets a write taking a random 0–200 ms.
A real button click schedules that timer inside the Angular zone, where
`fixture.whenStable()` waits for it; invoking the captured `onAccept` straight from a
spec runs outside the zone, where it waits for nothing. Ten rounds of `setTimeout(0)`
cover roughly 40 ms, so the assertion won or lost by luck.

Fixed by invoking the callback where the dialog's own button would:

```ts
fixture.ngZone?.run(() => { props.onAccept(); });
```

Three consecutive full runs green afterwards.

**Still open, and worth a look.** `project-documents-bulk.spec.ts` and
`project-documents-lifetime.spec.ts` invoke `onAccept` outside the zone and rely on
`flushTimers`, so they have the same exposure. They pass consistently today, but that is
luck rather than design. The `+ 200` itself also looks wrong: a spec that configures zero
latency is asking for deterministic writes. Both are recorded in `docs/TODO.md`.
