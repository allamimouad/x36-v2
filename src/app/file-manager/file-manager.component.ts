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
  protected readonly config = inject(FILE_MANAGER_CONFIG);

  protected readonly treeNodes = computed<TreeNode<FolderNode>[]>(() => {
    const rootId = this.fileSystem.rootId();
    if (!rootId) return [];
    const root = this.fileSystem.entityMap()[rootId];
    if (!root || !isFolder(root)) return [];
    const all = this.fileSystem.entities();
    const expanded = this.navigation.expandedTreeIds();
    const loaded = new Set(this.fileSystem.folderIdsWithLoadedChildren());
    const rootLabel = this.config.libraryRootName;
    const buildNode = (folder: FolderNode): TreeNode<FolderNode> => {
      const childFolders = all
        .filter((n): n is FolderNode => isFolder(n) && n.parentId === folder.id)
        .sort((a, b) => a.name.localeCompare(b.name));
      const isLoaded = loaded.has(folder.id);
      const isExpanded = expanded.has(folder.id);
      return {
        key: folder.id,
        label: folder.name || rootLabel,
        icon: 'pi pi-folder',
        data: folder,
        leaf: isLoaded && childFolders.length === 0,
        expanded: isExpanded,
        children: isLoaded ? childFolders.map(buildNode) : [],
      };
    };
    return [buildNode(root)];
  });

  protected readonly isCurrentLoading = computed(() => {
    const id = this.navigation.currentFolderId();
    if (!id) return false;
    return this.fileSystem.folderIdsWithLoadingChildren().includes(id);
  });

  protected readonly statusText = computed(() => {
    const folder = this.navigation.currentFolder();
    if (!folder) return 'Loading…';
    const { folders, files } = this.navigation.currentFolderChildren();
    const total = folders.length + files.length;
    return `${folders.length} folder${folders.length === 1 ? '' : 's'}, ${files.length} file${files.length === 1 ? '' : 's'} (${total} total)`;
  });

  ngOnInit(): void {
    void this.bootstrap(this.projectId());
  }

  private async bootstrap(projectId: string): Promise<void> {
    try {
      const root = await this.fileSystem.initialize(projectId);
      this.navigation.initialize(root.id);
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

  @HostListener('document:keydown.F5', ['$event'])
  protected onF5(event: Event): void {
    event.preventDefault();
    this.onRefresh();
  }
}
