import { inject, Injectable } from '@angular/core';
import type { FileSystemNode } from '../../models/file-system-node.model';
import { FILE_MANAGER_CONFIG } from '../../tokens/file-manager-config.token';
import { NavigationStore } from '../../stores/navigation.store';
import { ConcurrencyQueue } from '../upload/concurrency-queue';
import { DocumentSearchService } from '../search/document-search.service';
import { ClipboardService } from './clipboard.service';
import { NotificationService } from './notification.service';

/** What one item of a batch produced. */
export interface BulkOutcome {
    node: FileSystemNode;
    /** Cache ids the operation removed; empty when it removed nothing. */
    removed: string[];
    error?: unknown;
    /** Set when the batch went stale before this item left the queue, so it never ran. */
    abandoned?: boolean;
}

export interface BulkRequest {
    items: readonly FileSystemNode[];
    /** Runs one item and returns the cache ids it removed. */
    run: (node: FileSystemNode) => Promise<string[]>;
    /** False once the work no longer belongs to the loaded project or live component. */
    isCurrent: () => boolean;
}

/**
 * Runs one operation over many items: bounded concurrency, each item's failure isolated
 * from the rest, and one summary instead of a toast per item.
 *
 * Sequencing stays with the caller, because what to do after a batch differs — a drag
 * opens its drop target, a delete opens the removed folder's parent. The caller runs the
 * batch, decides where to land, then prunes and reports through here.
 */
@Injectable()
export class BulkOperationService {
    private readonly config = inject(FILE_MANAGER_CONFIG);
    private readonly navigation = inject(NavigationStore);
    private readonly clipboard = inject(ClipboardService);
    private readonly search = inject(DocumentSearchService);
    private readonly notifications = inject(NotificationService);

    public async run(request: BulkRequest): Promise<BulkOutcome[]> {
        const queue = new ConcurrencyQueue(this.config.bulkOpConcurrency);

        return Promise.all(request.items.map(
            (node) => queue.enqueue(() => this.runOne(request, node))
        ));
    }

    /**
     * Drop every reference to what the batch removed, then reconcile the search.
     *
     * The ids give instant feedback on the rows the user acted on. Everything else a
     * mutation implies — uncached descendants, paths beneath a renamed folder — is left
     * to `refresh`, which is right about them by construction rather than by matching
     * paths, and does nothing when no search is active.
     */
    public pruneReferences(removedIds: readonly string[]): void {
        this.navigation.pruneReferences(removedIds);
        this.clipboard.pruneReferences(removedIds);
        this.search.pruneReferences(removedIds);
        this.search.refresh();
    }

    /**
     * One summary for the batch. Successes are never rolled back: undoing them would
     * mean issuing deletes that can fail in turn, on items the user can see.
     *
     * `shortfall` names what the failures did instead — "stayed in place" for a move,
     * since a partly-failed batch leaves the selection split.
     */
    public report(outcomes: BulkOutcome[], verb: string, shortfall: string): void {
        if (outcomes.length === 0) { return; }
        const failed = outcomes.filter((outcome) => outcome.error !== undefined);
        if (failed.length === outcomes.length) {
            this.notifications.error(failed[0].error);

            return;
        }
        if (failed.length === 0) {
            this.notifications.success(outcomes.length === 1
                ? `${outcomes[0].node.name} was ${verb}.`
                : `${outcomes.length} items were ${verb}.`);

            return;
        }
        const names = failed.map((outcome) => outcome.node.name).join(', ');
        this.notifications.warning(
            `${outcomes.length - failed.length} of ${outcomes.length} items ${verb}. ` +
            `${failed.length} ${shortfall}: ${names}.`
        );
    }

    /**
     * Checked here rather than only once the queue drains: a batch larger than
     * `bulkOpConcurrency` leaves items waiting, and work that went stale while they
     * waited must not go out at all. Requests already sent cannot be recalled — the
     * store's connection revision discards their results instead.
     */
    private async runOne(request: BulkRequest, node: FileSystemNode): Promise<BulkOutcome> {
        if (!request.isCurrent()) { return { node, removed: [], abandoned: true }; }
        try {
            return { node, removed: await request.run(node) };
        } catch (error) {
            return { node, removed: [], error };
        }
    }
}
