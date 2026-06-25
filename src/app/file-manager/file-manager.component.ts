import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  inject,
  input,
  OnInit,
} from '@angular/core';
import type { TreeNode } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SplitterModule } from 'primeng/splitter';
import { TooltipModule } from 'primeng/tooltip';
import {
  DOCUMENT_LIST_LABELS,
  DOCUMENT_LIST_KEYS,
  type DocumentListKey,
} from './models/document-list.model';
import {
  isFolder,
  type FileSystemNode,
  type FolderNode,
} from './models/file-system-node.model';
import { FileSystemApi } from './services/file-system-api';
import { MockFileSystemApi } from './services/mock-file-system-api';
import { ClipboardService } from './services/clipboard.service';
import { FileSystemReader } from './stores/file-system-reader';
import { FileSystemStore } from './stores/file-system.store';
import { NavigationStore } from './stores/navigation.store';
import { FILE_MANAGER_CONFIG } from './tokens/file-manager-config.token';
import { FolderTreeComponent } from './components/folder-tree/folder-tree.component';
import { FileTableComponent } from './components/file-table/file-table.component';
import { PathBarComponent } from './components/path-bar/path-bar.component';
import { NavToolbarComponent } from './components/nav-toolbar/nav-toolbar.component';

@Component({
  selector: 'app-file-manager',
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
    TooltipModule,
  ],
  providers: [
    FileSystemStore,
    { provide: FileSystemReader, useExisting: FileSystemStore },
    NavigationStore,
    ClipboardService,
    { provide: FileSystemApi, useClass: MockFileSystemApi },
  ],
  templateUrl: './file-manager.component.html',
  styleUrl: './file-manager.component.scss',
})
export class FileManagerComponent implements OnInit {
  readonly projectId = input.required<string>();

  protected readonly fileSystem = inject(FileSystemStore);
  protected readonly navigation = inject(NavigationStore);
  protected readonly clipboard = inject(ClipboardService);
  protected readonly config = inject(FILE_MANAGER_CONFIG);

  /** Section-header labels for the two tree panes (Marketing rendered first). */
  protected readonly listLabels = DOCUMENT_LIST_LABELS;

  /** One tree section per document list, each rooted at its list root. */
  protected readonly executionTree = computed(() => this.buildTreeSection('execution'));
  protected readonly marketingTree = computed(() => this.buildTreeSection('marketing'));

  /** Build the `p-tree` nodes for one list, traversing from its root id. */
  private buildTreeSection(listKey: DocumentListKey): TreeNode<FolderNode>[] {
    const rootId = this.fileSystem.rootIdByList()[listKey];
    if (!rootId) return [];
    const root = this.fileSystem.entityMap()[rootId];
    if (!root || !isFolder(root)) return [];
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
        // Section header already carries the full label; the root node shows the short name.
        label: isRoot ? `${listKey[0].toUpperCase()}${listKey.slice(1)}` : folder.name,
        icon: 'pi pi-folder',
        data: folder,
        leaf: isLoaded && childFolders.length === 0,
        expanded: expanded.has(folder.id),
        children: isLoaded ? childFolders.map((child) => buildNode(child, false)) : [],
      };
    };
    return [buildNode(root, true)];
  }

  /** Label of the document list the current folder belongs to (for the breadcrumb root). */
  protected readonly currentListLabel = computed<string>(() => {
    const id = this.navigation.currentFolderId();
    const map = this.fileSystem.entityMap();
    let cursor: FolderNode | FileSystemNode | undefined = id ? map[id] : undefined;
    while (cursor && cursor.parentId) cursor = map[cursor.parentId];
    const rootId = cursor?.id;
    const roots = this.fileSystem.rootIdByList();
    const key = DOCUMENT_LIST_KEYS.find((k) => roots[k] === rootId);
    return key ? DOCUMENT_LIST_LABELS[key] : this.config.libraryRootName;
  });

  protected readonly isCurrentLoading = computed(() => {
    const id = this.navigation.currentFolderId();
    if (!id) return false;
    return this.fileSystem.folderIdsWithLoadingChildren().includes(id);
  });

  protected readonly statusText = computed(() => {
    const navError = this.navigation.navigationError();
    if (navError) return navError;
    const folder = this.navigation.currentFolder();
    if (!folder || this.isCurrentLoading()) return 'Loading…';
    const { folders, files } = this.navigation.currentFolderChildren();
    const total = folders.length + files.length;
    return `${folders.length} folder${folders.length === 1 ? '' : 's'}, ${files.length} file${files.length === 1 ? '' : 's'} (${total} total)`;
  });

  ngOnInit(): void {
    void this.bootstrap(this.projectId());
  }

  private async bootstrap(projectId: string): Promise<void> {
    try {
      const roots = await this.fileSystem.initialize(projectId);
      this.navigation.initialize({
        currentFolderId: roots.marketing.id,
        expandedRootIds: [roots.marketing.id, roots.execution.id],
      });
    } catch (e) {
      console.error('[file-manager] bootstrap failed', e);
    }
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
    if (isFolder(node)) {
      this.navigation.navigateTo(node.id);
    }
  }

  protected onSegmentClicked(id: string): void {
    this.navigation.navigateTo(id);
  }

  protected onRefresh(): void {
    this.navigation.refresh();
  }

  /**
   * Coordination point for a move (cut-paste / drag wiring lands in later phases).
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

  /** Walk up from `candidateId` via parentId; true if `ancestorId` is hit (or is it). */
  private isAncestorOrSelf(ancestorId: string, candidateId: string): boolean {
    const map = this.fileSystem.entityMap();
    let cursor: string | null = candidateId;
    while (cursor) {
      if (cursor === ancestorId) return true;
      cursor = map[cursor]?.parentId ?? null;
    }
    return false;
  }

  @HostListener('document:keydown.F5', ['$event'])
  protected onF5(event: Event): void {
    event.preventDefault();
    this.onRefresh();
  }
}
