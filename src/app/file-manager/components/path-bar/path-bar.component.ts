import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Menu } from 'primeng/menu';
import type { MenuItem } from 'primeng/api';
import type { PathSegment } from '../../stores/navigation.store';

/**
 * Dumb address bar. Shows a fixed `/{projectLabel}/` prefix plus either the breadcrumb
 * (normal mode) or an editable path input (edit mode). Edit mode is parent-controlled:
 * this component only emits intent (`editRequested`/`editCancelled`/`pathSubmitted`).
 * No list-key validation here — the container owns that.
 *
 * The breadcrumb never grows the toolbar or scrolls horizontally. When the segments
 * don't fit, the LAST (current) folders are kept and the leading ones collapse into a
 * clickable `…` overflow menu. Parents are shown full-width or collapsed — never
 * truncated; only the current folder ellipsis-truncates, and only when it is the sole
 * visible segment. Fitting measures natural segment widths in an out-of-flow row, then
 * applies the fitted suffix to the visible breadcrumb.
 */
@Component({
  selector: 'app-path-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Menu],
  templateUrl: './path-bar.component.html',
  styleUrl: './path-bar.component.scss',
})
export class PathBarComponent {
  readonly segments = input.required<PathSegment[]>();
  readonly projectLabel = input.required<string>();
  readonly editablePath = input<string>('');
  readonly editing = input<boolean>(false);
  readonly resolving = input<boolean>(false);
  readonly pathError = input<string | null>(null);

  readonly editRequested = output<void>();
  readonly editCancelled = output<void>();
  readonly segmentClicked = output<PathSegment>();
  readonly pathSubmitted = output<string>();

  private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  /** The rendered breadcrumb `<nav>`; measured directly for overflow. */
  private readonly breadcrumbRef = viewChild<ElementRef<HTMLElement>>('breadcrumb');
  /** Out-of-flow row that renders all segments at natural width for measurement. */
  private readonly measureRef = viewChild<ElementRef<HTMLElement>>('measure');
  private readonly measureSepRef = viewChild<ElementRef<HTMLElement>>('measureSep');
  /** The fixed `ProjectName ›` prefix; its width is subtracted from the available space. */
  private readonly prefixRef = viewChild<ElementRef<HTMLElement>>('prefix');
  /** Off-screen copy of the `…` button, so its real width can be measured and cached. */
  private readonly overflowSizerRef = viewChild<ElementRef<HTMLElement>>('overflowSizer');
  /** The clickable edit strip; its CSS `min-width` is the reserve kept for entering edit. */
  private readonly editZoneRef = viewChild<ElementRef<HTMLElement>>('editZone');
  /** The path `<input>`, focused programmatically when edit mode opens. */
  private readonly pathInputRef = viewChild<ElementRef<HTMLInputElement>>('pathInput');

  /** Local draft of the editable path, seeded from `editablePath` on entering edit mode. */
  protected readonly draft = signal('');

  /** How many leading segments are collapsed into the `…` overflow menu. */
  private readonly collapsedCount = signal(0);
  /** The segment/project snapshot that `collapsedCount` was computed for. */
  private readonly fittedKey = signal<string | null>(null);

  private readonly fitKey = computed(() => {
    const parts = this.segments().map((seg) =>
      [seg.id ?? '', seg.listKey ?? '', seg.path ?? '', seg.label].join('\u001f'),
    );
    return [this.projectLabel(), ...parts].join('\u001e');
  });

  /** Always keep at least the last (current) segment visible. */
  private readonly effectiveCollapsed = computed(() => {
    const maxCollapsed = Math.max(0, this.segments().length - 1);
    if (this.fittedKey() !== this.fitKey()) {
      return maxCollapsed;
    }
    return Math.min(this.collapsedCount(), maxCollapsed);
  });

  protected readonly overflowSegments = computed(() =>
    this.segments().slice(0, this.effectiveCollapsed()),
  );
  protected readonly visibleSegments = computed(() =>
    this.segments().slice(this.effectiveCollapsed()),
  );

  /** Index offset of the first visible segment (for stable `data-testid`s). */
  protected readonly visibleStartIndex = computed(() => this.effectiveCollapsed());

  protected readonly overflowMenuItems = computed<MenuItem[]>(() =>
    this.overflowSegments().map((seg) => ({
      label: seg.label,
      command: () => this.segmentClicked.emit(seg),
    })),
  );

  /** Bumped on every fit pass so a stale scheduled callback self-cancels. */
  private fitGen = 0;
  /** Natural widths of all segments (index-aligned with `segments()`), and a separator. */
  private cachedWidths: number[] = [];
  private cachedSepW = 16;
  private cachedGapW = 0;
  /** Measured width of the `…` overflow button (reserved when collapsing). */
  private cachedOverflowW = 32;
  /** Host horizontal padding, measured once (so available width accounts for it exactly). */
  private hostPadX = 0;
  /** Clickable strip reserved for entering edit mode; read from `.fm-edit-zone`'s CSS
   *  `min-width` (not hardcoded) so it can't drift from the stylesheet. */
  private editReservePx = 20;

  /** Give up re-measuring after this many frames if the view never settles. */
  private static readonly MAX_MEASURE_RETRIES = 5;

  constructor() {
    afterNextRender(() => {
      const cs = getComputedStyle(this.hostRef.nativeElement);
      this.hostPadX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      this.refreshEditReserve();
      // Resize only changes available width, not segment text → re-fit from cached widths
      // (no re-measure, no full-path flash) so dragging the splitter/window stays smooth.
      const observer = new ResizeObserver(() => this.refit());
      observer.observe(this.hostRef.nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
      this.remeasureAndFit();
    });

    // Segment text changed → re-measure widths, then fit. Reads only these inputs (never
    // collapsedCount), so setting collapsedCount below can't feed back into the effect.
    effect(() => {
      this.fitKey();
      this.editing();
      this.remeasureAndFit();
    });

    // Focus the path input when edit mode opens. The `autofocus` attribute doesn't fire
    // for an element Angular inserts via `@if`, so without this the input is never focused
    // and a click-outside has nothing to blur (edit mode wouldn't close on first try).
    effect(() => {
      const input = this.pathInputRef()?.nativeElement;
      if (this.editing() && input) {
        input.focus();
        input.select();
      }
    });
  }

  /** Read the edit strip's reserve from its CSS `min-width` so it tracks the stylesheet. */
  private refreshEditReserve(): void {
    const el = this.editZoneRef()?.nativeElement;
    if (!el) return;
    const mw = parseFloat(getComputedStyle(el).minWidth);
    if (!Number.isNaN(mw)) this.editReservePx = mw;
  }

  /** Available width for the breadcrumb: host content box minus prefix and the edit strip. */
  private availablePx(): number {
    const host = this.hostRef.nativeElement;
    const prefixW = this.prefixRef()?.nativeElement.offsetWidth ?? 0;
    return Math.max(0, host.clientWidth - this.hostPadX - prefixW - this.editReservePx);
  }

  /**
   * Measure every segment's natural width from the out-of-flow measurement row, cache the
   * widths, then fit. Used whenever segment text may have changed. Retries are bounded and
   * generation-guarded so a never-settling DOM can't render forever.
   */
  private remeasureAndFit(retries = 0): void {
    if (this.editing()) {
      return;
    }
    const gen = ++this.fitGen;
    const key = this.fitKey();
    requestAnimationFrame(() => {
      // Superseded by a newer pass.
      if (gen !== this.fitGen) return;
      if (key !== this.fitKey()) return;
      if (this.editing()) {
        return;
      }
      const measureEl = this.measureRef()?.nativeElement;
      const segEls = measureEl
        ? Array.from(measureEl.querySelectorAll<HTMLElement>('.fm-measure-seg'))
        : [];
      if (!measureEl || segEls.length !== this.segments().length) {
        // View not settled yet — don't stay hidden between attempts; retry a bounded
        // number of times, and only while this pass is still the active one.
        if (retries < PathBarComponent.MAX_MEASURE_RETRIES) {
          requestAnimationFrame(() => {
            if (gen !== this.fitGen) return; // a newer trigger now owns fitting
            if (key !== this.fitKey()) return;
            this.remeasureAndFit(retries + 1);
          });
        }
        // else: give up — leave the last fitted breadcrumb in place; no infinite loop.
        return;
      }
      this.cachedWidths = segEls.map((el) => el.offsetWidth);
      const gap = parseFloat(getComputedStyle(measureEl).columnGap);
      this.cachedGapW = Number.isFinite(gap) ? gap : 0;
      const sep = this.measureSepRef()?.nativeElement;
      if (sep) this.cachedSepW = sep.offsetWidth;
      const sizer = this.overflowSizerRef()?.nativeElement;
      if (sizer) this.cachedOverflowW = sizer.offsetWidth;
      this.refreshEditReserve();
      this.applyFit(gen, key);
    });
  }

  /** Recompute the collapse target from cached widths against the current width. */
  private refit(): void {
    if (this.editing()) return;
    if (this.cachedWidths.length !== this.segments().length) {
      this.remeasureAndFit();
      return;
    }
    this.applyFit(++this.fitGen, this.fitKey());
  }

  /**
   * Single deterministic pass: keep the largest contiguous suffix of segments whose full
   * natural widths fit the available width (reserving room for the `…` button when any
   * leading segment is collapsed). Then a bounded, increment-only safety check absorbs any
   * sub-pixel/reserve imprecision so the row never actually overflows.
   */
  private applyFit(gen: number, key: string): void {
    const n = this.cachedWidths.length;
    if (n === 0) {
      this.collapsedCount.set(0);
      this.fittedKey.set(key);
      return;
    }
    const sepW = this.cachedSepW;
    const gapW = this.cachedGapW;
    const available = this.availablePx();
    const totalSegmentW = this.cachedWidths.reduce((sum, w) => sum + w, 0);
    const total = totalSegmentW + sepW * (n - 1) + gapW * Math.max(0, 2 * n - 2);

    let target: number;
    if (n === 1 || total <= available) {
      target = 0;
    } else {
      let suffixSegmentW = this.cachedWidths[n - 1]; // current folder is always kept
      let shown = 1;
      for (let i = n - 2; i >= 0; i--) {
        const nextShown = shown + 1;
        const nextSegmentW = suffixSegmentW + this.cachedWidths[i];
        const collapsedW =
          this.cachedOverflowW + nextSegmentW + sepW * nextShown + gapW * (2 * nextShown);
        if (collapsedW <= available) {
          suffixSegmentW = nextSegmentW;
          shown = nextShown;
        } else {
          break;
        }
      }
      target = n - shown;
    }
    this.collapsedCount.set(target);
    this.fittedKey.set(key);
    requestAnimationFrame(() => this.correctOverflow(gen));
  }

  /**
   * Safety net: if the rendered row still overflows (reserve/padding estimate was a touch
   * low), collapse one more — increment-only, so it converges and never oscillates.
   */
  private correctOverflow(gen: number): void {
    if (gen !== this.fitGen || this.editing()) return;
    const nav = this.breadcrumbRef()?.nativeElement;
    if (!nav) return;
    const c = this.collapsedCount();
    if (nav.scrollWidth > nav.clientWidth + 1 && c < this.segments().length - 1) {
      this.collapsedCount.set(c + 1);
      requestAnimationFrame(() => this.correctOverflow(gen));
    }
  }

  protected onEnterEdit(): void {
    this.draft.set(this.editablePath());
    this.editRequested.emit();
  }

  protected onDraftInput(value: string): void {
    this.draft.set(value);
  }

  protected onSubmit(): void {
    if (this.resolving()) return; // guard against duplicate submits while a resolve is in flight
    // Enter on a plain input doesn't blur it, so a successful submit closes edit mode via
    // the parent (which removes the input); any resulting blur → a harmless extra cancel.
    this.pathSubmitted.emit(this.draft());
  }

  protected onCancel(): void {
    this.editCancelled.emit();
  }

  protected onBlur(): void {
    // Ignore the blur that fires when the input is disabled mid-resolve; only a genuine
    // user blur (not resolving) cancels edit mode.
    if (this.resolving()) return;
    this.editCancelled.emit();
  }
}
