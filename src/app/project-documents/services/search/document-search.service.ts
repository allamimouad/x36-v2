import { DestroyRef, inject, Injectable, signal, type Signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import type { DocumentSearchResult } from '../../models/document-search-result.model';
import type { FolderNode } from '../../models/file-system-node.model';
import { FileSystemApi } from '../file-system/file-system-api';

/** Component-scoped state for one submitted recursive document search. */
@Injectable()
export class DocumentSearchService {
    public readonly results: Signal<DocumentSearchResult[]>;
    public readonly activeQuery: Signal<string | null>;
    public readonly isSearching: Signal<boolean>;
    public readonly error: Signal<unknown | null>;
    public readonly totalMatches: Signal<number>;
    public readonly truncated: Signal<boolean>;
    public readonly activeScopeId: Signal<string | null>;

    private readonly api = inject(FileSystemApi);
    private readonly destroyRef = inject(DestroyRef);
    private readonly _results = signal<DocumentSearchResult[]>([]);
    private readonly _activeQuery = signal<string | null>(null);
    private readonly _isSearching = signal(false);
    private readonly _error = signal<unknown | null>(null);
    private readonly _totalMatches = signal(0);
    private readonly _truncated = signal(false);
    private readonly _activeScopeId = signal<string | null>(null);
    private request: Subscription | null = null;
    private requestVersion = 0;

    constructor() {
        this.results = this._results.asReadonly();
        this.activeQuery = this._activeQuery.asReadonly();
        this.isSearching = this._isSearching.asReadonly();
        this.error = this._error.asReadonly();
        this.totalMatches = this._totalMatches.asReadonly();
        this.truncated = this._truncated.asReadonly();
        this.activeScopeId = this._activeScopeId.asReadonly();
        this.destroyRef.onDestroy(() => this.request?.unsubscribe());
    }

    public search(projectId: string, scope: FolderNode, query: string): void {
        const normalizedQuery = query.trim();
        const version = ++this.requestVersion;
        this.request?.unsubscribe();
        this._activeQuery.set(normalizedQuery);
        this._results.set([]);
        this._error.set(null);
        this._totalMatches.set(0);
        this._truncated.set(false);
        this._activeScopeId.set(scope.id);
        this._isSearching.set(true);

        this.request = this.api.searchDocuments(projectId, scope, normalizedQuery).subscribe({
            next: (response) => {
                if (version !== this.requestVersion) { return; }
                this._results.set(response.results);
                this._totalMatches.set(response.totalMatches);
                this._truncated.set(response.truncated);
            },
            error: (error: unknown) => {
                if (version !== this.requestVersion) { return; }
                this._error.set(error);
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
        this._totalMatches.set(0);
        this._truncated.set(false);
        this._activeScopeId.set(null);
        this._isSearching.set(false);
    }
}
