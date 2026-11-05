import { DatePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    effect,
    ElementRef,
    HostListener,
    input,
    output,
    signal,
    viewChild
} from '@angular/core';
import { InputText } from 'primeng/inputtext';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Table, TableModule } from 'primeng/table';
import type {
    ItemRenameRequest,
    SearchResultContextMenuRequest
} from '../../models/context-menu-request.model';
import type { ItemDragRequest } from '../../models/drag-state.model';
import type { FileSystemNode } from '../../models/file-system-node.model';
import type { SelectionRequest } from '../../models/selection-request.model';
import { FileSystemIcon } from '../../shared/file-system-icon/file-system-icon';
import { editableName, submittedName } from '../../utils/naming.utils';
import { parentOfRelativePath, relativePathFromRoot } from '../../utils/path.utils';
import { resolveSelection } from '../../utils/selection.utils';

@Component({
    selector: 'pr-search-results',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DatePipe, FileSystemIcon, InputText, ProgressSpinner, TableModule],
    templateUrl: './search-results.html',
    styleUrl: './search-results.scss'
})
export class SearchResults {
    public readonly results = input.required<FileSystemNode[]>();
    public readonly rootPath = input.required<string>();
    public readonly query = input.required<string>();
    public readonly loading = input(false);
    /** A reconciling re-query with rows already up: indicated, never blocking. */
    public readonly refreshing = input(false);
    public readonly error = input<string | null>(null);
    public readonly renamingId = input<string | null>(null);
    public readonly renameError = input<string | null>(null);
    public readonly writingIds = input<ReadonlySet<string>>(new Set<string>());
    public readonly deleteConfirmationId = input<string | null>(null);
    public readonly draggableIds = input<ReadonlySet<string>>(new Set<string>());
    public readonly internalSourceIds = input<ReadonlySet<string>>(new Set<string>());
    public readonly selectedIds = input<ReadonlySet<string>>(new Set<string>());
    public readonly selectionAnchorId = input<string | null>(null);
    public readonly cutIds = input<ReadonlySet<string>>(new Set<string>());
    public readonly resultActivated = output<FileSystemNode>();
    public readonly selectionRequested = output<SelectionRequest>();
    public readonly emptySpaceClicked = output();
    public readonly dragStarted = output<ItemDragRequest>();
    public readonly dragEnded = output();
    public readonly contextMenuRequested = output<SearchResultContextMenuRequest>();
    public readonly emptyContextMenuRequested = output<MouseEvent>();
    public readonly renameSubmitted = output<ItemRenameRequest>();
    public readonly renameCancelled = output();
    public readonly renameEdited = output();
    public readonly deleteConfirmed = output<FileSystemNode>();
    public readonly deleteCancelled = output();

    protected readonly inlineRenameValue = signal('');
    private readonly inlineRenameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');
    private readonly deleteCancelButton =
        viewChild<ElementRef<HTMLButtonElement>>('deleteCancelButton');
    private readonly table = viewChild(Table);

    constructor() {
        effect(() => {
            const result = this.results().find(({ id }) => id === this.renamingId());
            if (result) { this.inlineRenameValue.set(editableName(result)); }
            const inputElement = this.inlineRenameInput()?.nativeElement;
            if (inputElement) {
                inputElement.focus();
                inputElement.select();
            }
        });
        effect(() => {
            if (this.deleteConfirmationId()) {
                this.deleteCancelButton()?.nativeElement.focus();
            }
        });
    }

    /**
     * Anything outside a row counts as empty space and clears the selection. The
     * right-pane table has a dedicated element to test for; this surface is only the
     * table, so the absence of a row is the test. Bound on the host, as there too, so
     * the wrapper does not need keyboard handlers of its own — Escape is the keyboard
     * path and the container owns it.
     */
    @HostListener('click', ['$event'])
    protected onHostClick(event: MouseEvent): void {
        if (event.target instanceof Element && !event.target.closest('tr')) {
            this.emptySpaceClicked.emit();
        }
    }

    protected onRowClick(event: MouseEvent, result: FileSystemNode): void {
        if (event.target instanceof HTMLElement && event.target.closest('input, button')) {
            return;
        }
        this.selectionRequested.emit(resolveSelection(event, result.id, {
            selectedIds: this.selectedIds(),
            anchorId: this.selectionAnchorId(),
            renderedIds: this.renderedIds()
        }));
    }

    protected onDragStart(event: DragEvent, result: FileSystemNode): void {
        if (!this.draggableIds().has(result.id) || this.renamingId() === result.id ||
            this.deleteConfirmationId() === result.id) {
            event.preventDefault();

            return;
        }
        // The rows travel with the ids: a search result is never cached, so the drag
        // could not resolve this selection from the cache alone.
        //
        // Reported ids are intersected with the rows on screen. The container already
        // reconciles the selection against each new result set, so this is not what
        // keeps an invisible row out of a drag — it is so this component never forwards
        // an input it can see is stale, which is its own business either way.
        const selected = this.selectedIds();
        const selectedNodes = this.results().filter(({ id }) => selected.has(id));
        this.dragStarted.emit({
            event,
            node: result,
            selectedIds: new Set(selectedNodes.map(({ id }) => id)),
            selectedNodes
        });
    }

    protected activate(event: Event, result: FileSystemNode): void {
        if (event.target instanceof HTMLElement && event.target.closest('input, button')) {
            return;
        }
        if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') {
            return;
        }
        if (event instanceof KeyboardEvent) { event.preventDefault(); }
        this.resultActivated.emit(result);
    }

    protected openContextMenu(event: MouseEvent, result: FileSystemNode): void {
        event.preventDefault();
        event.stopPropagation();
        this.contextMenuRequested.emit({ event, result });
    }

    protected openEmptyContextMenu(event: MouseEvent): void {
        event.preventDefault();
        if ((event.target as HTMLElement).closest('thead')) { return; }
        this.emptyContextMenuRequested.emit(event);
    }

    protected location(result: FileSystemNode): string {
        const relativePath = relativePathFromRoot(this.rootPath(), result.path);
        const parentPath = parentOfRelativePath(relativePath);
        const suffix = parentPath
            ? `/${parentPath}`
            : '';

        return `${result.listKey.toLowerCase()}${suffix}`;
    }

    protected onInlineRenameInput(event: Event): void {
        this.inlineRenameValue.set((event.target as HTMLInputElement).value);
        this.renameEdited.emit();
    }

    protected onInlineRenameKeydown(event: KeyboardEvent, result: FileSystemNode): void {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.renameCancelled.emit();

            return;
        }
        if (event.key !== 'Enter') { return; }
        event.preventDefault();
        event.stopPropagation();
        this.submitInlineRename(result);
    }

    protected onInlineRenameBlur(result: FileSystemNode): void {
        this.submitInlineRename(result);
    }

    protected confirmDelete(event: Event, result: FileSystemNode): void {
        event.stopPropagation();
        this.deleteConfirmed.emit(result);
    }

    protected cancelDelete(event: Event): void {
        event.stopPropagation();
        this.deleteCancelled.emit();
    }

    protected onDeleteButtonKeydown(event: KeyboardEvent): void {
        if (event.key !== 'Escape') { event.stopPropagation(); }
    }

    private submitInlineRename(result: FileSystemNode): void {
        this.renameSubmitted.emit({
            node: result,
            name: submittedName(result, this.inlineRenameValue())
        });
    }

    /** Row ids in the order the table currently renders them, which sorting changes. */
    private renderedIds(): string[] {
        const rendered = this.table()?.value as FileSystemNode[] | undefined;

        return (rendered ?? []).map(({ id }) => id);
    }
}
