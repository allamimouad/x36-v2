import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TableModule } from 'primeng/table';
import { ProgressSpinner } from 'primeng/progressspinner';
import {
  isFolder,
  type FileNode,
  type FileSystemNode,
  type FolderNode,
} from '../../models/file-system-node.model';

interface RowVm {
  id: string;
  name: string;
  kind: 'folder' | 'file';
  icon: string;
  sizeLabel: string;
  modifiedAt: string;
  node: FileSystemNode;
}

@Component({
  selector: 'app-file-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TableModule, ProgressSpinner, DatePipe],
  template: `
    @if (loading()) {
      <div class="fm-loading">
        <p-progressSpinner styleClass="fm-spinner" strokeWidth="3" />
      </div>
    } @else {
      <p-table [value]="rows()" dataKey="id" styleClass="fm-table">
        <ng-template pTemplate="header">
          <tr>
            <th style="width: 50%">Name</th>
            <th style="width: 15%">Size</th>
            <th style="width: 35%">Modified</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr
            [attr.data-testid]="'fm-row-' + row.id"
            (dblclick)="onRowDblClick(row)"
            class="fm-row"
            [class.fm-row-folder]="row.kind === 'folder'"
          >
            <td>
              <span class="fm-name">
                <i [class]="row.icon"></i>
                <span>{{ row.name }}</span>
              </span>
            </td>
            <td>{{ row.sizeLabel }}</td>
            <td>{{ row.modifiedAt | date: 'medium' }}</td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="3" class="fm-empty">This folder is empty.</td>
          </tr>
        </ng-template>
      </p-table>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        overflow: hidden;
      }
      .fm-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
      }
      :host ::ng-deep .fm-spinner {
        width: 36px;
        height: 36px;
      }
      :host ::ng-deep .fm-table {
        height: 100%;
      }
      .fm-name {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
      }
      .fm-row {
        cursor: default;
      }
      .fm-row-folder {
        cursor: pointer;
      }
      .fm-empty {
        text-align: center;
        padding: 2rem;
        color: var(--p-text-muted-color, #888);
      }
    `,
  ],
})
export class FileTableComponent {
  readonly folders = input.required<FolderNode[]>();
  readonly files = input.required<FileNode[]>();
  readonly loading = input<boolean>(false);

  readonly itemDoubleClicked = output<FileSystemNode>();

  protected readonly rows = computed<RowVm[]>(() => {
    const out: RowVm[] = [];
    for (const f of this.folders()) {
      out.push({
        id: f.id,
        name: f.name,
        kind: 'folder',
        icon: 'pi pi-folder',
        sizeLabel: itemCountLabel(f),
        modifiedAt: f.modifiedAt,
        node: f,
      });
    }
    for (const f of this.files()) {
      out.push({
        id: f.id,
        name: f.name,
        kind: 'file',
        icon: iconForFile(f),
        sizeLabel: formatSize(f.sizeBytes),
        modifiedAt: f.modifiedAt,
        node: f,
      });
    }
    return out;
  });

  protected onRowDblClick(row: RowVm): void {
    this.itemDoubleClicked.emit(row.node);
  }
}

function itemCountLabel(f: FolderNode): string {
  if (f.itemCount === 0) return 'Empty';
  return `${f.itemCount} item${f.itemCount === 1 ? '' : 's'}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function iconForFile(f: FileNode): string {
  const ext = f.name.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'pdf':
      return 'pi pi-file-pdf';
    case 'xlsx':
    case 'xls':
    case 'csv':
      return 'pi pi-file-excel';
    case 'docx':
    case 'doc':
      return 'pi pi-file-word';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
      return 'pi pi-image';
    case 'txt':
    case 'md':
      return 'pi pi-file-edit';
    default:
      return 'pi pi-file';
  }
}

// Make isFolder available to template via export indirection if needed later.
export { isFolder };
