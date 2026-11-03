import { DestroyRef, inject, Injectable, signal, type Signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { FileSystemError } from '../../models/file-system-error.model';
import type { FileSystemNode, FolderNode } from '../../models/file-system-node.model';
import { FileSystemApi } from '../file-system/file-system-api';

/** Component-scoped state for one submitted recursive document search. */
@Injectable()
export class DocumentSearchService {
    public readonly results: Signal<FileSystemNode[]>;
    public readonly activeQuery: Signal<string | null>;
    public readonly isSearching: Signal<boolean>;
    public readonly error: Signal<FileSystemError | null>;
    public readonly activeScopeId: Signal<string | null>;

    private readonly api = inject(FileSystemApi);
    private readonly destroyRef = inject(DestroyRef);
    private readonly _results = signal<FileSystemNode[]>([]);
    private readonly _activeQuery = signal<string | null>(null);
    private readonly _isSearching = signal(false);
    private readonly _error = signal<FileSystemError | null>(null);
    private readonly _activeScopeId = signal<string | null>(null);
    private request: Subscription | null = null;
    private requestVersion = 0;

    constructor() {
        this.results = this._results.asReadonly();
        this.activeQuery = this._activeQuery.asReadonly();
        this.isSearching = this._isSearching.asReadonly();
        this.error = this._error.asReadonly();
        this.activeScopeId = this._activeScopeId.asReadonly();
        this.destroyRef.onDestroy(() => this.request?.unsubscribe());
    }

    /**
     * Drop results whose ids were removed (a moved or deleted subtree), mirroring the
     * same method on `NavigationStore` and `ClipboardService`. Scoping by removed ids
     * is right per operation on its own: a delete or move removes ids so the row goes,
     * a copy removes none so the list is untouched. Re-running the search instead would
     * make every action wait for a query that can take tens of seconds.
     */
    public pruneReferences(removedIds: Iterable<string>): void {
        const removed = new Set(removedIds);
        if (removed.size === 0) { return; }
        const current = this._results();
        const next = current.filter(({ id }) => !removed.has(id));
        if (next.length !== current.length) { this._results.set(next); }
    }

    public search(projectId: string, scope: FolderNode, query: string): void {
        const normalizedQuery = query.trim();
        const version = ++this.requestVersion;
        this.request?.unsubscribe();
        this._activeQuery.set(normalizedQuery);
        this._results.set([]);
        this._error.set(null);
        this._activeScopeId.set(scope.id);
        this._isSearching.set(true);

        this.request = this.api.searchDocuments(projectId, scope, normalizedQuery).subscribe({
            next: (results) => {
                if (version !== this.requestVersion) { return; }
                this._results.set(results);
            },
            error: (error: unknown) => {
                if (version !== this.requestVersion) { return; }
                this._error.set(
                    error instanceof FileSystemError
                        ? error
                        : new FileSystemError('unknown', 'Document search failed', error)
                );
                this._isSearching.set(false);
            },
            complete: () => {
                if (version === this.requestVersion) { this._isSearching.set(false); }
            }
        });
    }

    public clear(): void {
        this.requestVersion++;
        this.request?.unsubscribe();
        this.request = null;
        this._activeQuery.set(null);
        this._results.set([]);
        this._error.set(null);
        this._activeScopeId.set(null);
        this._isSearching.set(false);
    }
}
