import { inject, Injectable } from '@angular/core';
import type { FileSystemNode } from '../../models/file-system-node.model';
import { FILE_MANAGER_CONFIG } from '../../tokens/file-manager-config.token';
import { NavigationStore } from '../../stores/navigation.store';
import { ConcurrencyQueue } from '../upload/concurrency-queue';
import { DocumentSearchService } from '../search/document-search.service';
import { ClipboardService } from './clipboard.service';
import { NotificationService } from './notification.service';

/**
 * What one item of a batch produced.
 *
 * A discriminated union rather than optional `error`/`abandoned` flags, because the
 * rules were only expressible as a convention: a missing error meant success, and every
 * caller had to strip skipped items first or count them among the successes. Naming the
 * status makes both impossible to forget — `removed` exists only where it means
 * something, and `error` only where there is one.
 */
export type BulkOutcome =
    | {
        status: 'done';
        node: FileSystemNode;
        /** Cache ids the operation removed; empty when it removed nothing. */
        removed: string[];
    }
    | { status: 'failed'; node: FileSystemNode; error: unknown }
    /** The batch went stale before this item left the queue, so it never ran. */
    | { status: 'skipped'; node: FileSystemNode };

/** An item the batch carried out — the only status carrying `removed`. */
export type DoneOutcome = Extract<BulkOutcome, { status: 'done' }>;

/** An item the batch attempted and lost — the only status carrying `error`. */
export type FailedOutcome = Extract<BulkOutcome, { status: 'failed' }>;

/** The items a batch actually carried out, which is what every caller acts on. */
export function doneOf(outcomes: readonly BulkOutcome[]): DoneOutcome[] {
    return outcomes.filter(
        (outcome): outcome is DoneOutcome => outcome.status === 'done'
    );
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
     * Settle everything a finished batch implies: drop references to what it removed,
     * then reconcile the search against the server.
     *
     * Named for the whole job rather than the pruning, because the last line issues a
     * request — a caller reading `pruneReferences` would expect cache bookkeeping only.
     *
     * The ids give instant feedback on the rows the user acted on. Everything else a
     * mutation implies — uncached descendants, paths beneath a renamed folder — is left
     * to `refresh`, which is right about them by construction rather than by matching
     * paths, and does nothing when no search is active.
     */
    public reconcileAfterBatch(removedIds: readonly string[]): void {
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
    public report(outcomes: readonly BulkOutcome[], verb: string, shortfall: string): void {
        // Skipped items are dropped here rather than by each caller. They are neither
        // done nor failed — nothing was attempted — and counting them either way
        // reported work that never happened.
        const settled = outcomes.filter((outcome) => outcome.status !== 'skipped');
        if (settled.length === 0) { return; }
        const failed = settled.filter(
            (outcome): outcome is FailedOutcome => outcome.status === 'failed'
        );
        if (failed.length === settled.length) {
            this.notifications.error(failed[0].error);

            return;
        }
        if (failed.length === 0) {
            this.notifications.success(settled.length === 1
                ? `${settled[0].node.name} was ${verb}.`
                : `${settled.length} items were ${verb}.`);

            return;
        }
        const names = failed.map((outcome) => outcome.node.name).join(', ');
        this.notifications.warning(
            `${settled.length - failed.length} of ${settled.length} items ${verb}. ` +
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
        if (!request.isCurrent()) { return { status: 'skipped', node }; }
        try {
            return { status: 'done', node, removed: await request.run(node) };
        } catch (error) {
            return { status: 'failed', node, error };
        }
    }
}
