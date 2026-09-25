import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, HostListener, Input, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GLOSSARY_BY_ID } from './glossary-terms';

let nextId = 0;

const TIP_MAX_WIDTH = 280;
/** Most hints are 3-5 lines; close enough to decide whether to open upward. */
const TIP_EST_HEIGHT = 110;
const EDGE_MARGIN = 16;

/**
 * A glossary term used inline, e.g. `<app-term key="ftp">FTP</app-term>`: a dotted-underlined
 * link to its glossary entry that shows the one-line definition on hover or keyboard focus.
 * Unknown keys render the text as-is. (`key`, not `id`: an `id` input would also set a DOM id
 * on the host and clash with the glossary page's anchors.)
 */
@Component({
  selector: 'app-term',
  standalone: true,
  imports: [RouterLink, NgTemplateOutlet],
  // Content is projected once into #label and rendered from there: Angular projects into only
  // one <ng-content>, so one in each @if branch would leave the link empty.
  template: `
    <ng-template #label><ng-content /></ng-template>
    @if (entry; as e) {
      <a class="term" routerLink="/glossary" [fragment]="e.id" [attr.aria-describedby]="tipId"
        ><ng-container [ngTemplateOutlet]="label"
      /></a>
      <span class="tip" role="tooltip" [id]="tipId" [class.flip-x]="flipX()" [class.flip-y]="flipY()">
        <strong>{{ e.fullName ?? e.term }}</strong>
        {{ e.short }}
      </span>
    } @else {
      <ng-container [ngTemplateOutlet]="label" />
    }
  `,
  styles: [
    `
      :host {
        position: relative;
        display: inline;
      }
      .term {
        color: inherit;
        font-weight: inherit;
        text-decoration: underline dotted;
        text-decoration-color: var(--text-muted);
        text-underline-offset: 3px;
        cursor: help;
      }
      .term:hover,
      .term:focus-visible {
        text-decoration-color: currentColor;
      }
      .tip {
        display: none;
        position: absolute;
        z-index: 20;
        top: calc(100% + 6px);
        left: 0;
        width: max-content;
        max-width: 280px;
        padding: 8px 10px;
        border-radius: 8px;
        background: var(--surface);
        border: 1px solid var(--border);
        box-shadow: 0 4px 16px var(--shadow);
        color: var(--text-muted);
        font-size: 12px;
        font-weight: 400;
        line-height: 1.45;
        text-transform: none;
        letter-spacing: normal;
        white-space: normal;
        pointer-events: none;
      }
      .tip strong {
        display: block;
        margin-bottom: 2px;
        color: var(--text);
        font-weight: 600;
      }
      .tip.flip-x {
        left: auto;
        right: 0;
      }
      .tip.flip-y {
        top: auto;
        bottom: calc(100% + 6px);
      }
      :host(:hover) .tip,
      :host(:focus-within) .tip {
        display: block;
      }
    `,
  ],
})
export class TermComponent {
  @Input({ required: true }) key!: string;

  readonly tipId = `term-tip-${nextId++}`;

  private host = inject(ElementRef<HTMLElement>);
  /** Open toward the side with room, so a hint near the window's edge isn't cut off. */
  readonly flipX = signal(false);
  readonly flipY = signal(false);

  @HostListener('mouseenter')
  @HostListener('focusin')
  placeTip(): void {
    const rect = this.host.nativeElement.getBoundingClientRect();
    this.flipX.set(rect.left + TIP_MAX_WIDTH > window.innerWidth - EDGE_MARGIN);
    this.flipY.set(rect.bottom + TIP_EST_HEIGHT > window.innerHeight - EDGE_MARGIN);
  }

  get entry() {
    return GLOSSARY_BY_ID.get(this.key);
  }
}
