import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TableModule } from 'primeng/table';
import { ProgressSpinner } from 'primeng/progressspinner';
import {
    isFolder,
    type FileNode,
    type FileSystemNode,
    type FolderNode
} from '../../models/file-system-node.model';
import {
    FileSystemPrimeIcon
} from '../../shared/file-system-prime-icon/file-system-prime-icon';

interface RowVm {
    id: string;
    name: string;
    kind: 'folder' | 'file';
    typeLabel: string;
    sizeLabel: string;
    sortSize: number;
    modifiedAt: string;
    modifiedBy: string;
    node: FileSystemNode;
}

@Component({
    selector: 'pr-file-table',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TableModule, ProgressSpinner, DatePipe, FileSystemPrimeIcon],
    templateUrl: './file-table.html',
    styleUrl: './file-table.scss'
})
export class FileTable {
    public readonly folders = input.required<FolderNode[]>();
    public readonly files = input.required<FileNode[]>();
    public readonly loading = input<boolean>(false);

    public readonly itemDoubleClicked = output<FileSystemNode>();

    protected readonly rows = computed<RowVm[]>(() => {
        const out: RowVm[] = [];
        for (const f of this.folders()) {
            out.push({
                id: f.id,
                name: f.name,
                kind: 'folder',
                typeLabel: 'Folder',
                sizeLabel: '',
                sortSize: -1,
                modifiedAt: f.modifiedAt,
                modifiedBy: f.modifiedBy ?? '—',
                node: f
            });
        }
        for (const f of this.files()) {
            const { base, ext } = fileNameParts(f.name);
            out.push({
                id: f.id,
                name: base,
                kind: 'file',
                typeLabel: ext ? ext.toUpperCase() : 'FILE',
                sizeLabel: formatSize(f.sizeBytes),
                sortSize: f.sizeBytes,
                modifiedAt: f.modifiedAt,
                modifiedBy: f.modifiedBy ?? '—',
                node: f
            });
        }

        return out;
    });

    protected onRowDblClick(row: RowVm): void {
        this.itemDoubleClicked.emit(row.node);
    }
}

function formatSize(bytes: number): string {
    if (bytes < 1024) { return `${bytes} B`; }
    if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
    if (bytes < 1024 * 1024 * 1024) { return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }

    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Split a file name into its display base and extension (no leading-dot files). */
function fileNameParts(name: string): { base: string; ext: string } {
    const dot = name.lastIndexOf('.');
    if (dot <= 0) { return { base: name, ext: '' }; }

    return { base: name.slice(0, dot), ext: name.slice(dot + 1) };
}

// Make isFolder available to template via export indirection if needed later.
export { isFolder };
