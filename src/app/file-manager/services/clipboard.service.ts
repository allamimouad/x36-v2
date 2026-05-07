import { Injectable, computed, signal } from '@angular/core';

export type ClipboardMode = 'cut' | 'copy';

@Injectable()
export class ClipboardService {
  private readonly idsSignal = signal<ReadonlySet<string>>(new Set<string>());
  private readonly modeSignal = signal<ClipboardMode | null>(null);

  readonly ids = this.idsSignal.asReadonly();
  readonly mode = this.modeSignal.asReadonly();
  readonly isEmpty = computed(() => this.idsSignal().size === 0);

  has(id: string): boolean {
    return this.idsSignal().has(id);
  }

  cut(ids: Iterable<string>): void {
    this.set(ids, 'cut');
  }

  copy(ids: Iterable<string>): void {
    this.set(ids, 'copy');
  }

  clear(): void {
    this.idsSignal.set(new Set<string>());
    this.modeSignal.set(null);
  }

  private set(ids: Iterable<string>, mode: ClipboardMode): void {
    const next = new Set(ids);
    this.idsSignal.set(next);
    this.modeSignal.set(next.size > 0 ? mode : null);
  }
}

// TODO(Phase 3): keep paste orchestration outside this service. Paste needs
// FileSystemStore + NavigationStore coordination and belongs in the container
// or a dedicated use-case service; this service should remain pure state.
