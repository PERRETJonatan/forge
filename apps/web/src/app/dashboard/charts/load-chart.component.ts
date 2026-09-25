import { DecimalPipe } from '@angular/common';
import {
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import type { FitnessDay } from '@forge/shared';
import { labelStride, niceTicks, shortDate } from './chart-utils';

/** `top` leaves a band above the plot for the Today/race marker labels. */
const MARGIN = { left: 40, right: 16, top: 26 };
/** Narrower than this the chart scrolls inside its frame rather than drawing degenerate bars. */
const MIN_WIDTH = 320;
const LOAD_HEIGHT = 190;
const PANEL_GAP = 32;
const FORM_HEIGHT = 90;
const AXIS_BAND = 28;

interface Tick {
  value: number;
  y: number;
}

interface Layout {
  width: number;
  height: number;
  plotRight: number;
  formTop: number;
  formZeroY: number;
  loadTicks: Tick[];
  formTicks: Tick[];
  xLabels: { x: number; text: string }[];
  ctl: { solid: string; projected: string };
  atl: { solid: string; projected: string };
  tsb: { solid: string; projected: string; area: string };
  todayX: number | null;
  raceX: number | null;
  xs: number[];
  yLoad: (v: number) => number;
  yForm: (v: number) => number;
}

/**
 * Fitness (CTL) and fatigue (ATL) on one TSS/day axis, with form (TSB) as a second panel
 * underneath sharing the same x -- TSB swings negative, and folding it into the top panel
 * would squash the two load lines. One crosshair spans both panels.
 */
@Component({
  selector: 'app-load-chart',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './load-chart.component.html',
  styleUrl: './charts.css',
})
export class LoadChartComponent implements OnChanges, OnInit, OnDestroy {
  @Input() series: FitnessDay[] = [];
  @Input() today = '';
  @Input() raceDate: string | null = null;
  @Input() raceName: string | null = null;

  private host = inject(ElementRef<HTMLElement>);
  private resizeObserver?: ResizeObserver;
  private width = 640;

  readonly layout = signal<Layout | null>(null);
  readonly hoverIndex = signal<number | null>(null);

  readonly shortDate = shortDate;

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

  private build(): void {
    const days = this.series;
    if (days.length < 2) {
      this.layout.set(null);
      return;
    }

    const width = this.width;
    const plotRight = width - MARGIN.right;
    const plotWidth = plotRight - MARGIN.left;
    const step = plotWidth / (days.length - 1);
    const xs = days.map((_, i) => MARGIN.left + i * step);

    const loadTickValues = niceTicks(0, Math.max(...days.map((d) => Math.max(d.ctl, d.atl))));
    const loadMax = loadTickValues[loadTickValues.length - 1];
    const loadBottom = MARGIN.top + LOAD_HEIGHT;
    const yLoad = (v: number) => loadBottom - (v / loadMax) * LOAD_HEIGHT;

    const formTickValues = niceTicks(Math.min(...days.map((d) => d.tsb)), Math.max(...days.map((d) => d.tsb)), 2);
    const formMin = formTickValues[0];
    const formMax = formTickValues[formTickValues.length - 1];
    const formTop = loadBottom + PANEL_GAP;
    const yForm = (v: number) => formTop + ((formMax - v) / (formMax - formMin)) * FORM_HEIGHT;

    // The projected (dashed) stretch starts at the last actual day so the two join up.
    const lastActual = days.reduce((last, d, i) => (d.projected ? last : i), -1);
    const split = (values: number[], y: (v: number) => number) => {
      const points = values.map((v, i) => `${xs[i].toFixed(1)},${y(v).toFixed(1)}`);
      const solidEnd = lastActual >= 0 ? lastActual + 1 : 0;
      const projectedStart = Math.max(0, lastActual);
      return {
        solid: solidEnd > 1 ? `M${points.slice(0, solidEnd).join('L')}` : '',
        projected: projectedStart < days.length - 1 ? `M${points.slice(projectedStart).join('L')}` : '',
      };
    };

    const tsbValues = days.map((d) => d.tsb);
    const zeroY = yForm(0);
    const tsbArea =
      `M${xs[0].toFixed(1)},${zeroY.toFixed(1)}` +
      tsbValues.map((v, i) => `L${xs[i].toFixed(1)},${yForm(v).toFixed(1)}`).join('') +
      `L${xs[xs.length - 1].toFixed(1)},${zeroY.toFixed(1)}Z`;

    const indexOf = (key: string | null) => (key ? days.findIndex((d) => d.date === key) : -1);
    const todayIndex = indexOf(this.today);
    const raceIndex = indexOf(this.raceDate);

    const stride = labelStride(days.length, Math.max(2, Math.floor(plotWidth / 70)));

    this.layout.set({
      width,
      height: formTop + FORM_HEIGHT + AXIS_BAND,
      plotRight,
      formTop,
      formZeroY: zeroY,
      loadTicks: loadTickValues.map((value) => ({ value, y: yLoad(value) })),
      formTicks: formTickValues.map((value) => ({ value, y: yForm(value) })),
      xLabels: days
        .map((d, i) => ({ i, x: xs[i], text: shortDate(d.date) }))
        .filter(({ i }) => i % stride === 0),
      ctl: split(days.map((d) => d.ctl), yLoad),
      atl: split(days.map((d) => d.atl), yLoad),
      tsb: { ...split(tsbValues, yForm), area: tsbArea },
      todayX: todayIndex >= 0 ? xs[todayIndex] : null,
      raceX: raceIndex >= 0 ? xs[raceIndex] : null,
      xs,
      yLoad,
      yForm,
    });
  }

  onPointerMove(event: PointerEvent): void {
    const layout = this.layout();
    if (!layout) return;
    const svg = event.currentTarget as SVGElement;
    const x = event.clientX - svg.getBoundingClientRect().left;
    const step = layout.xs.length > 1 ? layout.xs[1] - layout.xs[0] : 1;
    const index = Math.round((x - MARGIN.left) / step);
    this.hoverIndex.set(Math.min(this.series.length - 1, Math.max(0, index)));
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const current = this.hoverIndex() ?? this.series.length - 1;
    const next = current + (event.key === 'ArrowRight' ? 1 : -1);
    this.hoverIndex.set(Math.min(this.series.length - 1, Math.max(0, next)));
  }

  clearHover(): void {
    this.hoverIndex.set(null);
  }

  /** Tooltip flips to the pointer's left in the right half, so it never runs off the card. */
  tooltipStyle(layout: Layout, index: number): Record<string, string> {
    const x = layout.xs[index];
    return x > layout.width / 2
      ? { right: `${layout.width - x + 12}px`, top: `${MARGIN.top}px` }
      : { left: `${x + 12}px`, top: `${MARGIN.top}px` };
  }
}
