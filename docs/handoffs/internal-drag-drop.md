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

## Verification (2026-11-04)

- Full headless suite **230 passed**. Every fix from both rounds has a regression test
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
