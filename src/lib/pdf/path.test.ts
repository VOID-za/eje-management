import { describe, expect, it } from 'vitest';
import { parseSvgPath, pathBounds, pathOperators } from './path';
import { PdfBuilder, type PdfForm } from './writer';

const text = (pdf: PdfBuilder) => Buffer.from(pdf.toBytes()).toString('latin1');

describe('vector paths (LETTERHEAD-4)', () => {
  it('reads absolute M, L, Q, C and Z, negative numbers included', () => {
    expect(parseSvgPath('M10 20L-5-6Q1 2 3 4C1 2 3 4 5 6Z')).toEqual([
      { op: 'M', x: 10, y: 20 },
      { op: 'L', x: -5, y: -6 },
      { op: 'Q', x1: 1, y1: 2, x: 3, y: 4 },
      { op: 'C', x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
      { op: 'Z' },
    ]);
    expect(() => parseSvgPath('M0 0a1 1 0 0 0 2 2')).toThrow();
    expect(() => parseSvgPath('M0')).toThrow();
  });

  it('raises a quadratic to the cubic that traces the same curve', () => {
    // P0 (0,0), Q (30,60), P (90,0): controls P0 + ⅔(Q − P0) = (20,40) and P + ⅔(Q − P) = (50,40).
    expect(pathOperators(parseSvgPath('M0 0Q30 60 90 0Z'), String)).toBe('0 0 m 20 40 50 40 90 0 c h');
    // A curve after a close starts from the subpath's start.
    expect(pathOperators(parseSvgPath('M0 0L9 0ZQ0 3 0 6'), String)).toBe('0 0 m 9 0 l h 0 2 0 4 0 6 c');
  });

  it('bounds a path by its points and controls', () => {
    expect(pathBounds(parseSvgPath('M0 0Q30 60 90 -5Z'))).toEqual({ left: 0, bottom: -5, right: 90, top: 60 });
    expect(pathBounds([])).toBeNull();
  });

  it('fillPath fills nonzero (or even-odd), curves as `c`, in a matrix when given one', () => {
    const pdf = new PdfBuilder();
    pdf.addPage();
    pdf.fillPath(parseSvgPath('M0 0Q30 60 90 0Z'), { colour: '#333333' });
    pdf.fillPath(parseSvgPath('M0 0L1 0L1 1Z'), { evenOdd: true, matrix: [0.5, 0, 0, 0.5, 10, 20] });
    const body = text(pdf);
    expect(body).toContain('0.2 0.2 0.2 rg 0 0 m 20 40 50 40 90 0 c h f\n');
    expect(body).toContain('q 0.5 0 0 0.5 10 20 cm 0 0 0 rg 0 0 m 1 0 l 1 1 l h f* Q');
  });

  it('drawForms writes each form once per document and lists it on every page that draws it', () => {
    const glyph: PdfForm = { bbox: [0, 0, 10, 10], content: '0 0 m 10 0 l 10 10 l h f' };
    const other: PdfForm = { bbox: [0, 0, 5, 5], content: '0 0 m 5 0 l 5 5 l h f' };
    const pdf = new PdfBuilder();
    pdf.addPage();
    pdf.drawForms([{ form: glyph, x: 0 }, { form: other, x: 12 }, { form: glyph, x: 20 }], [0.01, 0, 0, 0.01, 40, 800], '#333333');
    pdf.addPage();
    pdf.drawForms([{ form: glyph, x: 0 }], [0.01, 0, 0, 0.01, 40, 800]);
    const body = text(pdf);
    expect([...body.matchAll(/\/Subtype \/Form /gu)]).toHaveLength(2);
    expect(body).toContain('q 0.2 0.2 0.2 rg 0.01 0 0 0.01 40 800 cm q 1 0 0 1 0 0 cm /Fm1 Do Q q 1 0 0 1 12 0 cm /Fm2 Do Q q 1 0 0 1 20 0 cm /Fm1 Do Q Q');
    const pages = [...body.matchAll(/\/Type \/Page \/Parent[^\n]*/gu)].map((match) => match[0]);
    expect(pages[0]).toMatch(/\/XObject << \/Fm1 \d+ 0 R \/Fm2 \d+ 0 R >>/u);
    expect(pages[1]).toMatch(/\/XObject << \/Fm1 \d+ 0 R >>/u);
    expect(body).toContain('/BBox [0 0 10 10] /Resources << >> /Length 24 >>\nstream\n0 0 m 10 0 l 10 10 l h f\nendstream');
  });

  it('invisibleText is render mode 3, stretched to its width, and leaves no text state behind', () => {
    const pdf = new PdfBuilder();
    pdf.addPage();
    pdf.invisibleText(40, 800, 'AB', { size: 10, width: 20 });
    // Helvetica's A and B are 667 + 667 thousandths: 13.34pt at 10pt, stretched to 20.
    expect(text(pdf)).toContain('q 3 Tr 149.925 Tz BT 0 0 0 rg /F1 10 Tf 0 Tc 1 0 0 1 40 800 Tm (AB) Tj ET Q');
  });
});
