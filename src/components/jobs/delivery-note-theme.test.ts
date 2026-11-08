import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * DN-DARK-1 (8 November 2026): THE DELIVERY NOTE PANEL FOLLOWS THE THEME.
 *
 * Tailwind's own palette (`green-50`, `lime-100`, …) is not mapped by either
 * palette block in `globals.css`, so a class from it stays its light value in
 * dark mode — which is how New Job's Delivery Note panel came to be a pale
 * yellow-green slab behind a dark date field. The node suite cannot compute a
 * style; it can hold the forms to the themed tokens. The browser check
 * (forms-regression) measures the colours in both themes.
 */
const source = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const UNTHEMED = /\b(?:bg|border|text|ring)-(?:green|lime|emerald|yellow|teal)-\d{2,3}\b/u;

describe('the Delivery Note panel on New Job', () => {
  const page = source('../../app/(app)/jobs/new/page.tsx');

  it('is tinted with the themed green, as the Test & Repair panel is with the themed violet', () => {
    expect(page).toMatch(/border border-verdant-200 bg-verdant-50 p-4" data-testid="delivery-note-details"/u);
    expect(page).toContain('border border-violet-eje-200 bg-violet-eje-50 p-4');
  });

  it('uses no colour that dark mode does not redefine', () => {
    expect(page).not.toMatch(UNTHEMED);
  });

  it('draws the Delivery date with the shared field, which carries the themed states', () => {
    expect(page).toMatch(/<TextField\s+label="Delivery date"/u);
  });
});

describe('the themed tints it relies on', () => {
  const css = source('../../app/globals.css');

  it('are defined for light AND dark, and mapped to the utilities', () => {
    for (const token of ['--eje-verdant-50', '--eje-verdant-200']) {
      expect(css.split(`${token}:`).length - 1, token).toBe(2);
    }
    expect(css).toContain('--color-verdant-50: var(--eje-verdant-50);');
    expect(css).toContain('--color-verdant-200: var(--eje-verdant-200);');
  });
});
