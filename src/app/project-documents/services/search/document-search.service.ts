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
     * Drop results by id, mirroring the same method on `NavigationStore` and
     * `ClipboardService`.
     *
     * Results are a snapshot of one query, and every mutation already returns enough to
     * update that snapshot, so the list is maintained from those results rather than by
     * re-running the search — which would charge the user the full search latency on
     * every action to rediscover what we already know.
     *
     * Callers must pass the operation's own source ids as well as whatever the cache
     * removed: a search hit is usually not cached, so the cache reports nothing for it.
     */
    public pruneReferences(removedIds: Iterable<string>): void {
        const removed = new Set(removedIds);
        if (removed.size === 0) { return; }
        const current = this._results();
        const next = current.filter(({ id }) => !removed.has(id));
        if (next.length !== current.length) { this._results.set(next); }
    }

    /**
     * Replace a result with its canonical form after an operation that kept it in the
     * set — a rename, where only the name and path changed. Does nothing when the id is
     * not among the current results.
     */
    public replaceResult(node: FileSystemNode): void {
        const current = this._results();
        const index = current.findIndex(({ id }) => id === node.id);
        if (index === -1) { return; }
        const next = [...current];
        next[index] = node;
        this._results.set(next);
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
