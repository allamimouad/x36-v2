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
