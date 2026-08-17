import { Injectable, type Signal, computed, signal } from '@angular/core';
import type { FileSystemNode } from '../../models/file-system-node.model';

export type ClipboardMode = 'cut' | 'copy';

@Injectable()
export class ClipboardService {
    public readonly nodes: Signal<readonly FileSystemNode[]>;
    public readonly ids: Signal<ReadonlySet<string>>;
    public readonly mode: Signal<ClipboardMode | null>;
    public readonly isEmpty: Signal<boolean>;

    private readonly nodesSignal = signal<readonly FileSystemNode[]>([]);
    private readonly modeSignal = signal<ClipboardMode | null>(null);

    constructor() {
        this.nodes = this.nodesSignal.asReadonly();
        this.ids = computed(() => new Set(this.nodesSignal().map(({ id }) => id)));
        this.mode = this.modeSignal.asReadonly();
        this.isEmpty = computed(() => this.nodesSignal().length === 0);
    }

    public has(id: string): boolean {
        return this.nodesSignal().some((node) => node.id === id);
    }

    public cut(nodes: Iterable<FileSystemNode>): void {
        this.set(nodes, 'cut');
    }

    public copy(nodes: Iterable<FileSystemNode>): void {
        this.set(nodes, 'copy');
    }

    public clear(): void {
        this.nodesSignal.set([]);
        this.modeSignal.set(null);
    }

    /**
   * Drop clipboard nodes whose ids were removed (e.g. a moved or deleted subtree).
   * If that empties the clipboard, the mode is cleared too.
   */
    public pruneReferences(removedIds: Iterable<string>): void {
        const removed = new Set(removedIds);
        if (removed.size === 0) { return; }
        const current = this.nodesSignal();
        const next = current.filter(({ id }) => !removed.has(id));
        if (next.length === current.length) { return; }
        this.nodesSignal.set(next);
        if (next.length === 0) { this.modeSignal.set(null); }
    }

    private set(nodes: Iterable<FileSystemNode>, mode: ClipboardMode): void {
        const unique = new Map<string, FileSystemNode>();
        for (const node of nodes) { unique.set(node.id, node); }
        const next = [...unique.values()];
        this.nodesSignal.set(next);
        this.modeSignal.set(next.length > 0 ? mode : null);
    }
}
