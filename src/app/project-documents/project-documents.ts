import {
    ChangeDetectionStrategy,
    Component,
    computed,
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
    ConfirmationService,
    MessageService,
    type MenuItem,
    type ToastMessageOptions,
    type TreeNode
} from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { ContextMenu } from 'primeng/contextmenu';
import { InputTextModule } from 'primeng/inputtext';
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
import { FileSystemApi } from './services/file-system-api';
import { MockFileSystemApi } from './services/mock/mock-file-system-api';
import { ClipboardService } from './services/clipboard.service';
import {
    NotificationService,
    PROJECT_DOCUMENTS_TOAST_KEY
} from './services/notification.service';
import { FileSystemReader } from './stores/file-system-reader';
import { FileSystemStore } from './stores/file-system.store';
import { NavigationStore, type PathSegment } from './stores/navigation.store';
import { FILE_MANAGER_CONFIG } from './tokens/file-manager-config.token';
import { FolderTree } from './components/folder-tree/folder-tree';
import { FileTable } from './components/file-table/file-table';
import { PathBar } from './components/path-bar/path-bar';
import { NavToolbar } from './components/nav-toolbar/nav-toolbar';
import { ContextMenuItem } from './components/context-menu-item/context-menu-item';
import {
    RenameDialog,
    type RenameRequest
} from './components/dialogs/rename-dialog';
import type {
    ItemRenameRequest,
    NodeContextMenuRequest
} from './models/context-menu-request.model';

const DELETE_CONFIRMATION_KEY = 'project-documents-delete';
const DEFAULT_FOLDER_NAME = 'New folder';

interface ProjectDocumentsMenuData {
    symbol: string;
    testId: string;
}

type InlineRenameSurface = 'tree' | 'table';

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
        RenameDialog,
        ButtonModule,
        ConfirmDialog,
        ContextMenu,
        InputTextModule,
        SplitterModule,
        Toast,
        TooltipModule
    ],
    providers: [
        FileSystemStore,
        { provide: FileSystemReader, useExisting: FileSystemStore },
        NavigationStore,
        ClipboardService,
        MessageService,
        ConfirmationService,
        NotificationService,
        { provide: FileSystemApi, useClass: MockFileSystemApi }
    ],
    templateUrl: './project-documents.html',
    styleUrl: './project-documents.scss',
    host: { '[style.height]': 'height()' }
})
export class ProjectDocuments {
    public readonly projectId = input.required<string>();
    public readonly projectLabel = input.required<string>();
    /** Fixed component height (any CSS length); the panes scroll within it. */
    public readonly height = input('80vh');

    protected readonly fileSystem = inject(FileSystemStore);
    protected readonly navigation = inject(NavigationStore);
    protected readonly clipboard = inject(ClipboardService);
    protected readonly notifications = inject(NotificationService);
    protected readonly confirmation = inject(ConfirmationService);
    protected readonly config = inject(FILE_MANAGER_CONFIG);
    protected readonly notificationKey = PROJECT_DOCUMENTS_TOAST_KEY;
    protected readonly deleteConfirmationKey = DELETE_CONFIRMATION_KEY;
    protected readonly contextMenu = viewChild<ContextMenu>('contextMenu');

    protected readonly writingIds = signal<ReadonlySet<string>>(new Set<string>());
    protected readonly inlineRenameError = signal<string | null>(null);
    protected readonly inlineRenameSurface = signal<InlineRenameSurface | null>(null);
    protected readonly focusedSurface = signal<InlineRenameSurface>('table');
    protected readonly creatingFolder = signal(false);
    protected readonly renameDialogVisible = signal(false);
    protected readonly renameDialogNode = signal<FileNode | null>(null);
    protected readonly renameDialogSubmitting = signal(false);
    protected readonly renameDialogError = signal<string | null>(null);

    /** Address-bar edit state (owned here; PathBar is a controlled child). */
    protected readonly pathEditing = signal(false);
    protected readonly pathError = signal<string | null>(null);

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
    protected readonly executionTree = computed(() => this.buildTreeSection('execution'));
    protected readonly marketingTree = computed(() => this.buildTreeSection('marketing'));

    /** Both lists available → the tree pane becomes a resizable vertical split. */
    protected readonly bothTreesVisible = computed(() => {
        const roots = this.fileSystem.rootIdByList();

        return roots.marketing !== null && roots.execution !== null;
    });

    /** Context objects for the shared tree-section template (one per list). */
    protected readonly marketingSectionContext = computed(() => ({
        label: DOCUMENT_LIST_LABELS.marketing,
        nodes: this.marketingTree()
    }));

    protected readonly executionSectionContext = computed(() => ({
        label: DOCUMENT_LIST_LABELS.execution,
        nodes: this.executionTree()
    }));

    /** The editable path for the current folder, seeded into the address-bar input. */
    protected readonly currentEditablePath = computed<string>(() => {
        const ctx = this.navigation.currentBreadcrumb();
        if (ctx) { return ctx.path ? `${ctx.listKey}/${ctx.path}` : ctx.listKey; }
        // Cached navigation: derive listKey from the root walk + ancestor folder names.
        const id = this.navigation.currentFolderId();
        const map = this.fileSystem.entityMap();
        if (!id) { return ''; }
        const names: string[] = [];
        let cursor: FileSystemNode | undefined = map[id];
        let rootId: string | undefined;
        while (cursor) {
            if (!isFolder(cursor)) { break; }
            if (cursor.parentId === null) {
                rootId = cursor.id;
                break;
            }
            names.unshift(cursor.name);
            cursor = map[cursor.parentId];
        }
        const roots = this.fileSystem.rootIdByList();
        const listKey = DOCUMENT_LIST_KEYS.find((key) => roots[key] === rootId);

        return listKey ? [listKey, ...names].join('/') : '';
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
        const folder = this.navigation.currentFolder();
        if (!folder || this.isCurrentLoading()) { return 'Loading…'; }
        const { folders, files } = this.navigation.currentFolderChildren();
        const total = folders.length + files.length;
        const folderCount = `${folders.length} folder${folders.length === 1 ? '' : 's'}`;
        const fileCount = `${files.length} file${files.length === 1 ? '' : 's'}`;

        return `${folderCount}, ${fileCount} (${total} total)`;
    });

    protected readonly bootstrapLoading = computed(() => this.fileSystem.isInitializing());

    constructor() {
        // Reactive project connection: the store re-initializes (cancelling any in-flight
        // load via switchMap) whenever the host rebinds `projectId`.
        this.fileSystem.connectProject(this.projectId);
        // React to each completed initialization; `untracked` keeps the effect keyed to
        // `initializedRoots` alone so store writes inside cannot re-trigger it.
        effect(() => {
            const roots = this.fileSystem.initializedRoots();
            if (!roots) { return; }
            untracked(() => this.onProjectInitialized(roots));
        });
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

    @HostListener('document:keydown.F5', ['$event'])
    protected onF5(event: Event): void {
        event.preventDefault();
        this.onRefresh();
    }

    @HostListener('document:keydown.F2', ['$event'])
    protected onF2(event: Event): void {
        if (this.pathEditing() || this.renameDialogVisible()) {
            return;
        }
        const id = this.navigation.focusedId();
        const node = id ? this.fileSystem.entityMap()[id] : undefined;
        if (!node || node.parentId === null || this.isWriting(node.id)) { return; }
        event.preventDefault();
        if (isFolder(node)) {
            const surface = this.focusedSurface() === 'table' &&
                node.parentId === this.navigation.currentFolderId()
                ? 'table'
                : 'tree';
            this.startInlineRename(node, surface);

            return;
        }
        if (node.parentId === this.navigation.currentFolderId()) {
            this.startInlineRename(node, 'table');

            return;
        }
        this.openRenameDialog(node);
    }

    protected onItemFocused(id: string): void {
        this.inlineRenameError.set(null);
        this.focusedSurface.set('table');
        this.navigation.focus(id);
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

    protected openRenameDialog(node: FileSystemNode): void {
        if (node.parentId === null || this.isWriting(node.id)) { return; }
        if (isFolder(node)) {
            this.startInlineRename(node, this.focusedSurface());

            return;
        }
        this.navigation.endRename();
        this.inlineRenameSurface.set(null);
        this.navigation.focus(node.id);
        this.renameDialogNode.set(node);
        this.renameDialogError.set(null);
        this.renameDialogVisible.set(true);
    }

    protected async onRenameDialogRequested(request: RenameRequest): Promise<void> {
        if (this.renameDialogSubmitting() || this.isWriting(request.node.id)) { return; }
        const name = request.name.trim();
        if (name === request.node.name) {
            this.renameDialogVisible.set(false);

            return;
        }
        this.renameDialogSubmitting.set(true);
        this.renameDialogError.set(null);
        this.setWriting(request.node.id, true);
        try {
            const renamed = await this.fileSystem.rename(request.node.id, name);
            this.renameDialogVisible.set(false);
            this.notifications.success(`“${request.node.name}” was renamed to “${renamed.name}”.`);
        } catch (error) {
            const fieldError = this.mutationFieldError(error);
            if (fieldError) {
                this.renameDialogError.set(fieldError);
            } else {
                this.notifications.error(
                    error,
                    this.retryForReadError(
                        error,
                        () => void this.onRenameDialogRequested({ ...request, name })
                    )
                );
            }
        } finally {
            this.setWriting(request.node.id, false);
            this.renameDialogSubmitting.set(false);
        }
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
            const renamed = await this.fileSystem.rename(request.node.id, name);
            this.navigation.endRename();
            this.inlineRenameSurface.set(null);
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

    protected requestDelete(node: FileSystemNode): void {
        if (node.parentId === null || this.isWriting(node.id)) { return; }
        const kind = isFolder(node) ? 'folder' : 'file';
        this.confirmation.confirm({
            key: DELETE_CONFIRMATION_KEY,
            header: `Delete ${kind}`,
            message: `Delete “${node.name}”? This action cannot be undone.`,
            acceptLabel: 'Delete',
            rejectLabel: 'Cancel',
            defaultFocus: 'reject',
            acceptButtonProps: { severity: 'danger' },
            rejectButtonProps: { severity: 'secondary', outlined: true },
            accept: () => void this.deleteNode(node)
        });
    }

    protected async deleteNode(node: FileSystemNode): Promise<void> {
        if (this.isWriting(node.id)) { return; }
        const removedIds = this.cachedSubtreeIds(node.id);
        const currentId = this.navigation.currentFolderId();
        const removesCurrent = currentId !== null && removedIds.includes(currentId);
        const parentId = node.parentId;
        this.setWriting(node.id, true);
        try {
            await this.fileSystem.delete(node.id);
            this.navigation.pruneReferences(removedIds);
            this.clipboard.pruneReferences(removedIds);
            if (removesCurrent && parentId) { this.navigation.navigateTo(parentId); }
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

    protected onTreeNodeSelected(id: string): void {
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
        if (!isFolder(node)) { return; }
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
        const segments = raw
            .trim()
            .replace(/^\/+|\/+$/g, '')
            .split('/')
            .filter((segment) => segment.length > 0);
        const first = segments[0]?.toLowerCase();
        const listKey = DOCUMENT_LIST_KEYS.find((key) => key === first);
        if (!listKey) {
            this.pathError.set(`Path must start with ${DOCUMENT_LIST_KEYS.join(' or ')}.`);

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
        this.closePathEditor();
        this.navigation.back();
    }

    protected onForward(): void {
        this.closePathEditor();
        this.navigation.forward();
    }

    protected onEditRequested(): void {
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
        if (this.fileSystem.isInitializing()) { return; }
        // No valid current folder (failed or empty initialization): retry the whole
        // project connection. rxMethod accepts an imperative value, so this re-runs
        // even for the same project id.
        if (this.bootstrapError() || !this.navigation.currentFolder()) {
            this.fileSystem.connectProject(this.projectId());

            return;
        }
        this.navigation.refresh();
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

    private folderContextMenu(
        folder: FolderNode,
        source: InlineRenameSurface
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
            // TODO: enable with the copy/paste US.
            this.menuItem('Copy Folder', 'content_copy', 'pd-menu-copy-folder', undefined, true),
            this.menuItem('Delete Folder', 'delete', 'pd-menu-delete-folder', () => {
                this.requestDelete(folder);
            }, root || locked),
            { separator: true },
            // TODO: enable with the upload US.
            this.menuItem(
                'Upload within folder',
                'upload',
                'pd-menu-upload-within-folder',
                undefined,
                true
            )
        ];
    }

    private fileContextMenu(file: FileSystemNode): MenuItem[] {
        const locked = this.isWriting(file.id);

        return [
            // TODO: enable with the open-file US.
            this.menuItem('Open File in', 'file_open', 'pd-menu-open-file-in', undefined, false, [
                this.menuItem(
                    'Local application',
                    'grid_view',
                    'pd-menu-open-local',
                    undefined,
                    true
                ),
                this.menuItem(
                    'Online Application',
                    'language',
                    'pd-menu-open-online',
                    undefined,
                    true
                )
            ]),
            { separator: true },
            this.menuItem('Rename File', 'edit', 'pd-menu-rename-file', () => {
                this.openRenameDialog(file);
            }, locked),
            // TODO: enable with the copy/paste US.
            this.menuItem('Copy File', 'content_copy', 'pd-menu-copy-file', undefined, true),
            this.menuItem('Delete File', 'delete', 'pd-menu-delete-file', () => {
                this.requestDelete(file);
            }, locked),
            { separator: true },
            // TODO: enable with the download-file US.
            this.menuItem('Download File', 'download', 'pd-menu-download-file', undefined, true)
        ];
    }

    private emptyContextMenu(): MenuItem[] {
        const canCreate = this.navigation.currentFolder() !== null && !this.creatingFolder();

        return [
            this.menuItem('Create new Folder', 'create_new_folder', 'pd-menu-create-folder', () => {
                void this.createFolder();
            }, !canCreate),
            { separator: true },
            // TODO: enable with the copy/paste US.
            this.menuItem('Paste', 'content_paste', 'pd-menu-paste', undefined, true),
            // TODO: enable with the upload US.
            this.menuItem('Upload', 'upload', 'pd-menu-upload', undefined, false, [
                this.menuItem(
                    'Folder',
                    'drive_folder_upload',
                    'pd-menu-upload-folder',
                    undefined,
                    true
                ),
                this.menuItem('File', 'upload_file', 'pd-menu-upload-file', undefined, true)
            ])
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
            command: action ? () => action() : undefined
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

    private startInlineRename(
        node: FileSystemNode,
        surface: InlineRenameSurface
    ): void {
        if (node.parentId === null || this.isWriting(node.id)) { return; }
        this.renameDialogVisible.set(false);
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
            result.push(...(isFolder(node) ? this.cachedSubtreeIds(node.id) : [node.id]));
        }

        return result;
    }

    /** Build the `p-tree` nodes for one list, traversing from its root id. */
    private buildTreeSection(listKey: DocumentListKey): TreeNode<FolderNode>[] {
        const rootId = this.fileSystem.rootIdByList()[listKey];
        if (!rootId) { return []; }
        const root = this.fileSystem.entityMap()[rootId];
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
                label: isRoot ? `${listKey[0].toUpperCase()}${listKey.slice(1)}` : folder.name,
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
        this.notifications.clear();
        this.clipboard.clear();
        this.closePathEditor();
        const marketingRoot = this.rootFromStatus(roots.marketing);
        const executionRoot = this.rootFromStatus(roots.execution);
        const currentRoot = marketingRoot ?? executionRoot;
        this.notifyRootLoadErrors(roots, currentRoot !== null);
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

    private notifyRootLoadErrors(roots: DocumentListRoots, hasUsableRoot: boolean): void {
        for (const key of DOCUMENT_LIST_KEYS) {
            const root = roots[key];
            if (root.status !== 'error') { continue; }
            if (hasUsableRoot) {
                this.notifications.error(
                    root.error,
                    this.retryForReadError(root.error, () => {
                        this.fileSystem.connectProject(this.projectId());
                    })
                );

                continue;
            }
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
}
