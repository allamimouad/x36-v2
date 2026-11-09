/* eslint-disable max-lines -- Existing orchestration container; split by responsibility later. */
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    ElementRef,
    HostListener,
    DestroyRef,
    inject,
    input,
    signal,
    untracked,
    viewChild
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
    type MenuItem,
    MessageService,
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
    DOCUMENT_LIST_KEYS,
    DOCUMENT_LIST_LABELS,
    type DocumentListKey,
    type DocumentListRoots
} from './models/document-list.model';
import {
    type FileNode,
    type FileSystemNode,
    type FolderNode,
    isFolder
} from './models/file-system-node.model';
import { FileSystemError } from './models/file-system-error.model';
import type { SelectionRequest } from './models/selection-request.model';
import { DragDropService } from './services/interaction/drag-drop.service';
import { BulkOperationService, doneOf } from './services/interaction/bulk-operation.service';
import {
    type ClipboardMode, ClipboardService
} from './services/interaction/clipboard.service';
import { ExternalDropService } from './services/upload/external-drop.service';
import { FileLaunchService } from './services/interaction/file-launch.service';
import {
    NotificationService,
    PROJECT_DOCUMENTS_TOAST_KEY
} from './services/interaction/notification.service';
import { UploadService } from './services/upload/upload.service';
import { RecycleBinService } from './services/interaction/recycle-bin.service';
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
import type {
    ItemRenameRequest,
    NodeContextMenuRequest,
    SearchResultContextMenuRequest
} from './models/context-menu-request.model';
import type { ExternalFolderDropRequest } from './models/external-drop-request.model';
import { containsNode, topMostNodes } from './utils/node-containment.utils';
import { parentOfRelativePath, relativePathFromRoot } from './utils/path.utils';
import {
    bootstrapFailureMessage,
    logRootLoadErrors,
    parseInitialFolderParams,
    retryForReadError,
    rootFromStatus
} from './utils/bootstrap.utils';
import { buildTreeSection } from './utils/tree-section.utils';
import {
    type ContextMenuDeps,
    disabledSearchContextMenu,
    emptyContextMenu,
    fileContextMenu,
    folderContextMenu,
    isMultiSelected,
    recycleBinContextMenu,
    searchResultFileMenu,
    searchResultFolderMenu,
    uploadMenuItems
} from './services/interaction/context-menu.builder';
import { ProjectOverviewService } from '../../services/project-overview.service';
import { PopupService } from 'ibportal-web-ui-commons';
import {
    ConfirmationPopup,
    DEFAULT_CONFIRMATION_POPUP_DIALOG_CONFIG
} from '@shared/components/confirmation-popup/confirmation-popup';
import { SearchResults } from './components/search-results/search-results';
import { FolderNodeResponseAccessLevelEnum } from '@api/model/folderNodeResponse';
import { ActivatedRoute, Router } from '@angular/router';

const DEFAULT_FOLDER_NAME = 'New folder';

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
        BulkOperationService,
        ClipboardService,
        DragDropService,
        ExternalDropService,
        FileLaunchService,
        MessageService,
        NotificationService,
        UploadService,
        DocumentSearchService,
        RecycleBinService
    ],
    templateUrl: './project-documents.html',
    styleUrl: './project-documents.scss'
})
export class ProjectDocuments {
    public readonly id = input.required<string>();
    public readonly projectLabel = signal<string>('');

    protected readonly fileSystem = inject(FileSystemStore);
    protected readonly navigation = inject(NavigationStore);
    protected readonly clipboard = inject(ClipboardService);
    protected readonly dragDrop = inject(DragDropService);
    protected readonly externalDrops = inject(ExternalDropService);
    protected readonly fileLauncher = inject(FileLaunchService);
    protected readonly notifications = inject(NotificationService);
    protected readonly uploads = inject(UploadService);
    protected readonly search = inject(DocumentSearchService);
    protected readonly config = inject(FILE_MANAGER_CONFIG);
    protected readonly projectOverviewService = inject(ProjectOverviewService);
    protected readonly notificationKey = PROJECT_DOCUMENTS_TOAST_KEY;
    protected readonly contextMenu = viewChild<ContextMenu>('contextMenu');
    protected readonly uploadMenu = viewChild<Menu>('uploadMenu');
    protected readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
    protected readonly canOpenCurrentFolderInSharePoint = computed(() => {
        const folder = this.navigation.currentFolder();

        return folder !== null && this.fileLauncher.canOpenSharePointWeb(folder);
    });

    protected readonly mutationWritingIds = signal<ReadonlySet<string>>(new Set<string>());
    protected readonly writingIds = computed(() => new Set([
        ...this.mutationWritingIds(), ...this.dragDrop.busyIds()
    ]));
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
    protected readonly isCreateFolderButtonDisabled = computed(() => {
        return this.dragDrop.pending() || !this.navigation.currentFolder() ||
            this.creatingFolder() ||
            this.searchActive()
            || this.navigation.currentFolderIsRecycleBin()
            || this.navigation.isCurrentFolderReadonly();
    });
    protected readonly isUploadButtonDisabled = computed(() => {
        return this.dragDrop.pending() || !this.navigation.currentFolder() || this.searchActive()
            || this.navigation.currentFolderIsRecycleBin()
            || this.navigation.isCurrentFolderReadonly();
    });
    protected readonly pasting = signal(false);
    protected readonly toolbarUploadItems = signal<MenuItem[]>([]);
    protected readonly uploadPanelCollapsed = signal(false);
    protected readonly externalDropTargetId = signal<string | null>(null);
    protected readonly externalDropSurface = signal<'table' | 'tree' | null>(null);
    /**
     * Whether the current-folder space should invite the active internal drag. Asks the
     * policy rather than merely checking that a drag exists, so a readonly destination,
     * a same-parent move or a drop onto the source itself is not advertised.
     */
    /**
     * Search results never enter the cache, so `draggableIds` cannot cover them; each
     * result is asked about directly.
     */
    protected readonly draggableSearchResultIds = computed(
        () => this.dragDrop.draggableAmong(this.search.results())
    );
    /** Ids on the clipboard as a cut; empty for a copy, which leaves rows untouched. */
    protected readonly cutIds = computed<ReadonlySet<string>>(
        () => this.clipboard.mode() === 'cut' ? this.clipboard.ids() : new Set<string>()
    );
    protected readonly internalCurrentFolderDropActive = computed(() => {
        const session = this.dragDrop.state();
        const currentFolderId = this.navigation.currentFolderId();
        if (session === null || currentFolderId === null) { return false; }

        return this.dragDrop.canDropOn(currentFolderId, session.effect);
    });
    protected readonly currentFolderDropActive = computed(() => {
        if (this.externalDropSurface() !== 'table' || this.currentFolderError() ||
            this.navigation.isCurrentFolderReadonly()) {
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

        return anyLoaded ? null : bootstrapFailureMessage(roots);
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
        const foldersLength = this.getFoldersLengthDependingOnIfRootFolder(folders);
        const total = foldersLength + files.length;
        const folderCount = `${foldersLength} folder${foldersLength === 1 ? '' : 's'}`;
        const fileCount = `${files.length} file${files.length === 1 ? '' : 's'}`;

        return `${folderCount}, ${fileCount} (${total} total)`;
    });

    protected readonly bootstrapLoading = computed(() => this.fileSystem.isInitializing());
    private pendingFileTarget: FolderNode | null = null;
    /** Set once this component is torn down, so queued batch work stops going out. */
    private destroyed = false;
    private readonly popupService = inject(PopupService);
    private readonly bulk = inject(BulkOperationService);
    private readonly recycleBin = inject(RecycleBinService);
    private readonly router = inject(Router);
    private readonly activatedRoute = inject(ActivatedRoute);

    constructor() {
        // Reactive project connection: the store re-initializes (cancelling any in-flight
        // load via switchMap) whenever the host rebinds `id`.
        this.fileSystem.connectProject(this.id);
        this.dragDrop.connect(() => ({
            writingIds: this.mutationWritingIds(),
            editingIds: new Set([
                this.navigation.renamingId(), this.pendingDelete()?.node.id
            ].filter((id): id is string => typeof id === 'string')),
            blocked: this.internalDragBlocked()
        }));
        this.observeProjectChanges();
        this.observeInitializedRoots();
        this.observeReadErrors();
        effect(() => {
            this.projectLabel.set(this.projectOverviewService.projectDTO()?.name ?? '');
        });
        this.observeSearchHistory();
        this.observeSearchSelection();
        this.observeInitialFolderPath();
        inject(DestroyRef).onDestroy(() => { this.destroyed = true; });
    }

    @HostListener('document:keydown.escape')
    protected cancelInternalDrag(): void {
        this.dragDrop.endDrag();
        this.navigation.clearSelection();
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

    protected onSelectionRequested(request: SelectionRequest): void {
        this.navigation.setSelection(request.ids, request.anchorId);
    }

    protected onSearchSelectionRequested(request: SelectionRequest): void {
        this.focusedSurface.set('search');
        this.navigation.setSelection(request.ids, request.anchorId);
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
            this.openFile(result);

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
                retryForReadError(error, () => void this.openSearchResultLocation(result))
            );
        }
    }

    protected onSearchResultContextMenu(request: SearchResultContextMenuRequest): void {
        const result = request.result;
        const deps = this.contextMenuDeps();
        this.showContextMenu(request.event, isFolder(result)
            ? searchResultFolderMenu(result, deps)
            : searchResultFileMenu(result, deps));
    }

    protected onSearchEmptyContextMenu(event: MouseEvent): void {
        this.showContextMenu(event, disabledSearchContextMenu());
    }

    protected onNodeContextMenu(request: NodeContextMenuRequest): void {
        this.focusedSurface.set(request.source);
        this.navigation.focus(request.node.id);
        this.showContextMenu(
            request.event,
            this.getContextMenu(request)
        );
    }

    protected onEmptyContextMenu(event: MouseEvent): void {
        this.focusedSurface.set('table');
        this.navigation.focus(null);
        this.showContextMenu(event, emptyContextMenu(this.contextMenuDeps()));
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
            this.reportMutationFailure(error);
        } finally {
            this.creatingFolder.set(false);
        }
    }

    protected openToolbarUploadMenu(event: MouseEvent): void {
        const target = this.navigation.currentFolder();
        const menu = this.uploadMenu();
        if (!target || !menu) { return; }
        this.toolbarUploadItems.set(uploadMenuItems(target, this.contextMenuDeps()));
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
        if (this.dragDrop.handles(event)) {
            this.dragDrop.over(event, null, surface);

            return;
        }
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
        if (this.dragDrop.handles(event)) {
            this.dragDrop.over(event, this.currentFolderError() ? null : target?.id ?? null,
                'current-folder');

            return;
        }
        if (!target || this.currentFolderError()) { return; }
        this.onExternalFolderDragOver({ event, target }, 'table');
    }

    protected onExternalDragLeave(event: DragEvent): void {
        this.dragDrop.leave(event);
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
        if (this.dragDrop.handles(event)) {
            void this.dragDrop.drop(event, null);

            return;
        }
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
        if (this.dragDrop.handles(event)) {
            await this.dragDrop.drop(event, this.currentFolderError() ? null :
                this.navigation.currentFolderId());

            return;
        }
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
            // The row survives a rename, so it is corrected rather than re-queried.
            // Corrects the row now; the refresh below reconciles its descendants.
            this.search.replaceResult(renamed);
            this.search.refresh();
            this.notifications.success(`“${request.node.name}” was renamed to “${renamed.name}”.`);
        } catch (error) {
            const fieldError = this.mutationFieldError(error);
            if (fieldError) {
                this.inlineRenameError.set(fieldError);
            } else {
                this.reportMutationFailure(error);
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
        // A whole selection cannot be confirmed on one row, so it asks in the shared
        // popup instead of arming the inline buttons.
        if (isMultiSelected(node, surface, this.navigation.selectedIds())) {
            this.requestBulkDelete(this.selectedNodes());

            return;
        }
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
        const currentId = this.navigation.currentFolderId();
        const parentId = node.parentId;
        this.setWriting(node.id, true);
        try {
            const removedIds = await this.fileSystem.delete(node);
            const removesCurrent = currentId !== null && removedIds.includes(currentId);
            // The node's own id is included explicitly: an uncached source — every
            // search hit is one — contributes nothing to what the cache removed.
            this.bulk.reconcileAfterBatch([...removedIds, node.id]);
            if (removesCurrent && parentId) { this.navigation.navigateTo(parentId); }
            this.notifications.success(`“${node.name}” was deleted.`);
        } catch (error) {
            this.reportMutationFailure(error);
        } finally {
            this.setWriting(node.id, false);
        }
    }

    protected copyToClipboard(node: FileSystemNode, source: NodeSurface): void {
        this.setClipboard(node, source, 'copy');
    }

    protected cutToClipboard(node: FileSystemNode, source: NodeSurface): void {
        this.setClipboard(node, source, 'cut');
    }

    protected async pasteInto(target: FolderNode): Promise<void> {
        if (!this.canPaste(target) || this.isWriting(target.id)) { return; }
        const cut = this.clipboard.mode() === 'cut';
        const sources = this.clipboard.nodes()
            .map((node) => this.fileSystem.entityMap()[node.id] ?? node);
        if (sources.length === 0) {
            this.clipboard.clear();
            this.notifications.warning('The copied item is no longer available.');

            return;
        }
        // Rejected as a set, like a drag: pasting part of what is on the clipboard
        // would do less than the user asked without saying so.
        //
        // `containsNode` is the same test the drag policy applies, rather than a second
        // walk of its own: it checks the list, walks parent ids with a cycle guard, and
        // falls back to a case-insensitive path prefix for a source the cache never held.
        // It reports a node as containing itself only by id, which is the only way two
        // nodes can share a path anyway.
        const entities = this.fileSystem.entityMap();
        if (sources.some((node) => isFolder(node) && containsNode(node, target, entities))) {
            this.notifications.warning(
                `A folder cannot be ${cut ? 'moved' : 'copied'} inside itself ` +
                'or one of its subfolders.'
            );

            return;
        }
        this.pasting.set(true);
        this.setWriting(target.id, true);
        try {
            await this.runPaste(sources, target, cut);
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
        if (this.navigation.currentFolderIsRecycleBin()) { return; }
        if (!isFolder(node)) {
            this.openFile(node);

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
                    retryForReadError(e, () => void this.onSegmentClicked(seg))
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
                retryForReadError(e, () => void this.onPathSubmitted(raw))
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
                    retryForReadError(e, () => void this.onUp())
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
            this.fileSystem.connectProject(this.id());

            return;
        }
        const currentEntry = this.navigation.currentHistoryEntry();
        if (currentEntry?.kind === 'search') {
            const scope = this.navigation.currentFolder();
            if (scope) { this.search.search(this.id(), scope, currentEntry.query); }

            return;
        }
        this.navigation.refresh();
    }

    protected openCurrentFolderInSharePoint(): void {
        const folder = this.navigation.currentFolder();
        if (folder) { this.fileLauncher.openSharePointWeb(folder); }
    }

    /**
     * Put the row, or the whole selection it belongs to, on the clipboard. Cut and copy
     * differ only in mode: the paste decides whether that means move or copy.
     */
    private setClipboard(
        node: FileSystemNode,
        source: NodeSurface,
        mode: ClipboardMode
    ): void {
        const nodes = isMultiSelected(node, source, this.navigation.selectedIds())
            ? this.selectedNodes() : [node];
        const eligible = nodes.filter(
            (candidate) => candidate.parentId !== null && !this.isWriting(candidate.id)
        );
        if (eligible.length === 0) { return; }
        if (mode === 'cut') {
            this.clipboard.cut(eligible);
        } else {
            this.clipboard.copy(eligible);
        }
        const what = eligible.length === 1
            ? `“${eligible[0].name}”`
            : `${eligible.length} items`;
        this.notifications.info(`${what} ready to paste.`);
    }

    private async runPaste(
        sources: FileSystemNode[],
        target: FolderNode,
        cut: boolean
    ): Promise<void> {
        const isCurrent = this.projectSessionGuard();
        const outcomes = await this.bulk.run({
            items: sources,
            isCurrent,
            run: (node) => cut
                ? this.fileSystem.move(node, target.id)
                : this.fileSystem.copy(node, target.id).then(() => [])
        });
        if (!isCurrent()) { return; }
        const done = doneOf(outcomes);
        // A copy takes nothing away, so it prunes nothing: its source still exists and
        // its clipboard entry stays valid. A cut includes the source ids, because an
        // uncached hit reports nothing through the cache.
        const removed = cut
            ? done.flatMap((outcome) => [...outcome.removed, outcome.node.id])
            : [];
        // Read now, not when the paste began: opening a child of a moving folder while
        // the move runs makes that child the one that disappears. The move already
        // resolves its removals at completion, so such a child is in `removed`.
        const currentId = this.navigation.currentFolderId();
        const viewTaken = currentId !== null && removed.includes(currentId);
        this.bulk.reconcileAfterBatch(removed);
        if (viewTaken) { this.navigation.navigateTo(target.id); }
        // No explicit clear: pruning above already drops whatever actually moved, so a
        // full cut empties the clipboard, a partial one keeps exactly the failures for
        // a retry, and a clipboard taken while this paste ran is left alone.
        this.bulk.report(outcomes, cut ? 'moved' : 'copied', cut ? 'stayed in place' : 'failed');
    }

    private requestBulkDelete(nodes: FileSystemNode[]): void {
        if (nodes.length === 0) { return; }
        // Captured now, not on acceptance: the dialog can outlive its project, and
        // confirming afterwards would send these nodes against whatever is loaded then.
        const isCurrent = this.projectSessionGuard();
        this.popupService.showPopup(
            ConfirmationPopup,
            { ...DEFAULT_CONFIRMATION_POPUP_DIALOG_CONFIG, width: '28rem' },
            {
                confirmButtonText: 'Confirm',
                declineButtonText: 'Cancel',
                // Singular is reachable even though this dialog needs more than one row
                // selected: collapsing a folder and its own child leaves one item.
                message: nodes.length === 1
                    ? `Are you sure you want to delete “${nodes[0].name}”?`
                    : `Are you sure you want to delete ${nodes.length} items?`,
                onAccept: () => void this.deleteNodes(nodes, isCurrent)
            }
        );
    }

    private async deleteNodes(
        nodes: FileSystemNode[],
        isCurrent: () => boolean
    ): Promise<void> {
        if (!isCurrent()) { return; }
        const currentId = this.navigation.currentFolderId();
        for (const node of nodes) { this.setWriting(node.id, true); }
        try {
            const outcomes = await this.bulk.run({
                items: nodes,
                isCurrent,
                run: (node) => this.fileSystem.delete(node)
            });
            if (!isCurrent()) { return; }
            const done = doneOf(outcomes);
            // Source ids included: an uncached hit reports nothing through the cache.
            const removed = done.flatMap((outcome) => [...outcome.removed, outcome.node.id]);
            // Decided once for the batch, and before pruning clears the reference.
            const remover = done.find((o) => o.removed.includes(currentId ?? ''));
            this.bulk.reconcileAfterBatch(removed);
            if (remover?.node.parentId) { this.navigation.navigateTo(remover.node.parentId); }
            this.bulk.report(outcomes, 'deleted', 'were not deleted');
        } finally {
            for (const node of nodes) { this.setWriting(node.id, false); }
        }
    }

    /**
     * The selected rows as nodes, resolved from whichever surface is showing them and
     * collapsed to top-most ancestors.
     *
     * Resolved from the active surface, never both: a search hit is not in the cache
     * (results come straight from the endpoint and nothing inserts them, because the
     * table derives a folder's children from whatever entity claims it as a parent and
     * would present a partial listing as a complete one), while a table row always is.
     * A selection cannot span the two, since it is cleared on entering and leaving a
     * search — so asking only the visible surface makes a row the user cannot see
     * impossible to act on, rather than merely absent from the list.
     *
     * Collapsed because a result set is recursive: a folder and something inside it can
     * both be rows, and acting on both pulls the child out of the parent it is travelling
     * with — the same reason a drag has always collapsed its own set.
     */
    private selectedNodes(): FileSystemNode[] {
        const selected = this.navigation.selectedIds();
        const visible = this.searchActive() ? this.search.results() : this.fileSystem.entities();

        return topMostNodes(
            visible.filter((node) => selected.has(node.id)),
            this.fileSystem.entityMap()
        );
    }

    /**
     * Captures the project session so a batch can tell when its work stopped belonging
     * to the loaded project — the same test the drag applies to its own queue.
     */
    private projectSessionGuard(): () => boolean {
        const projectId = this.fileSystem.projectId();
        const roots = this.fileSystem.initializedRoots();

        // `destroyed` matters as much as the project: navigating away must stop queued
        // work from going out, which the drag guard has always checked and this did not.
        return (): boolean => !this.destroyed &&
            this.fileSystem.projectId() === projectId &&
            roots !== null && this.fileSystem.initializedRoots() === roots;
    }

    /**
     * Surface a failed mutation, except when the project changed while the request was
     * in flight: the store deliberately discards that result, and the server operation
     * may well have succeeded, so reporting it as a failure would be wrong. Every
     * mutation guarded by the store's connection revision reports through here.
     */
    private reportMutationFailure(error: unknown): void {
        if (error instanceof FileSystemError && error.code === 'cancelled') { return; }
        this.notifications.error(error);
    }

    private internalDragBlocked(): boolean {
        const activeUploads = this.uploads.tasks().some((task) =>
            task.status === 'queued' || task.status === 'uploading' ||
            task.status === 'finalizing');
        const activeBatches = this.uploads.batches().some((batch) =>
            batch.status === 'queued' || batch.status === 'preparing' ||
            batch.status === 'uploading');

        return this.creatingFolder() || this.pasting() || this.mutationWritingIds().size > 0 ||
            activeUploads || activeBatches;
    }

    private observeProjectChanges(): void {
        let uploadProjectId: string | undefined;
        effect(() => {
            const currentProjectId = this.id();
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
        // A refresh is excluded on purpose: the counted rows are still on screen, so
        // reporting "Searching…" would contradict them. The count below goes stale for
        // the length of the re-query, which the table's own indicator accounts for.
        if (this.search.isSearching() && !this.search.isRefreshing()) { return 'Searching…'; }
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
                    const retry = retryForReadError(
                        readError,
                        () => void this.fileSystem.loadChildren(parentId)
                    );
                    this.notifications.error(readError, retry);
                }
            });
        });
    }

    /**
     * Keep the selection within the rows the search is actually showing.
     *
     * A re-query can drop a row the user had selected — renaming it so it stops
     * matching is the easiest way, but any refresh can. The id would otherwise stay
     * selected with nothing on screen, and a cached node behind it, so a bulk action or
     * a drag would act on something invisible.
     *
     * Only while a search is active: the table's selection is not derived from results
     * and must not be measured against them.
     */
    private observeSearchSelection(): void {
        effect(() => {
            if (!this.searchActive()) { return; }
            const visible = new Set(this.search.results().map(({ id }) => id));
            untracked(() => {
                const selected = this.navigation.selectedIds();
                const remaining = [...selected].filter((id) => visible.has(id));
                if (remaining.length === selected.size) { return; }
                const anchorId = this.navigation.selectionAnchorId();

                this.navigation.setSelection(
                    remaining,
                    anchorId !== null && visible.has(anchorId) ? anchorId : null
                );
            });
        });
    }

    private observeSearchHistory(): void {
        effect(() => {
            const projectId = this.id();
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

    /**
     * Observe query params for initial folder navigation. When `listKey` and `folderPath`
     * query params are present, navigate to the specified folder after initialization.
     */
    private observeInitialFolderPath(): void {
        effect(() => {
            const roots = this.fileSystem.initializedRoots();
            if (!roots) {
                return;
            }

            const anyRootLoaded = DOCUMENT_LIST_KEYS.some((key) => roots[key].status === 'loaded');
            if (!anyRootLoaded) {
                return;
            }

            untracked(() => {
                const params = parseInitialFolderParams(
                    this.activatedRoute.snapshot.queryParamMap
                );
                if (params) {
                    void this.navigateToInitialFolder(params.listKey, params.folderPath);
                }
            });
        });
    }

    private async navigateToInitialFolder(
        listKey: DocumentListKey,
        folderPath: string
    ): Promise<void> {
        try {
            const root = this.fileSystem.initializedRoots()?.[listKey];
            if (root?.status !== 'loaded') {
                throw new FileSystemError('not-found', `${listKey} document root is unavailable`);
            }
            const rootRelativePath = relativePathFromRoot(root.root.path, folderPath);
            await this.resolveAndOpen(listKey, rootRelativePath);
        } catch (error) {
            this.notifications.error(error);
        } finally {
            void this.router.navigate([], { queryParams: [], replaceUrl: true });
        }
    }

    private resetSearchState(): void {
        this.search.clear();
        this.searchText.set('');
        this.searchValidationError.set(null);
    }

    private getContextMenu(request: NodeContextMenuRequest): MenuItem[] {
        const deps = this.contextMenuDeps();
        if (this.navigation.currentFolderIsRecycleBin()
            && request.node.parentId === this.navigation.currentFolderId()
        ) {
            return recycleBinContextMenu(request.node, deps);
        }

        if (isFolder(request.node)) {
            return folderContextMenu(request.node, request.source, deps);
        }

        return fileContextMenu(request.node, 'table', deps);
    }

    /** The state and the callbacks the menu builders need, read once per open. */
    private contextMenuDeps(): ContextMenuDeps {
        return { can: this.menuCapabilities(), on: this.menuActions() };
    }

    private menuCapabilities(): ContextMenuDeps['can'] {
        return {
            writingIds: this.writingIds(),
            selectedIds: this.navigation.selectedIds(),
            readonlyByList: this.navigation.readonlyAccessByListKey(),
            isCurrentFolderReadonly: this.navigation.isCurrentFolderReadonly(),
            isListReadonly: this.navigation.isListReadonly(),
            currentFolder: this.navigation.currentFolder(),
            canCreateFolder: this.navigation.currentFolder() !== null
                    && !this.creatingFolder() && !this.navigation.isCurrentFolderReadonly(),
            canPasteInto: (target): boolean => this.canPaste(target),
            canOpenDesktop: (file): boolean => this.fileLauncher.canOpenDesktop(file),
            canOpenOnline: (file): boolean => this.fileLauncher.canOpenOnline(file),
            canDownload: (file): boolean => this.fileLauncher.canDownload(file)
        };
    }

    private menuActions(): ContextMenuDeps['on'] {
        return {
            openFolder: (folder): void => { this.onItemDoubleClicked(folder); },
            rename: (node, source): void => { this.startInlineRename(node, source); },
            copy: (node, source): void => { this.copyToClipboard(node, source); },
            cut: (node, source): void => { this.cutToClipboard(node, source); },
            paste: (target): void => { void this.pasteInto(target); },
            remove: (node, source): void => { this.requestDelete(node, source); },
            createFolder: (): void => { void this.createFolder(); },
            uploadFolder: (target): void => { void this.pickFolder(target); },
            uploadFile: (target): void => { this.pickFiles(target); },
            openFile: (file): void => { this.openFile(file); },
            openDesktop: (file): void => { this.openInDesktopApplication(file); },
            openOnline: (file): void => { this.openInOnlineApplication(file); },
            download: (file): void => { this.downloadFile(file); },
            restore: (node): void => { void this.recycleBin.restore(node); },
            deletePermanently: (node): void => {
                this.recycleBin.requestPermanentDelete(node);
            },
            openSearchResultLocation: (result): void => {
                void this.openSearchResultLocation(result);
            },
            activateSearchResult: (result): void => {
                void this.onSearchResultActivated(result);
            }
        };
    }

    /** Default open action: the local application when available, the online one otherwise. */
    private openFile(file: FileNode): void {
        if (this.fileLauncher.canOpenDesktop(file)) {
            this.openInDesktopApplication(file);

            return;
        }
        this.openInOnlineApplication(file);
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

    private canPaste(target: FolderNode): boolean {
        return !this.pasting() &&
            !this.clipboard.isEmpty() &&
            target.accessLevel !== FolderNodeResponseAccessLevelEnum.Readonly &&
            !this.navigation.isCurrentFolderReadonly();
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
        if (this.dragDrop.pending()) { return; }
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
        return this.dragDrop.pending() || this.writingIds().has(id);
    }

    private setWriting(id: string, writing: boolean): void {
        const next = new Set(this.mutationWritingIds());
        if (writing) {
            next.add(id);
        } else {
            next.delete(id);
        }
        this.mutationWritingIds.set(next);
    }

    /** Build the `p-tree` nodes for one loaded document-list root. */
    private buildTreeSection(listKey: DocumentListKey): TreeNode<FolderNode>[] {
        const roots = this.fileSystem.initializedRoots();
        if (!roots) { return []; }
        const initializedRoot = rootFromStatus(roots[listKey]);
        if (!initializedRoot) { return []; }
        const root = this.fileSystem.entityMap()[initializedRoot.id];
        if (!root || !isFolder(root)) { return []; }

        return buildTreeSection({
            listKey,
            root,
            nodes: this.fileSystem.entities(),
            expandedIds: this.navigation.expandedTreeIds(),
            loadedIds: new Set(this.fileSystem.folderIdsWithLoadedChildren())
        });
    }

    /** Runs after every completed initialization (first load, project switch, retry). */
    private onProjectInitialized(roots: DocumentListRoots): void {
        this.cancelDeleteConfirmation();
        this.notifications.clear();
        this.clipboard.clear();
        this.closePathEditor();
        const marketingRoot = rootFromStatus(roots.MARKETING);
        const executionRoot = rootFromStatus(roots.EXECUTION);
        const currentRoot = executionRoot ?? marketingRoot;
        logRootLoadErrors(roots);
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

    private getFoldersLengthDependingOnIfRootFolder(folders: FolderNode[]): number {
        // Remove recycle bin folder from count if current folder is the root folder.
        return this.navigation.parentId() === null ? folders.length - 1 : folders.length;
    }
}

function isPickerCancellation(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}
