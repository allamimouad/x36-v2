import { Injectable, type Signal, computed, signal } from '@angular/core';

export type ClipboardMode = 'cut' | 'copy';

@Injectable()
export class ClipboardService {
    public readonly ids: Signal<ReadonlySet<string>>;
    public readonly mode: Signal<ClipboardMode | null>;
    public readonly isEmpty: Signal<boolean>;

    private readonly idsSignal = signal<ReadonlySet<string>>(new Set<string>());
    private readonly modeSignal = signal<ClipboardMode | null>(null);

    public constructor() {
        this.ids = this.idsSignal.asReadonly();
        this.mode = this.modeSignal.asReadonly();
        this.isEmpty = computed(() => this.idsSignal().size === 0);
    }

    public has(id: string): boolean {
        return this.idsSignal().has(id);
    }

    public cut(ids: Iterable<string>): void {
        this.set(ids, 'cut');
    }

    public copy(ids: Iterable<string>): void {
        this.set(ids, 'copy');
    }

    public clear(): void {
        this.idsSignal.set(new Set<string>());
        this.modeSignal.set(null);
    }

    /**
   * Drop any clipboard ids that were removed from the cache (e.g. a moved subtree).
   * If that empties the clipboard, the mode is cleared too.
   */
    public pruneReferences(removedIds: Iterable<string>): void {
        const removed = new Set(removedIds);
        if (removed.size === 0) { return; }
        const current = this.idsSignal();
        let changed = false;
        const next = new Set<string>();
        for (const id of current) {
            if (removed.has(id)) { changed = true; }
            else { next.add(id); }
        }
        if (!changed) { return; }
        this.idsSignal.set(next);
        if (next.size === 0) { this.modeSignal.set(null); }
    }

    private set(ids: Iterable<string>, mode: ClipboardMode): void {
        const next = new Set(ids);
        this.idsSignal.set(next);
        this.modeSignal.set(next.size > 0 ? mode : null);
    }
}

// TODO: paste arrives with the cut/copy/paste US.
// Keep paste orchestration outside this service. Paste needs
// FileSystemStore + NavigationStore coordination and belongs in the container
// or a dedicated use-case service; this service should remain pure state.
