import {
    ChangeDetectionStrategy,
    Component,
    computed,
    HostListener,
    inject,
    input,
    OnInit,
    signal
} from '@angular/core';
import type { TreeNode } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SplitterModule } from 'primeng/splitter';
import { TooltipModule } from 'primeng/tooltip';
import {
    DOCUMENT_LIST_LABELS,
    DOCUMENT_LIST_KEYS,
    type DocumentListKey
} from './models/document-list.model';
import {
    isFolder,
    type FileSystemNode,
    type FolderNode
} from './models/file-system-node.model';
import { FileSystemApi } from './services/file-system-api';
import { MockFileSystemApi } from './services/testing/mock-file-system-api';
import { ClipboardService } from './services/clipboard.service';
import { FileSystemReader } from './stores/file-system-reader';
import { FileSystemStore } from './stores/file-system.store';
import { NavigationStore, type PathSegment } from './stores/navigation.store';
import { FILE_MANAGER_CONFIG } from './tokens/file-manager-config.token';
import { FolderTreeComponent } from './components/folder-tree/folder-tree.component';
import { FileTableComponent } from './components/file-table/file-table.component';
import { PathBarComponent } from './components/path-bar/path-bar.component';
import { NavToolbarComponent } from './components/nav-toolbar/nav-toolbar.component';

@Component({
    selector: 'pr-file-manager',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        FolderTreeComponent,
        FileTableComponent,
        PathBarComponent,
        NavToolbarComponent,
        ButtonModule,
        InputTextModule,
        SplitterModule,
        TooltipModule
    ],
    providers: [
        FileSystemStore,
        { provide: FileSystemReader, useExisting: FileSystemStore },
        NavigationStore,
        ClipboardService,
        { provide: FileSystemApi, useClass: MockFileSystemApi }
    ],
    templateUrl: './file-manager.component.html',
    styleUrl: './file-manager.component.scss',
    host: { '[style.height]': 'height()' }
})
export class FileManagerComponent implements OnInit {
    public readonly projectId = input.required<string>();
    public readonly projectLabel = input.required<string>();
    /** Fixed component height (any CSS length); the panes scroll within it. */
    public readonly height = input('80vh');

    protected readonly fileSystem = inject(FileSystemStore);
    protected readonly navigation = inject(NavigationStore);
    protected readonly clipboard = inject(ClipboardService);
    protected readonly config = inject(FILE_MANAGER_CONFIG);

    /** Section-header labels for the two tree panes (Marketing rendered first). */
    protected readonly listLabels = DOCUMENT_LIST_LABELS;

    /** Address-bar edit state (owned here; PathBarComponent is a controlled child). */
    protected readonly pathEditing = signal(false);
    protected readonly pathError = signal<string | null>(null);

    /** One tree section per document list, each rooted at its list root. */
    protected readonly executionTree = computed(() => this.buildTreeSection('execution'));
    protected readonly marketingTree = computed(() => this.buildTreeSection('marketing'));

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

    protected readonly statusText = computed(() => {
        const navError = this.navigation.navigationError();
        if (navError) { return navError; }
        const folder = this.navigation.currentFolder();
        if (!folder || this.isCurrentLoading()) { return 'Loading…'; }
        const { folders, files } = this.navigation.currentFolderChildren();
        const total = folders.length + files.length;
        const folderCount = `${folders.length} folder${folders.length === 1 ? '' : 's'}`;
        const fileCount = `${files.length} file${files.length === 1 ? '' : 's'}`;

        return `${folderCount}, ${fileCount} (${total} total)`;
    });

    public ngOnInit(): void {
        void this.bootstrap(this.projectId());
    }

    protected onTreeNodeSelected(id: string): void {
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
            this.navigation.openResolvedFolder(node.id, { listKey: ctx.listKey, path: childPath });
            void this.fileSystem.loadChildren(node.id);

            return;
        }
        this.navigation.navigateTo(node.id);
    }

    protected async onSegmentClicked(seg: PathSegment): Promise<void> {
        if (seg.id) {
            this.navigation.navigateTo(seg.id);

            return;
        }
        if (seg.listKey !== undefined && seg.path !== undefined) {
            try {
                await this.resolveAndOpen(seg.listKey, seg.path);
            } catch (e) {
                console.error('[file-manager] breadcrumb resolve failed', e);
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
        } catch {
            this.pathError.set('No folder matches that path.');
        }
    }

    /** Up: re-resolve the parent path for typed-path folders; otherwise normal up. */
    protected async onUp(): Promise<void> {
        const ctx = this.navigation.currentBreadcrumb();
        if (ctx) {
            if (ctx.path === '') { return; } // already at the list root
            const parentPath = ctx.path.split('/').slice(0, -1).join('/');
            try {
                await this.resolveAndOpen(ctx.listKey, parentPath);
            } catch (e) {
                console.error('[file-manager] up resolve failed', e);
            }

            return;
        }
        this.navigation.up();
    }

    protected onEditRequested(): void {
        this.pathError.set(null);
        this.pathEditing.set(true);
    }

    protected onEditCancelled(): void {
        this.pathError.set(null);
        this.pathEditing.set(false);
    }

    protected onRefresh(): void {
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

    @HostListener('document:keydown.F5', ['$event'])
    protected onF5(event: Event): void {
        event.preventDefault();
        this.onRefresh();
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
                icon: 'pi pi-folder',
                data: folder,
                leaf: isLoaded && childFolders.length === 0,
                expanded: expanded.has(folder.id),
                children: isLoaded ? childFolders.map((child) => buildNode(child, false)) : []
            };
        };

        return [buildNode(root, true)];
    }

    private async bootstrap(projectId: string): Promise<void> {
        try {
            const roots = await this.fileSystem.initialize(projectId);
            this.navigation.initialize({
                currentFolderId: roots.marketing.id,
                expandedRootIds: [roots.marketing.id, roots.execution.id]
            });
        } catch (e) {
            console.error('[file-manager] bootstrap failed', e);
        }
    }

    private async resolveAndOpen(listKey: DocumentListKey, path: string): Promise<void> {
        const { folder, canonicalPath } = await this.fileSystem.loadPathListing(listKey, path);
        this.navigation.openResolvedFolder(folder.id, { listKey, path: canonicalPath });
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
