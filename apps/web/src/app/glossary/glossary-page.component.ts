import { ViewportScroller } from '@angular/common';
import { Component, Injector, afterNextRender, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { GLOSSARY, GLOSSARY_BY_ID, GLOSSARY_CATEGORIES, type GlossaryTerm } from './glossary-terms';

function matches(term: GlossaryTerm, query: string): boolean {
  const haystack = [term.term, term.fullName ?? '', term.short, ...term.body, term.inForge ?? ''].join(' ').toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

@Component({
  selector: 'app-glossary-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './glossary-page.component.html',
  styleUrl: './glossary-page.component.css',
})
export class GlossaryPageComponent {
  private route = inject(ActivatedRoute);
  private scroller = inject(ViewportScroller);
  private injector = inject(Injector);

  constructor() {
    // Land entries a little below the window's top edge rather than flush against it.
    this.scroller.setOffset([0, 16]);
  }

  readonly query = signal('');
  /** The entry linked to (e.g. /glossary#ftp), highlighted so it stands out after the jump. */
  readonly highlighted = toSignal(this.route.fragment, { initialValue: null });

  readonly sections = computed(() => {
    const query = this.query().trim();
    return GLOSSARY_CATEGORIES.map((category) => ({
      ...category,
      terms: GLOSSARY.filter((t) => t.category === category.id && (!query || matches(t, query))),
    })).filter((section) => section.terms.length > 0);
  });

  readonly resultCount = computed(() => this.sections().reduce((n, s) => n + s.terms.length, 0));

  relatedTerm(id: string): GlossaryTerm | undefined {
    return GLOSSARY_BY_ID.get(id);
  }

  /**
   * Following a related link must land on its entry even while a search is active. Clearing
   * the search re-renders entries above the target, so scroll again once that has rendered --
   * the router's own anchor scroll runs before the layout shift.
   */
  goToRelated(id: string): void {
    if (!this.query()) return;
    this.query.set('');
    afterNextRender(() => this.scroller.scrollToAnchor(id), { injector: this.injector });
  }
}
