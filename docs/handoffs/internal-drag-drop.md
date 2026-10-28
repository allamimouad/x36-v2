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
- Roots/bins cannot be dragged; bins/deleted records cannot receive drops.
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
