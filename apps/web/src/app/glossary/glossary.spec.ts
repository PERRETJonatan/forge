import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { GLOSSARY, GLOSSARY_CATEGORIES } from './glossary-terms';
import { TermComponent } from './term.component';

describe('glossary content', () => {
  it('has unique ids that are safe as URL fragments', () => {
    const ids = GLOSSARY.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('only links related terms that exist', () => {
    const ids = new Set(GLOSSARY.map((t) => t.id));
    for (const term of GLOSSARY) {
      for (const related of term.related ?? []) {
        expect(ids.has(related)).withContext(`${term.id} -> ${related}`).toBeTrue();
      }
    }
  });

  it('files every term under a listed category', () => {
    const categories = new Set(GLOSSARY_CATEGORIES.map((c) => c.id));
    for (const term of GLOSSARY) expect(categories.has(term.category)).withContext(term.id).toBeTrue();
  });
});

@Component({
  standalone: true,
  imports: [TermComponent],
  template: `<p><app-term key="ftp">FTP</app-term> and <app-term key="not-a-term">plain</app-term></p>`,
})
class HostComponent {}

describe('TermComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent], providers: [provideRouter([])] }).compileComponents();
  });

  it('links a known term to its glossary entry, described by its short definition', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('a.term');
    expect(link.textContent?.trim()).toBe('FTP');
    expect(link.getAttribute('href')).toBe('/glossary#ftp');
    const tip = fixture.nativeElement.querySelector(`#${link.getAttribute('aria-describedby')}`);
    expect(tip.textContent).toContain('Functional Threshold Power');
  });

  it('renders an unknown term as plain text', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('a.term').length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('plain');
  });
});
