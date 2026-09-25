import { Component, ElementRef, Input, OnChanges, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { labelStride, niceTicks, roundedTopBar } from './chart-utils';

export interface ColumnSeries {
  key: string;
  label: string;
  color: string;
}

export interface ColumnRow {
  label: string;
  values: Record<string, number>;
}

const MARGIN = { left: 40, right: 16, top: 12 };
/** Narrower than this the chart scrolls inside its frame rather than drawing degenerate bars. */
const MIN_WIDTH = 320;
const PLOT_HEIGHT = 180;
const AXIS_BAND = 28;
const MAX_BAR_WIDTH = 24;
/** Surface-colored gap between stacked segments and between grouped bars. */
const GAP = 2;

interface Mark {
  d: string;
  color: string;
}

interface Band {
  x: number;
  width: number;
  centerX: number;
  marks: Mark[];
}

interface Layout {
  width: number;
  height: number;
  plotRight: number;
  ticks: { value: number; y: number }[];
  bands: Band[];
  xLabels: { x: number; text: string }[];
}

/**
 * Weekly column chart: `stacked` stacks every series into one column per row (volume by
 * discipline), `grouped` sets them side by side (planned vs actual). Hovering or arrowing onto
 * a row reads out every series for it; the table view below carries the same values.
 */
@Component({
  selector: 'app-column-chart',
  standalone: true,
  templateUrl: './column-chart.component.html',
  styleUrl: './charts.css',
})
export class ColumnChartComponent implements OnChanges, OnInit, OnDestroy {
  @Input() rows: ColumnRow[] = [];
  @Input() series: ColumnSeries[] = [];
  @Input() mode: 'stacked' | 'grouped' = 'stacked';
  @Input() format: (value: number) => string = (v) => String(Math.round(v));
  @Input() ariaLabel = '';

  private host = inject(ElementRef<HTMLElement>);
  private resizeObserver?: ResizeObserver;
  private width = 640;

  readonly layout = signal<Layout | null>(null);
  readonly hoverIndex = signal<number | null>(null);

  ngOnInit(): void {
    this.resizeObserver = new ResizeObserver((entries) => {
      const width = Math.max(MIN_WIDTH, Math.floor(entries[0].contentRect.width));
      if (width > 0 && width !== this.width) {
        this.width = width;
        this.build();
      }
    });
    this.resizeObserver.observe(this.host.nativeElement);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  ngOnChanges(): void {
    this.hoverIndex.set(null);
    this.build();
  }

  /** A row may leave a series out entirely; that reads as 0. */
  valueOf(row: ColumnRow, key: string): number {
    return row.values[key] ?? 0;
  }

  total(row: ColumnRow): number {
    return this.series.reduce((sum, s) => sum + this.valueOf(row, s.key), 0);
  }

  private build(): void {
    if (this.rows.length === 0) {
      this.layout.set(null);
      return;
    }

    const width = this.width;
    const plotRight = width - MARGIN.right;
    const plotWidth = plotRight - MARGIN.left;
    const bandWidth = plotWidth / this.rows.length;
    const bottom = MARGIN.top + PLOT_HEIGHT;

    const maxValue = Math.max(
      ...this.rows.map((row) =>
        this.mode === 'stacked' ? this.total(row) : Math.max(...this.series.map((s) => row.values[s.key] ?? 0)),
      ),
    );
    const tickValues = niceTicks(0, maxValue);
    const max = tickValues[tickValues.length - 1];
    const scale = (v: number) => (v / max) * PLOT_HEIGHT;

    const bands: Band[] = this.rows.map((row, i) => {
      const x = MARGIN.left + i * bandWidth;
      const centerX = x + bandWidth / 2;
      const marks: Mark[] = [];

      if (this.mode === 'stacked') {
        // Bars never fill the band -- the leftover is air between weeks.
        const barWidth = Math.min(MAX_BAR_WIDTH, bandWidth * 0.6);
        const barX = centerX - barWidth / 2;
        const segments = this.series.filter((s) => (row.values[s.key] ?? 0) > 0);
        let top = bottom;
        segments.forEach((s, j) => {
          const height = scale(row.values[s.key]);
          const segmentTop = top - height;
          const isLast = j === segments.length - 1;
          // Each segment above the first gives up GAP px at its base for the surface gap.
          const drawHeight = height - (j > 0 ? GAP : 0);
          if (drawHeight > 0) {
            const drawBottom = segmentTop + drawHeight;
            marks.push({
              d: isLast
                ? roundedTopBar(barX, segmentTop, barWidth, drawHeight)
                : `M${barX},${drawBottom}V${segmentTop}H${barX + barWidth}V${drawBottom}Z`,
              color: s.color,
            });
          }
          top = segmentTop;
        });
      } else {
        const count = this.series.length;
        const barWidth = Math.min(MAX_BAR_WIDTH, (bandWidth * 0.7 - GAP * (count - 1)) / count);
        const groupWidth = barWidth * count + GAP * (count - 1);
        this.series.forEach((s, j) => {
          const height = scale(row.values[s.key] ?? 0);
          const barX = centerX - groupWidth / 2 + j * (barWidth + GAP);
          marks.push({ d: roundedTopBar(barX, bottom - height, barWidth, height), color: s.color });
        });
      }

      return { x, width: bandWidth, centerX, marks };
    });

    const stride = labelStride(this.rows.length, Math.max(2, Math.floor(plotWidth / 56)));

    this.layout.set({
      width,
      height: bottom + AXIS_BAND,
      plotRight,
      ticks: tickValues.map((value) => ({ value, y: bottom - scale(value) })),
      bands,
      xLabels: bands
        .map((b, i) => ({ i, x: b.centerX, text: this.rows[i].label }))
        .filter(({ i }) => i % stride === 0),
    });
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const current = this.hoverIndex() ?? this.rows.length - 1;
    const next = current + (event.key === 'ArrowRight' ? 1 : -1);
    this.hoverIndex.set(Math.min(this.rows.length - 1, Math.max(0, next)));
  }

  tooltipStyle(layout: Layout, index: number): Record<string, string> {
    const band = layout.bands[index];
    return band.centerX > layout.width / 2
      ? { right: `${layout.width - band.x + 4}px`, top: `${MARGIN.top}px` }
      : { left: `${band.x + band.width + 4}px`, top: `${MARGIN.top}px` };
  }
}
