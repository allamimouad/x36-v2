import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  HostListener,
  inject,
  untracked,
} from '@angular/core';
import type { TreeNode } from 'primeng/api';
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
  imports: [FolderTreeComponent, FileTableComponent, PathBarComponent, NavToolbarComponent],
  providers: [
    FileSystemStore,
    { provide: FileSystemReader, useExisting: FileSystemStore },
    NavigationStore,
    ClipboardService,
    { provide: FileSystemApi, useClass: MockFileSystemApi },
  ],
  template: `
    <div class="fm-root">
      <app-nav-toolbar
        [canGoBack]="navigation.canGoBack()"
        [canGoForward]="navigation.canGoForward()"
        [canGoUp]="navigation.canGoUp()"
        (back)="navigation.back()"
        (forward)="navigation.forward()"
        (up)="navigation.up()"
        (refresh)="onRefresh()"
      />
      <app-path-bar
        [segments]="navigation.pathSegments()"
        [rootLabel]="config.libraryRootName"
        (segmentClicked)="onSegmentClicked($event)"
      />

      <div class="fm-body">
        <aside class="fm-tree-pane" aria-label="Folder tree">
          <app-folder-tree
            [nodes]="treeNodes()"
            [currentFolderId]="navigation.currentFolderId()"
            [loadingByParentId]="fileSystem.loadingByParentId()"
            (nodeSelected)="onTreeNodeSelected($event)"
            (nodeExpanded)="onTreeNodeExpanded($event)"
            (nodeCollapsed)="onTreeNodeCollapsed($event)"
          />
        </aside>
        <main class="fm-table-pane" aria-label="Folder contents">
          <app-file-table
            [folders]="navigation.currentFolderChildren().folders"
            [files]="navigation.currentFolderChildren().files"
            [loading]="isCurrentLoading()"
            (itemDoubleClicked)="onItemDoubleClicked($event)"
          />
        </main>
      </div>

      <footer class="fm-status" aria-live="polite">
        <span>{{ statusText() }}</span>
      </footer>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .fm-root {
        display: grid;
        grid-template-rows: auto auto 1fr auto;
        height: 100%;
        background: var(--p-content-background, #fff);
        color: var(--p-text-color, #111);
      }
      .fm-body {
        display: grid;
        grid-template-columns: 280px 1fr;
        min-height: 0;
        border-top: 1px solid var(--p-content-border-color, #e5e7eb);
      }
      .fm-tree-pane {
        border-right: 1px solid var(--p-content-border-color, #e5e7eb);
        overflow: hidden;
        min-height: 0;
      }
      .fm-table-pane {
        overflow: hidden;
        min-height: 0;
      }
      .fm-status {
        padding: 0.4rem 0.75rem;
        border-top: 1px solid var(--p-content-border-color, #e5e7eb);
        font-size: 0.85rem;
        color: var(--p-text-muted-color, #888);
      }
    `,
  ],
})
export class FileManagerComponent {
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
    const loaded = new Set(this.fileSystem.loadedParentIds());
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
    return this.fileSystem.loadingByParentId()[id] === true;
  });

  protected readonly statusText = computed(() => {
    const folder = this.navigation.currentFolder();
    if (!folder) return 'Loading…';
    const { folders, files } = this.navigation.currentFolderChildren();
    const total = folders.length + files.length;
    return `${folders.length} folder${folders.length === 1 ? '' : 's'}, ${files.length} file${files.length === 1 ? '' : 's'} (${total} total)`;
  });

  constructor() {
    void this.bootstrap();

    // Auto-load children whenever current folder changes.
    // CRITICAL: dispatch via queueMicrotask so the loadChildren()'s synchronous
    // patchState calls (setLoading, setError) run OUTSIDE the effect's reactive
    // run. Calling loadChildren synchronously here triggers an infinite re-fire
    // loop in Angular's effect scheduler — verified by bisection.
    effect(() => {
      const id = this.navigation.currentFolderId();
      if (!id) return;
      const loaded = untracked(() => this.fileSystem.loadedParentIds());
      if (loaded.includes(id)) return;
      queueMicrotask(() => {
        void this.fileSystem.loadChildren(id);
      });
    });
  }

  private async bootstrap(): Promise<void> {
    try {
      const root = await this.fileSystem.loadRoot();
      this.navigation.expand(root.id);
      this.navigation.navigateTo(root.id);
    } catch (e) {
      console.error('[file-manager] bootstrap failed', e);
    }
  }

  protected onTreeNodeSelected(id: string): void {
    this.navigation.navigateTo(id);
  }

  protected onTreeNodeExpanded(id: string): void {
    this.navigation.expand(id);
    if (!this.fileSystem.loadedParentIds().includes(id)) {
      // Same reason as the effect: defer the call.
      queueMicrotask(() => {
        void this.fileSystem.loadChildren(id);
      });
    }
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
    const id = this.navigation.currentFolderId();
    if (!id) return;
    this.fileSystem.invalidate(id);
    void this.fileSystem.loadChildren(id);
  }

  @HostListener('document:keydown.F5', ['$event'])
  protected onF5(event: Event): void {
    event.preventDefault();
    this.onRefresh();
  }
}
