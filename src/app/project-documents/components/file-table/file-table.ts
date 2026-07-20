import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    ElementRef,
    input,
    output,
    signal,
    viewChild
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { InputText } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Tooltip } from 'primeng/tooltip';
import {
    isFolder,
    type FileNode,
    type FileSystemNode,
    type FolderNode
} from '../../models/file-system-node.model';
import type {
    ItemRenameRequest,
    NodeContextMenuRequest
} from '../../models/context-menu-request.model';
import {
    FileSystemIcon
} from '../../shared/file-system-icon/file-system-icon';

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
    imports: [TableModule, ProgressSpinner, Tooltip, InputText, DatePipe, FileSystemIcon],
    templateUrl: './file-table.html',
    styleUrl: './file-table.scss'
})
export class FileTable {
    public readonly folders = input.required<FolderNode[]>();
    public readonly files = input.required<FileNode[]>();
    public readonly loading = input<boolean>(false);
    public readonly focusedId = input<string | null>(null);
    public readonly renamingId = input<string | null>(null);
    public readonly renameError = input<string | null>(null);
    public readonly writingIds = input<ReadonlySet<string>>(new Set<string>());

    public readonly itemDoubleClicked = output<FileSystemNode>();
    public readonly itemFocused = output<string>();
    public readonly itemContextMenuRequested = output<NodeContextMenuRequest>();
    public readonly emptyContextMenuRequested = output<MouseEvent>();
    public readonly renameSubmitted = output<ItemRenameRequest>();
    public readonly renameCancelled = output();
    public readonly renameEdited = output();

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

    /**
     * Cell (row id + column key) whose tooltip is suppressed because its text fully
     * fits. Truncation is measured at hover time (it depends on the live column width),
     * and the tooltip is disabled-on-demand rather than enabled-on-demand: pTooltip's
     * `tooltipDisabled` setter cancels its own pending delayed show whenever the value
     * changes mid-hover, so flipping it to "enabled" during the hover would never show.
     */
    protected readonly tooltipSuppressedCellId = signal<string | null>(null);
    protected readonly inlineRenameValue = signal('');
    private readonly inlineRenameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');

    constructor() {
        effect(() => {
            const renamingId = this.renamingId();
            const row = this.rows().find((candidate) => candidate.id === renamingId);
            if (row) { this.inlineRenameValue.set(row.node.name); }
            const inputElement = this.inlineRenameInput()?.nativeElement;
            if (inputElement) {
                inputElement.focus();
                inputElement.select();
            }
        });
    }

    protected onRowDblClick(row: RowVm): void {
        this.itemDoubleClicked.emit(row.node);
    }

    protected onRowClick(row: RowVm): void {
        this.itemFocused.emit(row.id);
    }

    protected onRowKeydown(event: KeyboardEvent, row: RowVm): void {
        if (event.target instanceof HTMLInputElement) { return; }
        if (event.key !== 'Enter' && event.key !== ' ') { return; }
        event.preventDefault();
        this.onRowClick(row);
    }

    protected onRowContextMenu(event: MouseEvent, row: RowVm): void {
        event.preventDefault();
        event.stopPropagation();
        this.itemContextMenuRequested.emit({ event, node: row.node, source: 'table' });
    }

    protected onEmptyContextMenu(event: MouseEvent): void {
        event.preventDefault();
        if ((event.target as HTMLElement).closest('thead')) { return; }
        if (!this.loading()) { this.emptyContextMenuRequested.emit(event); }
    }

    protected onInlineRenameInput(event: Event): void {
        this.inlineRenameValue.set((event.target as HTMLInputElement).value);
        this.renameEdited.emit();
    }

    protected onInlineRenameKeydown(event: KeyboardEvent, row: RowVm): void {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.renameCancelled.emit();

            return;
        }
        if (event.key !== 'Enter') { return; }
        event.preventDefault();
        event.stopPropagation();
        this.submitInlineRename(row);
    }

    protected onInlineRenameBlur(row: RowVm): void {
        this.submitInlineRename(row);
    }

    protected onCellMouseEnter(event: MouseEvent, cellId: string): void {
        const el = event.currentTarget as HTMLElement;
        this.tooltipSuppressedCellId.set(el.scrollWidth > el.clientWidth ? null : cellId);
    }

    private submitInlineRename(row: RowVm): void {
        this.renameSubmitted.emit({ node: row.node, name: this.inlineRenameValue() });
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
