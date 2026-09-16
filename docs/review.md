# Project Documents — Initial Folder Navigation Review

Could we remove `extractRootRelativePathFromServerRelativeUrl()` and reuse the
existing `relativePathFromRoot(root.path, folderPath)`? `navigateToInitialFolder()`
already receives `listKey`, so we can retrieve that list's loaded root from
`initializedRoots()` and use its canonical path. This avoids another helper for the
same operation and also lets us check that the requested list is available.

Could we also handle the initial destination inside the existing
`onProjectInitialized()` flow? Currently, that method selects the default root,
while `observeInitialFolderPath()` separately opens the folder from the URL. We
could resolve the requested folder first, then initialize `NavigationStore` with
that folder and its breadcrumb context. This requires allowing `initialize()` to
accept optional breadcrumb context so the requested folder becomes the first
navigation-history entry. If no destination was supplied, we initialize with the
default root; if resolution fails, we notify and fall back to it.

This keeps initialization orchestration in the component and navigation state in
`NavigationStore`, while giving us one place that chooses the initial folder. The
query-parameter approach can stay as it is.
