import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-placeholder',
  standalone: true,
  template: `
    <h1>{{ title }}</h1>
    <p class="note">{{ note }}</p>
  `,
  styles: [
    `
      h1 {
        margin: 0 0 8px 0;
        font-family: 'Space Grotesk', sans-serif;
        font-size: 26px;
        font-weight: 700;
        color: var(--text);
      }
      .note {
        margin: 0;
        color: var(--text-muted);
        font-size: 14px;
      }
    `,
  ],
})
export class PlaceholderComponent {
  readonly title: string;
  readonly note: string;

  constructor(route: ActivatedRoute) {
    this.title = route.snapshot.data['title'] ?? '';
    this.note = route.snapshot.data['note'] ?? 'This screen is coming in a later build milestone.';
  }
}
