/* eslint-disable max-lines -- Existing orchestration container; split by responsibility later. */
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    ElementRef,
    effect,
    HostListener,
    inject,
    input,
    signal,
    untracked,
    viewChild
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
    MessageService,
    type MenuItem,
    type ToastMessageOptions,
    type TreeNode
} from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ContextMenu } from 'primeng/contextmenu';
import { InputTextModule } from 'primeng/inputtext';
import { Menu } from 'primeng/menu';
import { SplitterModule } from 'primeng/splitter';
import { Toast } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import {
    DOCUMENT_LIST_LABELS,
    DOCUMENT_LIST_KEYS,
    type DocumentListRoots,
    type DocumentListRootStatus,
    type DocumentListKey
} from './models/document-list.model';
import {
    isFolder,
    type FileNode,
    type FileSystemNode,
    type FolderNode
} from './models/file-system-node.model';
import { FileSystemError } from './models/file-system-error.model';
import { FileSystemApi } from './services/file-system/file-system-api';
import { MockFileSystemApi } from './services/mock/mock-file-system-api';
import { ClipboardService } from './services/interaction/clipboard.service';
import { ExternalDropService } from './services/upload/external-drop.service';
import { FileLaunchService } from './services/interaction/file-launch.service';
import {
    NotificationService,
    PROJECT_DOCUMENTS_TOAST_KEY
} from './services/interaction/notification.service';
import { UploadService } from './services/upload/upload.service';
import { DocumentSearchService } from './services/search/document-search.service';
import { FileSystemReader } from './stores/file-system-reader';
import { FileSystemStore } from './stores/file-system.store';
import { NavigationStore, type PathSegment } from './stores/navigation.store';
import { FILE_MANAGER_CONFIG } from './tokens/file-manager-config.token';
import { FolderTree } from './components/folder-tree/folder-tree';
import { FileTable } from './components/file-table/file-table';
import { PathBar } from './components/path-bar/path-bar';
import { NavToolbar } from './components/nav-toolbar/nav-toolbar';
import { ContextMenuItem } from './components/context-menu-item/context-menu-item';
import { UploadPanel } from './components/upload-panel/upload-panel';
import { SearchResults } from './components/search-results/search-results';
import type {
    ItemRenameRequest,
    NodeContextMenuRequest,
    SearchResultContextMenuRequest
} from './models/context-menu-request.model';
import type { ExternalFolderDropRequest } from './models/external-drop-request.model';
import { parentOfRelativePath, relativePathFromRoot } from './utils/path.utils';

const DEFAULT_FOLDER_NAME = 'New folder';

interface ProjectDocumentsMenuData {
    symbol: string;
    testId: string;
}

type NodeSurface = 'tree' | 'table' | 'search';

interface PendingDelete {
    node: FileSystemNode;
    surface: NodeSurface;
}

@Component({
    selector: 'pr-project-documents',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        NgTemplateOutlet,
        FolderTree,
        FileTable,
        PathBar,
        NavToolbar,
        ContextMenuItem,
        UploadPanel,
        SearchResults,
        ButtonModule,
        ContextMenu,
        InputTextModule,
        Menu,
        SplitterModule,
        Toast,
        TooltipModule
    ],
    providers: [
        FileSystemStore,
        { provide: FileSystemReader, useExisting: FileSystemStore },
        NavigationStore,
        ClipboardService,
        ExternalDropService,
        FileLaunchService,
        MessageService,
        NotificationService,
        UploadService,
        DocumentSearchService,
        { provide: FileSystemApi, useClass: MockFileSystemApi }
    ],
    templateUrl: './project-documents.html',
    styleUrl: './project-documents.scss'
})
export class ProjectDocuments {
    public readonly projectId = input.required<string>();
    public readonly projectLabel = input.required<string>();

    protected readonly fileSystem = inject(FileSystemStore);
    protected readonly navigation = inject(NavigationStore);
    protected readonly clipboard = inject(ClipboardService);
    protected readonly externalDrops = inject(ExternalDropService);
    protected readonly fileLauncher = inject(FileLaunchService);
    protected readonly notifications = inject(NotificationService);
    protected readonly uploads = inject(UploadService);
    protected readonly search = inject(DocumentSearchService);
    protected readonly config = inject(FILE_MANAGER_CONFIG);
    protected readonly notificationKey = PROJECT_DOCUMENTS_TOAST_KEY;
    protected readonly contextMenu = viewChild<ContextMenu>('contextMenu');
    protected readonly uploadMenu = viewChild<Menu>('uploadMenu');
    protected readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
    protected readonly canOpenCurrentFolderInSharePoint = computed(() => {
        const folder = this.navigation.currentFolder();

        return folder !== null && this.fileLauncher.canOpenSharePointWeb(folder);
    });

    protected readonly writingIds = signal<ReadonlySet<string>>(new Set<string>());
    protected readonly inlineRenameError = signal<string | null>(null);
    protected readonly inlineRenameSurface = signal<NodeSurface | null>(null);
    protected readonly focusedSurface = signal<NodeSurface>('table');
    protected readonly pendingDelete = signal<PendingDelete | null>(null);
    protected readonly treeDeleteConfirmationId = computed(() => {
        const pending = this.pendingDelete();

        return pending?.surface === 'tree' ? pending.node.id : null;
    });
    protected readonly tableDeleteConfirmationId = computed(() => {
        const pending = this.pendingDelete();

        return pending?.surface === 'table' ? pending.node.id : null;
    });
    protected readonly searchDeleteConfirmationId = computed(() => {
        const pending = this.pendingDelete();

        return pending?.surface === 'search' ? pending.node.id : null;
    });
    protected readonly creatingFolder = signal(false);
    protected readonly pasting = signal(false);
    protected readonly toolbarUploadItems = signal<MenuItem[]>([]);
    protected readonly uploadPanelCollapsed = signal(false);
    protected readonly externalDropTargetId = signal<string | null>(null);
    protected readonly externalDropSurface = signal<'table' | 'tree' | null>(null);
    protected readonly currentFolderDropActive = computed(() => {
        if (this.externalDropSurface() !== 'table' || this.currentFolderError()) {
            return false;
        }
        const currentFolderId = this.navigation.currentFolderId();
        const targetId = this.externalDropTargetId();

        return currentFolderId !== null && (targetId === null || targetId === currentFolderId);
    });

    /** Address-bar edit state (owned here; PathBar is a controlled child). */
    protected readonly pathEditing = signal(false);
    protected readonly pathError = signal<string | null>(null);
    protected readonly searchText = signal('');
    protected readonly searchValidationError = signal<string | null>(null);
    protected readonly searchActive = computed(
        () =>
            this.navigation.currentHistoryEntry()?.kind === 'search' ||
            this.searchValidationError() !== null
    );
    protected readonly createFolderButtonDisabled = computed(() => {
        return !this.navigation.currentFolder() ||
            this.searchActive() ||
            this.creatingFolder();
    });
    protected readonly searchRootPath = computed(() => {
        const scope = this.navigation.currentFolder();
        if (!scope) { return '/'; }
        const root = this.fileSystem.initializedRoots()?.[scope.listKey];

        return root?.status === 'loaded' ? root.root.path : '/';
    });
    protected readonly searchError = computed<string | null>(() => {
        const validationError = this.searchValidationError();
        if (validationError) { return validationError; }
        const error = this.search.error();

        return error === null ? null : this.notifications.userMessageFor(error);
    });

    /**
   * Derived (never imperatively stuck): non-null only when the latest completed
   * initialization loaded no root at all. Hidden while a (re-)initialization runs.
   */
    protected readonly bootstrapError = computed<string | null>(() => {
        if (this.fileSystem.isInitializing()) { return null; }
        const roots = this.fileSystem.initializedRoots();
        if (!roots) { return null; }
        const anyLoaded = DOCUMENT_LIST_KEYS.some((key) => roots[key].status === 'loaded');

        return anyLoaded ? null : this.bootstrapFailureMessage(roots);
    });

    /** One tree section per document list, each rooted at its list root. */
    protected readonly executionTree = computed(() => this.buildTreeSection('EXECUTION'));
    protected readonly marketingTree = computed(() => this.buildTreeSection('MARKETING'));
    protected readonly executionRootAvailable = computed(
        () => this.fileSystem.initializedRoots()?.EXECUTION.status === 'loaded'
    );
    protected readonly marketingRootAvailable = computed(
        () => this.fileSystem.initializedRoots()?.MARKETING.status === 'loaded'
    );

    /** Both lists available → the tree pane becomes a resizable vertical split. */
    protected readonly bothTreesVisible = computed(
        () => this.marketingRootAvailable() && this.executionRootAvailable()
    );

    /** Context objects for the shared tree-section template (one per list). */
    protected readonly marketingSectionContext = computed(() => ({
        label: DOCUMENT_LIST_LABELS.MARKETING,
        nodes: this.marketingTree()
    }));

    protected readonly executionSectionContext = computed(() => ({
        label: DOCUMENT_LIST_LABELS.EXECUTION,
        nodes: this.executionTree()
    }));

    /** The editable path for the current folder, seeded into the address-bar input. */
    protected readonly currentEditablePath = computed<string>(() => {
        const ctx = this.navigation.currentBreadcrumb();
        if (ctx) {
            const displayListKey = ctx.listKey.toLowerCase();

            return ctx.path ? `${displayListKey}/${ctx.path}` : displayListKey;
        }
        // Cached navigation: every node carries its document-list context.
        const id = this.navigation.currentFolderId();
        const map = this.fileSystem.entityMap();
        if (!id) { return ''; }
        const names: string[] = [];
        let cursor: FileSystemNode | undefined = map[id];
        const listKey = cursor?.listKey;
        while (cursor) {
            if (!isFolder(cursor)) { break; }
            if (cursor.parentId === null) {
                break;
            }
            names.unshift(cursor.name);
            cursor = map[cursor.parentId];
        }

        return listKey ? [listKey.toLowerCase(), ...names].join('/') : '';
    });

    protected readonly isCurrentLoading = computed(() => {
        const id = this.navigation.currentFolderId();
        if (!id) { return false; }

        return this.fileSystem.folderIdsWithLoadingChildren().includes(id);
    });

    protected readonly currentFolderReadError = computed<FileSystemError | null>(() => {
        const id = this.navigation.currentFolderId();
        if (!id) { return null; }

        return this.fileSystem.errorByParentId()[id] ?? null;
    });

    protected readonly currentFolderError = computed<string | null>(() => {
        // `currentFolder()` (not `currentFolderId()`): after switching to a project with no
        // roots, navigation may still hold the previous project's id, but its entity is
        // gone from the wiped cache — the error must show. A later successful typed-path
        // resolve caches its folder, which suppresses the error again.
        const bootstrapError = this.bootstrapError();
        if (bootstrapError && !this.navigation.currentFolder()) { return bootstrapError; }
        const navError = this.navigation.navigationError();
        if (navError) { return navError; }
        const id = this.navigation.currentFolderId();
        if (!id) { return null; }
        const readError = this.currentFolderReadError();
        if (!readError) { return null; }
        const hasUsableCache = this.fileSystem.folderIdsWithLoadedChildren().includes(id);
        const blocksContent =
            readError.code === 'not-found' ||
            readError.code === 'permission-denied' ||
            !hasUsableCache;

        return blocksContent ? this.notifications.userMessageFor(readError) : null;
    });

    protected readonly statusText = computed(() => {
        const currentError = this.currentFolderError();
        if (currentError) { return currentError; }
        if (this.searchActive()) { return this.searchStatusText(); }
        const folder = this.navigation.currentFolder();
        if (!folder || this.isCurrentLoading()) { return 'Loading…'; }
        const { folders, files } = this.navigation.currentFolderChildren();
        const total = folders.length + files.length;
        const folderCount = `${folders.length} folder${folders.length === 1 ? '' : 's'}`;
        const fileCount = `${files.length} file${files.length === 1 ? '' : 's'}`;

        return `${folderCount}, ${fileCount} (${total} total)`;
    });

    protected readonly bootstrapLoading = computed(() => this.fileSystem.isInitializing());
    private pendingFileTarget: FolderNode | null = null;

    constructor() {
        // Reactive project connection: the store re-initializes (cancelling any in-flight
        // load via switchMap) whenever the host rebinds `projectId`.
        this.fileSystem.connectProject(this.projectId);
        this.observeProjectChanges();
        this.observeInitializedRoots();
        this.observeReadErrors();
        this.observeSearchHistory();
    }

    @HostListener('document:pointerdown', ['$event'])
    protected onDocumentPointerDown(event: PointerEvent): void {
        if (!this.pendingDelete()) { return; }
        const target = event.target;
        if (target instanceof Element && target.closest('[data-pd-delete-confirmation]')) {
            return;
        }
        this.cancelDeleteConfirmation();
    }

    protected onItemFocused(id: string): void {
        this.inlineRenameError.set(null);
        this.focusedSurface.set('table');
        this.navigation.focus(id);
    }

    protected onSearchInput(event: Event): void {
        const value = (event.target as HTMLInputElement).value;
        this.searchText.set(value);
        this.searchValidationError.set(null);
        if (value.trim().length === 0) { this.clearSearch(); }
    }

    protected onSearchKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault();
            this.clearSearch();

            return;
        }
        if (event.key !== 'Enter') { return; }
        event.preventDefault();
        this.submitSearch();
    }

    protected submitSearch(): void {
        const query = this.searchText().trim();
        if (!this.navigation.currentFolder() || this.fileSystem.isInitializing()) { return; }
        if (query.length === 0) {
            this.search.clear();
            this.searchValidationError.set('Enter a name to search.');

            return;
        }
        this.searchValidationError.set(null);
        this.navigation.openSearch(query);
    }

    protected clearSearch(): void {
        if (this.navigation.currentHistoryEntry()?.kind === 'search') {
            this.navigation.exitSearch();
        }
        this.resetSearchState();
    }

    protected async onSearchResultActivated(result: FileSystemNode): Promise<void> {
        if (!isFolder(result)) {
            this.openInOnlineApplication(result);

            return;
        }
        await this.openSearchResultLocation(result);
    }

    protected async openSearchResultLocation(result: FileSystemNode): Promise<void> {
        const root = this.fileSystem.initializedRoots()?.[result.listKey];
        if (root?.status !== 'loaded') {
            this.notifications.error(
                new FileSystemError('not-found', `${result.listKey} document root is unavailable`)
            );

            return;
        }
        try {
            const resultPath = relativePathFromRoot(root.root.path, result.path);
            const targetPath = isFolder(result) ? resultPath : parentOfRelativePath(resultPath);
            await this.resolveAndOpen(result.listKey, targetPath);
        } catch (error) {
            this.notifications.error(
                error,
                this.retryForReadError(error, () => void this.openSearchResultLocation(result))
            );
        }
    }

    protected onSearchResultContextMenu(request: SearchResultContextMenuRequest): void {
        const result = request.result;
        if (!isFolder(result)) {
            this.showContextMenu(request.event, [
                this.menuItem(
                    'Open File Location',
                    'drive_file_move',
                    'pd-menu-open-search-result',
                    () => { void this.openSearchResultLocation(result); }
                ),
                { separator: true },
                ...this.fileContextMenu(result, 'search')
            ]);

            return;
        }
        const locked = this.isWriting(result.id);
        this.showContextMenu(request.event, [
            this.menuItem('Open Folder', 'folder_open', 'pd-menu-open-folder', () => {
                void this.onSearchResultActivated(result);
            }),
            { separator: true },
            this.menuItem('Rename Folder', 'edit', 'pd-menu-rename-folder', () => {
                this.startInlineRename(result, 'search');
            }, locked),
            this.menuItem('Copy Folder', 'content_copy', 'pd-menu-copy-folder', () => {
                this.copyToClipboard(result);
            }, locked),
            this.menuItem('Delete Folder', 'delete', 'pd-menu-delete-folder', () => {
                this.requestDelete(result, 'search');
            }, locked)
        ]);
    }

    protected onSearchEmptyContextMenu(event: MouseEvent): void {
        this.showContextMenu(event, this.disabledSearchContextMenu());
    }

    protected onNodeContextMenu(request: NodeContextMenuRequest): void {
        this.focusedSurface.set(request.source);
        this.navigation.focus(request.node.id);
        this.showContextMenu(
            request.event,
            isFolder(request.node)
                ? this.folderContextMenu(request.node, request.source)
                : this.fileContextMenu(request.node)
        );
    }

    protected onEmptyContextMenu(event: MouseEvent): void {
        this.focusedSurface.set('table');
        this.navigation.focus(null);
        this.showContextMenu(event, this.emptyContextMenu());
    }

    protected async createFolder(parentId = this.navigation.currentFolderId()): Promise<void> {
        if (this.creatingFolder()) { return; }
        const parent = parentId ? this.fileSystem.entityMap()[parentId] : undefined;
        if (!parent || !isFolder(parent)) { return; }
        this.creatingFolder.set(true);
        try {
            const created = await this.fileSystem.createFolder(parent.id, DEFAULT_FOLDER_NAME);
            this.navigation.focus(created.id);
            if (this.navigation.currentFolderId() === parent.id) {
                this.startInlineRename(created, 'table');
            } else {
                this.notifications.success(`Folder “${created.name}” was created.`);
            }
        } catch (error) {
            this.notifications.error(
                error,
                this.retryForReadError(error, () => void this.createFolder(parent.id))
            );
        } finally {
            this.creatingFolder.set(false);
        }
    }

    protected openToolbarUploadMenu(event: MouseEvent): void {
        const target = this.navigation.currentFolder();
        const menu = this.uploadMenu();
        if (!target || !menu) { return; }
        this.toolbarUploadItems.set(this.uploadMenuItems(target));
        menu.toggle(event);
    }

    protected pickFiles(target: FolderNode): void {
        const inputElement = this.fileInput()?.nativeElement;
        if (!inputElement) { return; }
        this.pendingFileTarget = target;
        inputElement.value = '';
        inputElement.click();
    }

    protected onFilesPicked(event: Event): void {
        const inputElement = event.currentTarget as HTMLInputElement;
        const target = this.pendingFileTarget;
        const files = inputElement.files ? Array.from(inputElement.files) : [];
        inputElement.value = '';
        this.pendingFileTarget = null;
        if (!target || files.length === 0) { return; }
        this.uploadPanelCollapsed.set(false);
        this.uploads.enqueueFiles(files, target);
    }

    protected async pickFolder(target: FolderNode): Promise<void> {
        if (typeof showDirectoryPicker !== 'function') {
            this.notifications.warning(
                'Folder upload requires Microsoft Edge or Google Chrome over HTTPS.'
            );

            return;
        }
        try {
            const rootHandle = await showDirectoryPicker({
                id: 'project-documents-upload',
                mode: 'read'
            });
            this.uploadPanelCollapsed.set(false);
            await this.uploads.enqueueDirectory(rootHandle, target);
        } catch (error) {
            if (!isPickerCancellation(error)) {
                this.notifications.error(error);
            }
        }
    }

    protected onExternalSurfaceDragOver(
        event: DragEvent,
        surface: 'table' | 'tree'
    ): void {
        if (!this.externalDrops.containsFiles(event.dataTransfer)) { return; }
        this.externalDropSurface.set(surface);
        this.externalDropTargetId.set(null);
    }

    protected onExternalFolderDragOver(
        request: ExternalFolderDropRequest,
        surface: 'table' | 'tree'
    ): void {
        const { event, target } = request;
        if (!this.externalDrops.containsFiles(event.dataTransfer)) { return; }
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) { event.dataTransfer.dropEffect = 'copy'; }
        this.externalDropTargetId.set(target.id);
        this.externalDropSurface.set(surface);
    }

    protected onExternalCurrentFolderDragOver(event: DragEvent): void {
        const target = this.navigation.currentFolder();
        if (!target || this.currentFolderError()) { return; }
        this.onExternalFolderDragOver({ event, target }, 'table');
    }

    protected onExternalDragLeave(event: DragEvent): void {
        const pane = event.currentTarget;
        const nextTarget = event.relatedTarget;
        if (
            pane instanceof Node &&
            nextTarget instanceof Node &&
            pane.contains(nextTarget)
        ) {
            return;
        }
        this.clearExternalDropState();
    }

    protected onExternalDropOutsideTarget(event: DragEvent): void {
        if (!this.externalDrops.containsFiles(event.dataTransfer)) { return; }
        event.preventDefault();
        event.stopPropagation();
        this.clearExternalDropState();
    }

    protected async onExternalFolderDrop(
        request: ExternalFolderDropRequest
    ): Promise<void> {
        await this.uploadExternalDrop(request.event, request.target);
    }

    protected async onExternalCurrentFolderDrop(event: DragEvent): Promise<void> {
        await this.uploadExternalDrop(event, this.navigation.currentFolder());
    }

    protected async onInlineRenameRequested(request: ItemRenameRequest): Promise<void> {
        if (this.isWriting(request.node.id)) { return; }
        const name = request.name.trim();
        if (name === request.node.name) {
            this.cancelInlineRename();

            return;
        }
        this.inlineRenameError.set(null);
        this.setWriting(request.node.id, true);
        try {
            const renamed = await this.fileSystem.rename(request.node, name);
            this.navigation.endRename();
            this.inlineRenameSurface.set(null);
            this.refreshActiveSearch();
            this.notifications.success(`“${request.node.name}” was renamed to “${renamed.name}”.`);
        } catch (error) {
            const fieldError = this.mutationFieldError(error);
            if (fieldError) {
                this.inlineRenameError.set(fieldError);
            } else {
                this.notifications.error(
                    error,
                    this.retryForReadError(
                        error,
                        () => void this.onInlineRenameRequested({ ...request, name })
                    )
                );
            }
        } finally {
            this.setWriting(request.node.id, false);
        }
    }

    protected cancelInlineRename(): void {
        this.inlineRenameError.set(null);
        this.inlineRenameSurface.set(null);
        this.navigation.endRename();
    }

    protected requestDelete(node: FileSystemNode, surface: NodeSurface): void {
        if (node.parentId === null || this.isWriting(node.id)) { return; }
        this.cancelInlineRename();
        this.focusedSurface.set(surface);
        this.navigation.focus(node.id);
        this.pendingDelete.set({ node, surface });
    }

    protected confirmDelete(node: FileSystemNode): void {
        const pending = this.pendingDelete();
        if (pending?.node.id !== node.id) { return; }
        this.pendingDelete.set(null);
        void this.deleteNode(pending.node);
    }

    protected cancelDeleteConfirmation(): void {
        this.pendingDelete.set(null);
    }

    protected async deleteNode(node: FileSystemNode): Promise<void> {
        if (this.isWriting(node.id)) { return; }
        const removedIds = this.cachedSubtreeIds(node.id);
        const currentId = this.navigation.currentFolderId();
        const removesCurrent = currentId !== null && removedIds.includes(currentId);
        const parentId = node.parentId;
        this.setWriting(node.id, true);
        try {
            await this.fileSystem.delete(node);
            this.navigation.pruneReferences(removedIds);
            this.clipboard.pruneReferences(removedIds);
            if (removesCurrent && parentId) { this.navigation.navigateTo(parentId); }
            this.refreshActiveSearch();
            this.notifications.success(`“${node.name}” was deleted.`);
        } catch (error) {
            this.notifications.error(
                error,
                this.retryForReadError(error, () => void this.deleteNode(node))
            );
        } finally {
            this.setWriting(node.id, false);
        }
    }

    protected copyToClipboard(node: FileSystemNode): void {
        if (node.parentId === null || this.isWriting(node.id)) { return; }
        this.clipboard.copy([node]);
        this.notifications.info(`“${node.name}” is ready to paste.`);
    }

    protected async pasteInto(target: FolderNode): Promise<void> {
        if (!this.canPaste(target) || this.isWriting(target.id)) { return; }
        const clipboardSource = this.clipboard.nodes()[0];
        const source = clipboardSource
            ? this.fileSystem.entityMap()[clipboardSource.id] ?? clipboardSource
            : undefined;
        if (!source) {
            this.clipboard.clear();
            this.notifications.warning('The copied item is no longer available.');

            return;
        }
        if (isFolder(source) && this.isNodeAncestorOrSelf(source, target)) {
            this.notifications.warning(
                'A folder cannot be copied inside itself or one of its subfolders.'
            );

            return;
        }

        this.pasting.set(true);
        this.setWriting(target.id, true);
        try {
            await this.fileSystem.copy(source, target);
            this.notifications.success(`“${source.name}” was copied.`);
        } catch (error) {
            this.notifications.error(
                error,
                this.retryForReadError(error, () => void this.pasteInto(target))
            );
        } finally {
            this.setWriting(target.id, false);
            this.pasting.set(false);
        }
    }

    protected onTreeNodeSelected(id: string): void {
        this.cancelDeleteConfirmation();
        this.focusedSurface.set('tree');
        this.closePathEditor();
        this.navigation.navigateTo(id);
    }

    protected onTreeNodeExpanded(id: string): void {
        this.navigation.expand(id);
    }

    protected onTreeNodeCollapsed(id: string): void {
        this.navigation.collapse(id);
    }

    protected onItemDoubleClicked(node: FileSystemNode): void {
        if (!isFolder(node)) {
            this.openInOnlineApplication(node);

            return;
        }
        this.cancelDeleteConfirmation();
        const ctx = this.navigation.currentBreadcrumb();
        const currentId = this.navigation.currentFolderId();
        // In a resolved (typed-path) context, navigating into a direct child stays
        // resolved — ancestors aren't cached, so an id-based entry would break the
        // breadcrumb. Extend the path instead, and load the child's listing by id.
        if (ctx && node.parentId === currentId) {
            const childPath = ctx.path ? `${ctx.path}/${node.name}` : node.name;
            this.closePathEditor();
            this.navigation.openResolvedFolder(node.id, { listKey: ctx.listKey, path: childPath });
            void this.fileSystem.loadChildren(node.id);

            return;
        }
        this.closePathEditor();
        this.navigation.navigateTo(node.id);
    }

    protected async onSegmentClicked(seg: PathSegment): Promise<void> {
        this.cancelDeleteConfirmation();
        if (seg.id) {
            this.closePathEditor();
            this.navigation.navigateTo(seg.id);

            return;
        }
        if (seg.listKey !== undefined && seg.path !== undefined) {
            try {
                await this.resolveAndOpen(seg.listKey, seg.path);
                this.closePathEditor();
            } catch (e) {
                this.notifications.error(
                    e,
                    this.retryForReadError(e, () => void this.onSegmentClicked(seg))
                );
            }
        }
    }

    /** Address-bar submit: validate the list key, resolve the path, open the target. */
    protected async onPathSubmitted(raw: string): Promise<void> {
        this.cancelDeleteConfirmation();
        const segments = raw
            .trim()
            .replace(/^\/+|\/+$/g, '')
            .split('/')
            .filter((segment) => segment.length > 0);
        const first = segments[0]?.toLowerCase();
        const listKey = DOCUMENT_LIST_KEYS.find((key) => key.toLowerCase() === first);
        if (!listKey) {
            this.pathError.set(
                `Path must start with ${DOCUMENT_LIST_KEYS
                    .map((key) => key.toLowerCase())
                    .join(' or ')}.`
            );

            return;
        }
        try {
            await this.resolveAndOpen(listKey, segments.slice(1).join('/'));
            this.pathError.set(null);
            this.pathEditing.set(false);
        } catch (e) {
            if (e instanceof FileSystemError && e.code === 'not-found') {
                this.pathError.set('No folder matches that path.');

                return;
            }
            this.pathError.set(null);
            this.notifications.error(
                e,
                this.retryForReadError(e, () => void this.onPathSubmitted(raw))
            );
        }
    }

    /** Up: re-resolve the parent path for typed-path folders; otherwise normal up. */
    protected async onUp(): Promise<void> {
        this.cancelDeleteConfirmation();
        const ctx = this.navigation.currentBreadcrumb();
        if (ctx) {
            if (ctx.path === '') {
                this.closePathEditor();

                return; // already at the list root
            }
            const parentPath = ctx.path.split('/').slice(0, -1).join('/');
            try {
                await this.resolveAndOpen(ctx.listKey, parentPath);
                this.closePathEditor();
            } catch (e) {
                this.notifications.error(
                    e,
                    this.retryForReadError(e, () => void this.onUp())
                );
            }

            return;
        }
        this.closePathEditor();
        this.navigation.up();
    }

    protected onBack(): void {
        this.cancelDeleteConfirmation();
        this.closePathEditor();
        this.navigation.back();
    }

    protected onForward(): void {
        this.cancelDeleteConfirmation();
        this.closePathEditor();
        this.navigation.forward();
    }

    protected onEditRequested(): void {
        this.cancelDeleteConfirmation();
        this.pathError.set(null);
        this.pathEditing.set(true);
    }

    protected onEditCancelled(): void {
        this.pathError.set(null);
        this.pathEditing.set(false);
    }

    protected runNotificationRetry(message: ToastMessageOptions): void {
        this.notifications.runRetry(message);
    }

    protected onRefresh(): void {
        this.cancelDeleteConfirmation();
        if (this.fileSystem.isInitializing()) { return; }
        // No valid current folder (failed or empty initialization): retry the whole
        // project connection. rxMethod accepts an imperative value, so this re-runs
        // even for the same project id.
        if (this.bootstrapError() || !this.navigation.currentFolder()) {
            this.fileSystem.connectProject(this.projectId());

            return;
        }
        const currentEntry = this.navigation.currentHistoryEntry();
        if (currentEntry?.kind === 'search') {
            const scope = this.navigation.currentFolder();
            if (scope) { this.search.search(this.projectId(), scope, currentEntry.query); }

            return;
        }
        this.navigation.refresh();
    }

    protected openCurrentFolderInSharePoint(): void {
        const folder = this.navigation.currentFolder();
        if (folder) { this.fileLauncher.openSharePointWeb(folder); }
    }

    /**
   * Coordination point for move flows initiated by the container.
   * TODO: wire to the cut/copy/paste and drag-and-drop USs.
   * Guards against moving a folder whose subtree contains the current view — that
   * would orphan `currentFolderId` in a removed subtree. On success, prunes
   * navigation/clipboard references that pointed into the removed subtree.
   */
    protected async moveNode(sourceId: string, targetParentId: string): Promise<void> {
        const currentId = this.navigation.currentFolderId();
        if (currentId && this.isAncestorOrSelf(sourceId, currentId)) {
            return; // blocked: would remove the folder we're currently viewing
        }
        const removed = await this.fileSystem.move(sourceId, targetParentId);
        this.navigation.pruneReferences(removed);
        this.clipboard.pruneReferences(removed);
    }

    private observeProjectChanges(): void {
        let uploadProjectId: string | undefined;
        effect(() => {
            const currentProjectId = this.projectId();
            untracked(() => {
                if (uploadProjectId !== undefined && uploadProjectId !== currentProjectId) {
                    this.pendingFileTarget = null;
                    this.uploads.reset();
                }
                uploadProjectId = currentProjectId;
            });
        });
    }

    private searchStatusText(): string {
        if (this.search.isSearching()) { return 'Searching…'; }
        const searchError = this.searchError();
        if (searchError) { return searchError; }
        const count = this.search.results().length;

        return `${count} search result${count === 1 ? '' : 's'}`;
    }

    private observeInitializedRoots(): void {
        // React to each completed initialization; `untracked` keeps the effect keyed to
        // `initializedRoots` alone so store writes inside cannot re-trigger it.
        effect(() => {
            const roots = this.fileSystem.initializedRoots();
            if (!roots) { return; }
            untracked(() => this.onProjectInitialized(roots));
        });
    }

    private observeReadErrors(): void {
        const notifiedReadErrors = new Map<string, FileSystemError>();
        effect(() => {
            const errors = this.fileSystem.errorByParentId();
            const currentFolderId = this.navigation.currentFolderId();
            const currentFolderError = this.currentFolderError();
            untracked(() => {
                for (const id of notifiedReadErrors.keys()) {
                    if (!errors[id]) { notifiedReadErrors.delete(id); }
                }
                for (const [parentId, readError] of Object.entries(errors)) {
                    if (!readError || notifiedReadErrors.get(parentId) === readError) { continue; }
                    notifiedReadErrors.set(parentId, readError);
                    const isInlineCurrentError =
                        parentId === currentFolderId && currentFolderError !== null;
                    if (isInlineCurrentError) { continue; }
                    const retry = this.retryForReadError(
                        readError,
                        () => void this.fileSystem.loadChildren(parentId)
                    );
                    this.notifications.error(readError, retry);
                }
            });
        });
    }

    private observeSearchHistory(): void {
        effect(() => {
            const projectId = this.projectId();
            const entry = this.navigation.currentHistoryEntry();
            const currentFolder = this.navigation.currentFolder();
            untracked(() => {
                if (entry?.kind !== 'search' || !currentFolder) {
                    this.resetSearchState();

                    return;
                }
                this.searchText.set(entry.query);
                this.searchValidationError.set(null);
                const alreadyLoaded =
                    this.search.activeScopeId() === currentFolder.id &&
                    this.search.activeQuery() === entry.query;
                if (!alreadyLoaded) {
                    this.search.search(projectId, currentFolder, entry.query);
                }
            });
        });
    }

    private resetSearchState(): void {
        this.search.clear();
        this.searchText.set('');
        this.searchValidationError.set(null);
    }

    private folderContextMenu(
        folder: FolderNode,
        source: NodeSurface
    ): MenuItem[] {
        const locked = this.isWriting(folder.id);
        const root = folder.parentId === null;

        return [
            this.menuItem('Open Folder', 'folder_open', 'pd-menu-open-folder', () => {
                this.onItemDoubleClicked(folder);
            }),
            { separator: true },
            this.menuItem('Rename Folder', 'edit', 'pd-menu-rename-folder', () => {
                this.startInlineRename(folder, source);
            }, root || locked),
            this.menuItem('Copy Folder', 'content_copy', 'pd-menu-copy-folder', () => {
                this.copyToClipboard(folder);
            }, root || locked),
            this.menuItem('Paste', 'content_paste', 'pd-menu-paste', () => {
                void this.pasteInto(folder);
            }, locked || !this.canPaste(folder)),
            this.menuItem('Delete Folder', 'delete', 'pd-menu-delete-folder', () => {
                this.requestDelete(folder, source);
            }, root || locked),
            { separator: true },
            this.menuItem(
                'Upload within folder',
                'upload',
                'pd-menu-upload-within-folder',
                undefined,
                false,
                this.uploadMenuItems(folder)
            )
        ];
    }

    private fileContextMenu(file: FileNode, source: NodeSurface = 'table'): MenuItem[] {
        const locked = this.isWriting(file.id);
        const openItems = this.fileOpenMenuItems(file, locked);

        return [
            this.menuItem(
                'Open File in',
                'file_open',
                'pd-menu-open-file-in',
                undefined,
                openItems.every((item) => item.disabled === true),
                openItems
            ),
            { separator: true },
            this.menuItem('Rename File', 'edit', 'pd-menu-rename-file', () => {
                this.startInlineRename(file, source);
            }, locked),
            this.menuItem('Copy File', 'content_copy', 'pd-menu-copy-file', () => {
                this.copyToClipboard(file);
            }, locked),
            this.menuItem('Delete File', 'delete', 'pd-menu-delete-file', () => {
                this.requestDelete(file, source);
            }, locked),
            { separator: true },
            this.menuItem('Download File', 'download', 'pd-menu-download-file', () => {
                this.downloadFile(file);
            }, locked || !this.fileLauncher.canDownload(file))
        ];
    }

    private fileOpenMenuItems(file: FileNode, locked: boolean): MenuItem[] {
        return [
            this.menuItem(
                'Local application',
                'grid_view',
                'pd-menu-open-local',
                () => { this.openInDesktopApplication(file); },
                locked || !this.fileLauncher.canOpenDesktop(file)
            ),
            this.menuItem(
                'Online Application',
                'language',
                'pd-menu-open-online',
                () => { this.openInOnlineApplication(file); },
                locked || !this.fileLauncher.canOpenOnline(file)
            )
        ];
    }

    private openInOnlineApplication(file: FileNode): void {
        if (!this.fileLauncher.openOnline(file)) {
            this.notifications.warning('The online application could not be opened.');
        }
    }

    private openInDesktopApplication(file: FileNode): void {
        if (!this.fileLauncher.openDesktop(file)) {
            this.notifications.warning('The local application could not be opened.');
        }
    }

    private downloadFile(file: FileNode): void {
        if (!this.fileLauncher.download(file)) {
            this.notifications.warning('This file does not have a download link.');
        }
    }

    private emptyContextMenu(): MenuItem[] {
        const currentFolder = this.navigation.currentFolder();
        const canCreate = currentFolder !== null && !this.creatingFolder();

        return [
            this.menuItem('Create new Folder', 'create_new_folder', 'pd-menu-create-folder', () => {
                void this.createFolder();
            }, !canCreate),
            { separator: true },
            this.menuItem('Paste', 'content_paste', 'pd-menu-paste', () => {
                if (currentFolder) { void this.pasteInto(currentFolder); }
            }, currentFolder === null || !this.canPaste(currentFolder)),
            this.menuItem(
                'Upload',
                'upload',
                'pd-menu-upload',
                undefined,
                currentFolder === null,
                currentFolder ? this.uploadMenuItems(currentFolder) : undefined
            )
        ];
    }

    private disabledSearchContextMenu(): MenuItem[] {
        return [
            this.menuItem(
                'Create new Folder',
                'create_new_folder',
                'pd-menu-create-folder',
                undefined,
                true
            ),
            { separator: true },
            this.menuItem('Paste', 'content_paste', 'pd-menu-paste', undefined, true),
            this.menuItem('Upload', 'upload', 'pd-menu-upload', undefined, true)
        ];
    }

    private uploadMenuItems(target: FolderNode): MenuItem[] {
        return [
            this.menuItem('Folder', 'drive_folder_upload', 'pd-menu-upload-folder', () => {
                void this.pickFolder(target);
            }),
            this.menuItem('File', 'upload_file', 'pd-menu-upload-file', () => {
                this.pickFiles(target);
            })
        ];
    }

    private menuItem(
        label: string,
        symbol: string,
        testId: string,
        action?: () => void,
        disabled = false,
        items?: MenuItem[]
    ): MenuItem {
        return {
            label,
            disabled,
            items,
            data: { symbol, testId } satisfies ProjectDocumentsMenuData,
            command: action ? (): void => action() : undefined
        };
    }

    private showContextMenu(event: MouseEvent, items: MenuItem[]): void {
        const menu = this.contextMenu();
        if (!menu) { return; }
        menu.model = items;
        menu.show(event);
    }

    private mutationFieldError(error: unknown): string | null {
        if (!(error instanceof FileSystemError)) { return null; }
        if (error.code !== 'name-collision' && error.code !== 'invalid-name') { return null; }

        return this.notifications.userMessageFor(error);
    }

    private canPaste(_target: FolderNode): boolean {
        return !this.pasting() &&
            this.clipboard.mode() === 'copy' &&
            this.clipboard.nodes().length === 1;
    }

    private refreshActiveSearch(): void {
        const entry = this.navigation.currentHistoryEntry();
        const scope = this.navigation.currentFolder();
        if (entry?.kind === 'search' && scope) {
            this.search.search(this.projectId(), scope, entry.query);
        }
    }

    private async uploadExternalDrop(
        event: DragEvent,
        target: FolderNode | null
    ): Promise<void> {
        const dataTransfer = event.dataTransfer;
        if (!this.externalDrops.containsFiles(dataTransfer) || !dataTransfer) { return; }
        event.preventDefault();
        event.stopPropagation();
        this.clearExternalDropState();
        if (!target || this.fileSystem.isInitializing()) { return; }

        try {
            const selection = await this.externalDrops.read(dataTransfer);
            if (selection.files.length === 0 && selection.directories.length === 0) {
                this.notifications.warning('No supported files or folders were found.');

                return;
            }
            this.uploadPanelCollapsed.set(false);
            this.uploads.enqueueFiles(selection.files, target);
            await Promise.all(
                selection.directories.map((directory) =>
                    this.uploads.enqueueDirectory(directory, target)
                )
            );
        } catch (error) {
            this.notifications.error(error);
        }
    }

    private clearExternalDropState(): void {
        this.externalDropTargetId.set(null);
        this.externalDropSurface.set(null);
    }

    private startInlineRename(
        node: FileSystemNode,
        surface: NodeSurface
    ): void {
        if (node.parentId === null || this.isWriting(node.id)) { return; }
        this.cancelDeleteConfirmation();
        this.inlineRenameError.set(null);
        this.inlineRenameSurface.set(surface);
        this.focusedSurface.set(surface);
        this.navigation.startRename(node.id);
    }

    private isWriting(id: string): boolean {
        return this.writingIds().has(id);
    }

    private setWriting(id: string, writing: boolean): void {
        const next = new Set(this.writingIds());
        if (writing) {
            next.add(id);
        } else {
            next.delete(id);
        }
        this.writingIds.set(next);
    }

    private cachedSubtreeIds(id: string): string[] {
        const result = [id];
        for (const node of this.fileSystem.entities()) {
            if (node.parentId !== id) { continue; }
            result.push(...isFolder(node) ? this.cachedSubtreeIds(node.id) : [node.id]);
        }

        return result;
    }

    /** Build the `p-tree` nodes for one loaded document-list root. */
    private buildTreeSection(listKey: DocumentListKey): TreeNode<FolderNode>[] {
        const roots = this.fileSystem.initializedRoots();
        if (!roots) { return []; }
        const initializedRoot = this.rootFromStatus(roots[listKey]);
        if (!initializedRoot) { return []; }
        const root = this.fileSystem.entityMap()[initializedRoot.id];
        if (!root || !isFolder(root)) { return []; }
        const all = this.fileSystem.entities();
        const expanded = this.navigation.expandedTreeIds();
        const loaded = new Set(this.fileSystem.folderIdsWithLoadedChildren());
        const buildNode = (folder: FolderNode, isRoot: boolean): TreeNode<FolderNode> => {
            const childFolders = all
                .filter((n): n is FolderNode => isFolder(n) && n.parentId === folder.id)
                .sort((a, b) => a.name.localeCompare(b.name));
            const isLoaded = loaded.has(folder.id);

            return {
                key: folder.id,
                // Section header already carries the full label; the root node shows
                // the short name.
                label: isRoot
                    ? `${listKey[0]}${listKey.slice(1).toLowerCase()}`
                    : folder.name,
                data: folder,
                leaf: isLoaded && childFolders.length === 0,
                expanded: expanded.has(folder.id),
                children: isLoaded ? childFolders.map((child) => buildNode(child, false)) : []
            };
        };

        return [buildNode(root, true)];
    }

    /** Runs after every completed initialization (first load, project switch, retry). */
    private onProjectInitialized(roots: DocumentListRoots): void {
        this.cancelDeleteConfirmation();
        this.notifications.clear();
        this.clipboard.clear();
        this.closePathEditor();
        const marketingRoot = this.rootFromStatus(roots.MARKETING);
        const executionRoot = this.rootFromStatus(roots.EXECUTION);
        const currentRoot = marketingRoot ?? executionRoot;
        this.logRootLoadErrors(roots);
        // No root at all: leave navigation untouched — `bootstrapError` derives the
        // message from the same roots result.
        if (!currentRoot) { return; }
        const expandedRootIds = [marketingRoot?.id, executionRoot?.id].filter(
            (id): id is string => typeof id === 'string'
        );
        this.navigation.initialize({
            currentFolderId: currentRoot.id,
            expandedRootIds
        });
    }

    private async resolveAndOpen(listKey: DocumentListKey, path: string): Promise<void> {
        const { folder, canonicalPath } = await this.fileSystem.loadPathListing(listKey, path);
        this.navigation.openResolvedFolder(folder.id, { listKey, path: canonicalPath });
    }

    private closePathEditor(): void {
        this.pathError.set(null);
        this.pathEditing.set(false);
    }

    private rootFromStatus(root: DocumentListRootStatus): FolderNode | null {
        return root.status === 'loaded' ? root.root : null;
    }

    private bootstrapFailureMessage(roots: DocumentListRoots): string {
        const allNotFound = DOCUMENT_LIST_KEYS.every((key) => roots[key].status === 'not-found');

        return allNotFound
            ? 'No documents found for this project.'
            : 'Documents could not be loaded. Try refreshing.';
    }

    private logRootLoadErrors(roots: DocumentListRoots): void {
        for (const key of DOCUMENT_LIST_KEYS) {
            const root = roots[key];
            if (root.status !== 'error') { continue; }
            console.error(`[project-documents] ${key} documents could not be loaded`, root.error);
        }
    }

    private retryForReadError(error: unknown, retry: () => void): (() => void) | undefined {
        return error instanceof FileSystemError && error.code === 'network' ? retry : undefined;
    }

    /** Walk up from `candidateId` via parentId; true if `ancestorId` is hit (or is it). */
    private isAncestorOrSelf(ancestorId: string, candidateId: string): boolean {
        const map = this.fileSystem.entityMap();
        let cursor: string | null = candidateId;
        while (cursor) {
            if (cursor === ancestorId) { return true; }
            cursor = map[cursor]?.parentId ?? null;
        }

        return false;
    }

    private isNodeAncestorOrSelf(source: FolderNode, target: FolderNode): boolean {
        if (this.isAncestorOrSelf(source.id, target.id)) { return true; }

        return source.listKey === target.listKey &&
            (target.path === source.path || target.path.startsWith(`${source.path}/`));
    }
}

function isPickerCancellation(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}
