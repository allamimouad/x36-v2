import { DatePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    effect,
    ElementRef,
    input,
    output,
    signal,
    viewChild
} from '@angular/core';
import { InputText } from 'primeng/inputtext';
import { ProgressSpinner } from 'primeng/progressspinner';
import { TableModule } from 'primeng/table';
import type {
    ItemRenameRequest,
    SearchResultContextMenuRequest
} from '../../models/context-menu-request.model';
import type { FileSystemNode } from '../../models/file-system-node.model';
import { FileSystemIcon } from '../../shared/file-system-icon/file-system-icon';
import { parentOfRelativePath, relativePathFromRoot } from '../../utils/path.utils';

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
    public readonly error = input<string | null>(null);
    public readonly renamingId = input<string | null>(null);
    public readonly renameError = input<string | null>(null);
    public readonly writingIds = input<ReadonlySet<string>>(new Set<string>());
    public readonly deleteConfirmationId = input<string | null>(null);
    public readonly resultActivated = output<FileSystemNode>();
    public readonly contextMenuRequested = output<SearchResultContextMenuRequest>();
    public readonly renameSubmitted = output<ItemRenameRequest>();
    public readonly renameCancelled = output();
    public readonly renameEdited = output();
    public readonly deleteConfirmed = output<FileSystemNode>();
    public readonly deleteCancelled = output();

    protected readonly inlineRenameValue = signal('');
    private readonly inlineRenameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');
    private readonly deleteCancelButton =
        viewChild<ElementRef<HTMLButtonElement>>('deleteCancelButton');

    constructor() {
        effect(() => {
            const result = this.results().find(({ id }) => id === this.renamingId());
            if (result) {
                this.inlineRenameValue.set(
                    result.kind === 'file' ? fileNameParts(result.name).base : result.name
                );
            }
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
        const editedName = this.inlineRenameValue();
        if (result.kind === 'folder') {
            this.renameSubmitted.emit({ node: result, name: editedName });

            return;
        }
        const { ext } = fileNameParts(result.name);
        const trimmedBase = editedName.trim();
        const completeName = ext && trimmedBase ? `${trimmedBase}.${ext}` : editedName;
        this.renameSubmitted.emit({ node: result, name: completeName });
    }
}

function fileNameParts(name: string): { base: string; ext: string } {
    const dot = name.lastIndexOf('.');
    if (dot <= 0) { return { base: name, ext: '' }; }

    return { base: name.slice(0, dot), ext: name.slice(dot + 1) };
}
