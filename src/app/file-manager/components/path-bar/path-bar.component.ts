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
    viewChild
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
 * visible segment.
 */
@Component({
    selector: 'pr-path-bar',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [Menu],
    templateUrl: './path-bar.component.html',
    styleUrl: './path-bar.component.scss'
})
export class PathBarComponent {
    public readonly segments = input.required<PathSegment[]>();
    public readonly projectLabel = input.required<string>();
    public readonly editablePath = input<string>('');
    public readonly editing = input<boolean>(false);
    public readonly resolving = input<boolean>(false);
    public readonly pathError = input<string | null>(null);

    public readonly editRequested = output<void>();
    public readonly editCancelled = output<void>();
    public readonly segmentClicked = output<PathSegment>();
    public readonly pathSubmitted = output<string>();

    private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly destroyRef = inject(DestroyRef);

    private readonly breadcrumbRef = viewChild<ElementRef<HTMLElement>>('breadcrumb');
    private readonly measureRef = viewChild<ElementRef<HTMLElement>>('measure');
    private readonly measureSepRef = viewChild<ElementRef<HTMLElement>>('measureSep');
    private readonly prefixRef = viewChild<ElementRef<HTMLElement>>('prefix');
    private readonly overflowSizerRef = viewChild<ElementRef<HTMLElement>>('overflowSizer');
    private readonly editZoneRef = viewChild<ElementRef<HTMLElement>>('editZone');
    private readonly pathInputRef = viewChild<ElementRef<HTMLInputElement>>('pathInput');

    protected readonly draft = signal('');

    private readonly collapsedCount = signal(0);
    private readonly fittedKey = signal<string | null>(null);

    private readonly fitKey = computed(() => {
        const parts = this.segments().map((seg) =>
            [seg.id ?? '', seg.listKey ?? '', seg.path ?? '', seg.label].join('\u001f')
        );

        return [this.projectLabel(), ...parts].join('\u001e');
    });

    private readonly effectiveCollapsed = computed(() => {
        const maxCollapsed = Math.max(0, this.segments().length - 1);
        // New paths render conservatively (`… > current`) until measurement proves more fits.
        if (this.fittedKey() !== this.fitKey()) {return maxCollapsed;}

        return Math.min(this.collapsedCount(), maxCollapsed);
    });

    protected readonly overflowSegments = computed(() =>
        this.segments().slice(0, this.effectiveCollapsed())
    );
    protected readonly visibleSegments = computed(() =>
        this.segments().slice(this.effectiveCollapsed())
    );
    protected readonly visibleStartIndex = computed(() => this.effectiveCollapsed());

    protected readonly overflowMenuItems = computed<MenuItem[]>(() =>
        this.overflowSegments().map((seg) => ({
            label: seg.label,
            title: seg.label,
            command: () => this.segmentClicked.emit(seg)
        }))
    );

    private fitPass = 0;
    private cachedWidths: number[] = [];
    private cachedSepW = 16;
    private cachedGapW = 0;
    private cachedOverflowW = 32;
    private hostPadX = 0;
    private editReservePx = 20;

    private static readonly MAX_MEASURE_RETRIES = 5;

    public constructor() {
        afterNextRender(() => {
            const cs = getComputedStyle(this.hostRef.nativeElement);
            this.hostPadX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
            this.refreshEditReserve();

            const observer = new ResizeObserver(() => this.fitFromCachedWidths());
            observer.observe(this.hostRef.nativeElement);
            this.destroyRef.onDestroy(() => observer.disconnect());
            this.measureAndFit();
        });

        effect(() => {
            this.fitKey();
            this.editing();
            this.measureAndFit();
        });

        effect(() => {
            const input = this.pathInputRef()?.nativeElement;
            if (this.editing() && input) {
                input.focus();
                input.select();
            }
        });
    }

    protected onEnterEdit(): void {
        this.draft.set(this.editablePath());
        this.editRequested.emit();
    }

    protected onDraftInput(value: string): void {
        this.draft.set(value);
    }

    protected onSubmit(): void {
        if (this.resolving()) {return;}
        this.pathSubmitted.emit(this.draft());
    }

    protected onCancel(): void {
        this.editCancelled.emit();
    }

    protected onBlur(): void {
        if (this.resolving()) {return;}
        this.editCancelled.emit();
    }

    private refreshEditReserve(): void {
        const el = this.editZoneRef()?.nativeElement;
        if (!el) {return;}

        const minWidth = parseFloat(getComputedStyle(el).minWidth);
        if (!Number.isNaN(minWidth)) {this.editReservePx = minWidth;}
    }

    private availablePx(): number {
        const host = this.hostRef.nativeElement;
        const prefixW = this.prefixRef()?.nativeElement.offsetWidth ?? 0;

        return Math.max(0, host.clientWidth - this.hostPadX - prefixW - this.editReservePx);
    }

    private measureAndFit(retries = 0): void {
        if (this.editing()) {return;}

        const pass = ++this.fitPass;
        const key = this.fitKey();
        requestAnimationFrame(() => {
            if (!this.isCurrentFit(pass, key)) {return;}

            if (!this.readNaturalWidths()) {
                if (retries < PathBarComponent.MAX_MEASURE_RETRIES) {
                    requestAnimationFrame(() => {
                        if (this.isCurrentFit(pass, key)) {this.measureAndFit(retries + 1);}
                    });
                }

                return;
            }

            this.refreshEditReserve();
            this.applyFit(pass, key);
        });
    }

    private readNaturalWidths(): boolean {
        const measureEl = this.measureRef()?.nativeElement;
        const segEls = measureEl
            ? Array.from(measureEl.querySelectorAll<HTMLElement>('.fm-measure-seg'))
            : [];

        if (!measureEl || segEls.length !== this.segments().length) {return false;}

        const gap = parseFloat(getComputedStyle(measureEl).columnGap);
        this.cachedWidths = segEls.map((el) => el.offsetWidth);
        this.cachedGapW = Number.isFinite(gap) ? gap : 0;
        this.cachedSepW = this.measureSepRef()?.nativeElement.offsetWidth ?? this.cachedSepW;
        this.cachedOverflowW =
            this.overflowSizerRef()?.nativeElement.offsetWidth ?? this.cachedOverflowW;

        return true;
    }

    private isCurrentFit(pass: number, key: string): boolean {
        return pass === this.fitPass && key === this.fitKey() && !this.editing();
    }

    private fitFromCachedWidths(): void {
        if (this.editing()) {return;}
        if (this.cachedWidths.length !== this.segments().length) {
            this.measureAndFit();

            return;
        }

        this.applyFit(++this.fitPass, this.fitKey());
    }

    private applyFit(pass: number, key: string): void {
        this.collapsedCount.set(this.calculateCollapsedCount());
        this.fittedKey.set(key);
        requestAnimationFrame(() => this.correctRenderedOverflow(pass));
    }

    private calculateCollapsedCount(): number {
        const count = this.cachedWidths.length;
        if (count <= 1) {return 0;}

        const available = this.availablePx();
        const fullWidth =
            this.cachedWidths.reduce((sum, w) => sum + w, 0) +
      this.cachedSepW * (count - 1) +
      this.cachedGapW * Math.max(0, 2 * count - 2);

        if (fullWidth <= available) {return 0;}

        let suffixWidth = this.cachedWidths[count - 1]; // current folder is always kept
        let suffixCount = 1;

        for (let i = count - 2; i >= 0; i--) {
            const nextCount = suffixCount + 1;
            const nextWidth = suffixWidth + this.cachedWidths[i];
            const collapsedWidth =
                this.cachedOverflowW +
        nextWidth +
        this.cachedSepW * nextCount +
        this.cachedGapW * (2 * nextCount);

            if (collapsedWidth > available) {break;}

            suffixWidth = nextWidth;
            suffixCount = nextCount;
        }

        return count - suffixCount;
    }

    private correctRenderedOverflow(pass: number): void {
        if (pass !== this.fitPass || this.editing()) {return;}

        const nav = this.breadcrumbRef()?.nativeElement;
        const current = this.collapsedCount();
        const maxCollapsed = this.segments().length - 1;

        if (nav && nav.scrollWidth > nav.clientWidth + 1 && current < maxCollapsed) {
            this.collapsedCount.set(current + 1);
            requestAnimationFrame(() => this.correctRenderedOverflow(pass));
        }
    }
}
