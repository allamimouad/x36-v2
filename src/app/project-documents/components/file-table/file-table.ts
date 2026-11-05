import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    ElementRef,
    HostListener,
    input,
    output,
    signal,
    viewChild
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { InputText } from 'primeng/inputtext';
import { Table, TableModule } from 'primeng/table';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Tooltip } from 'primeng/tooltip';
import {
    type FileNode,
    type FileSystemNode,
    type FolderNode,
    isFolder
} from '../../models/file-system-node.model';
import type {
    ItemRenameRequest,
    NodeContextMenuRequest
} from '../../models/context-menu-request.model';
import type { ExternalFolderDropRequest } from '../../models/external-drop-request.model';
import type { SelectionRequest } from '../../models/selection-request.model';
import {
    hasInternalDragType, type ItemDragRequest, type ItemDropRequest
} from '../../models/drag-state.model';
import { FileSystemIcon } from '../../shared/file-system-icon/file-system-icon';
import {
    editableName, splitFileName, submittedName
} from '../../utils/naming.utils';
import { resolveSelection } from '../../utils/selection.utils';
import { FolderNodeResponseAccessLevelEnum } from '@api/model/folderNodeResponse';

interface RowVm {
    id: string;
    name: string;
    path?: string;
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
    /** Rows on the clipboard as a cut, shown faded until the paste lands. */
    public readonly cutIds = input<ReadonlySet<string>>(new Set<string>());
    public readonly deleteConfirmationId = input<string | null>(null);
    public readonly externalDropTargetId = input<string | null>(null);
    public readonly draggableIds = input<ReadonlySet<string>>(new Set());
    public readonly internalDragActive = input(false);
    /**
     * Whether the current folder would actually accept the active internal drag.
     * Separate from `internalDragActive`, which routes events and must stay true for
     * the whole gesture: this one drives the invitation, so it must not promise a
     * drop the policy rejects.
     */
    public readonly internalCurrentFolderDropActive = input(false);
    public readonly internalCurrentFolderTarget = input(false);
    public readonly internalSourceIds = input<ReadonlySet<string>>(new Set<string>());
    public readonly internalDropTargetId = input<string | null>(null);
    public readonly externalDragActive = input<boolean>(false);
    public readonly projectName = input<string>('');
    public readonly currentFolderName = input<string>('');
    public readonly currentFolderListKey = input<string | null>(null);
    public readonly selectedIds = input<ReadonlySet<string>>(new Set<string>());
    public readonly selectionAnchorId = input<string | null>(null);
    public readonly currentFolderIsRecycleBin = input<boolean | null>(null);
    public readonly isCurrentFolderReadonly = input<boolean>(false);

    public readonly itemDoubleClicked = output<FileSystemNode>();
    public readonly itemFocused = output<string>();
    public readonly selectionRequested = output<SelectionRequest>();
    public readonly emptySpaceClicked = output();
    public readonly itemContextMenuRequested = output<NodeContextMenuRequest>();
    public readonly emptyContextMenuRequested = output<MouseEvent>();
    public readonly renameSubmitted = output<ItemRenameRequest>();
    public readonly renameCancelled = output();
    public readonly renameEdited = output();
    public readonly deleteConfirmed = output<FileSystemNode>();
    public readonly deleteCancelled = output();
    public readonly externalFolderDragOver = output<ExternalFolderDropRequest>();
    public readonly externalFolderDropped = output<ExternalFolderDropRequest>();
    public readonly dragStarted = output<ItemDragRequest>();
    public readonly dragEnded = output();
    public readonly internalDragOver = output<ItemDropRequest>();
    public readonly internalDropped = output<ItemDropRequest>();
    public readonly internalDragLeft = output<DragEvent>();
    public readonly currentFolderDragOver = output<DragEvent>();
    public readonly currentFolderDropped = output<DragEvent>();

    protected readonly rows = computed<RowVm[]>(() => {
        const out: RowVm[] = [];
        for (const f of this.folders()) {
            if (f.isRecycleBin) {
                continue;
            }
            out.push({
                id: f.id,
                name: f.name,
                path: f.path ? this.transformPath(f.path) : undefined,
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
            const { base, ext } = splitFileName(f.name);
            out.push({
                id: f.id,
                name: base,
                path: f.path ? this.transformPath(f.path) : undefined,
                kind: 'file',
                typeLabel: ext ? ext.toUpperCase() : 'FILE',
                sizeLabel: formatSize(f.sizeBytes),
                sortSize: f.sizeBytes ?? -1,
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
    private readonly table = viewChild(Table);
    private readonly inlineRenameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');
    private readonly deleteCancelButton =
        viewChild<ElementRef<HTMLButtonElement>>('deleteCancelButton');

    constructor() {
        effect(() => {
            const renamingId = this.renamingId();
            const row = this.rows().find((candidate) => candidate.id === renamingId);
            if (row) { this.inlineRenameValue.set(editableName(row.node)); }
            const inputElement = this.inlineRenameInput()?.nativeElement;
            if (inputElement) {
                inputElement.focus();
                inputElement.select();
            }
        });
        effect(() => {
            if (!this.deleteConfirmationId()) { return; }
            this.deleteCancelButton()?.nativeElement.focus();
        });
    }

    /**
     * Clicking the unused space below the rows clears the selection. Delegated from the
     * host rather than bound on that element: it is a background region, not a control,
     * so giving it its own click handler would ask it to be focusable too. The keyboard
     * path to the same outcome is Escape, handled by the container.
     */
    @HostListener('click', ['$event'])
    protected onHostClick(event: MouseEvent): void {
        const target = event.target;
        if (target instanceof Element && target.closest('.pd-current-folder-space')) {
            this.emptySpaceClicked.emit();
        }
    }

    protected trackRow(_index: number, row: RowVm): string {
        return row.id;
    }

    protected onRowDblClick(row: RowVm): void {
        this.itemDoubleClicked.emit(row.node);
    }

    /** Recycle-bin rows focus but never select: the bin has no multi-item actions. */
    protected onBinRowClick(row: RowVm): void {
        this.itemFocused.emit(row.id);
    }

    protected onRowClick(event: MouseEvent, row: RowVm): void {
        this.itemFocused.emit(row.id);
        this.selectionRequested.emit(resolveSelection(event, row.id, {
            selectedIds: this.selectedIds(),
            anchorId: this.selectionAnchorId(),
            renderedIds: this.renderedIds()
        }));
    }

    protected onRowKeydown(event: KeyboardEvent, row: RowVm): void {
        if (event.target instanceof HTMLElement && event.target.closest('input, button')) {
            return;
        }
        if (event.key !== 'Enter' && event.key !== ' ') { return; }
        event.preventDefault();
        this.itemFocused.emit(row.id);
    }

    /** Keyboard activation in the normal table selects, matching a plain click. */
    protected onTableRowKeydown(event: KeyboardEvent, row: RowVm): void {
        if (event.target instanceof HTMLElement && event.target.closest('input, button')) {
            return;
        }
        if (event.key !== 'Enter' && event.key !== ' ') { return; }
        event.preventDefault();
        this.itemFocused.emit(row.id);
        this.selectionRequested.emit({ ids: [row.id], anchorId: row.id });
    }

    protected onRowContextMenu(event: MouseEvent, row: RowVm): void {
        event.preventDefault();
        event.stopPropagation();
        this.itemContextMenuRequested.emit({ event, node: row.node, source: 'table' });
    }

    protected onEmptyContextMenu(event: MouseEvent): void {
        event.preventDefault();
        if ((event.target as HTMLElement).closest('thead') ||
            this.currentFolderIsRecycleBin()) {
            return;
        }
        if (!this.loading()) {
            this.emptyContextMenuRequested.emit(event);
        }
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

    protected confirmDelete(event: Event, node: FileSystemNode): void {
        event.stopPropagation();
        this.deleteConfirmed.emit(node);
    }

    protected cancelDelete(event: Event): void {
        event.stopPropagation();
        this.deleteCancelled.emit();
    }

    protected onDeleteButtonKeydown(event: KeyboardEvent): void {
        if (event.key !== 'Escape') { event.stopPropagation(); }
    }

    protected onCellMouseEnter(event: MouseEvent, cellId: string): void {
        const el = event.currentTarget as HTMLElement;
        this.tooltipSuppressedCellId.set(el.scrollWidth > el.clientWidth ? null : cellId);
    }

    protected onExternalFolderDragOver(event: DragEvent, row: RowVm): void {
        if (this.isInternalDrag(event)) {
            this.internalDragOver.emit({ event,
                targetId: isFolder(row.node) ? row.id : null });

            return;
        }
        if (this.isDropInFolderDisabled(row)) {
            if (event.dataTransfer) { event.dataTransfer.dropEffect = 'none'; }
            event.preventDefault();

            return;
        }
        if (isFolder(row.node)) {
            this.externalFolderDragOver.emit({ event, target: row.node });
        }
    }

    protected onExternalFolderDrop(event: DragEvent, row: RowVm): void {
        if (this.isInternalDrag(event)) {
            this.internalDropped.emit({ event,
                targetId: isFolder(row.node) ? row.id : null });

            return;
        }
        if (isFolder(row.node)) {
            this.externalFolderDropped.emit({ event, target: row.node });
        }
    }

    protected onCurrentFolderDragOver(event: DragEvent): void {
        if (this.isInternalDrag(event)) {
            this.currentFolderDragOver.emit(event);

            return;
        }
        if (this.isCurrentFolderReadonly()) {
            if (event.dataTransfer) { event.dataTransfer.dropEffect = 'none'; }
            event.preventDefault();

            return;
        }
        this.currentFolderDragOver.emit(event);
    }

    protected onCurrentFolderDrop(event: DragEvent): void {
        if (this.isInternalDrag(event)) {
            this.currentFolderDropped.emit(event);

            return;
        }
        if (this.isCurrentFolderReadonly()) {
            event.preventDefault();

            return;
        }
        this.currentFolderDropped.emit(event);
    }

    protected onDragStart(event: DragEvent, node: FileSystemNode): void {
        if (!this.draggableIds().has(node.id) || this.renamingId() === node.id ||
            this.deleteConfirmationId() === node.id) {
            event.preventDefault();

            return;
        }
        this.dragStarted.emit({ event, node, selectedIds: this.selectedIds() });
    }

    private isInternalDrag(event: DragEvent): boolean {
        return this.internalDragActive() || hasInternalDragType(event);
    }

    private submitInlineRename(row: RowVm): void {
        this.renameSubmitted.emit({
            node: row.node,
            name: submittedName(row.node, this.inlineRenameValue())
        });
    }

    // Input format: sites/{siteName}/{listName}/remainingPath
    // Output format: /{listKey}/remainingPath
    private transformPath(path: string): string {
        const segments = path.split('/');
        const pathAfterRoot = segments.slice(3).join('/');
        const listKey = this.currentFolderListKey()
            ? `/${this.currentFolderListKey()?.toLowerCase()}`
            : '';

        return pathAfterRoot ? `${listKey}/${pathAfterRoot}` : listKey;
    }

    /** Row ids in the order the table currently renders them, which sorting changes. */
    private renderedIds(): string[] {
        const rendered = this.table()?.value as RowVm[] | undefined;

        return (rendered ?? []).map((row) => row.id);
    }

    private isDropInFolderDisabled(row: RowVm): boolean {
        return isFolder(row.node) &&
            (row.node.accessLevel === FolderNodeResponseAccessLevelEnum.Readonly
                || this.isCurrentFolderReadonly());
    }
}

function formatSize(bytes: number | undefined): string {
    if (bytes === undefined) { return '—'; }
    if (bytes < 1024) { return `${bytes} B`; }
    if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
    if (bytes < 1024 * 1024 * 1024) { return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }

    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Split a file name into its display base and extension (no leading-dot files). */
// Make isFolder available to template via export indirection if needed later.
export { isFolder };
