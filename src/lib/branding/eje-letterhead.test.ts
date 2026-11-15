import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { asCompanyId, DEFAULT_COMPANY_ID, WD_HEARN_JHB_COMPANY_ID } from '@/domain';
import { companies } from '@/api/endpoints';
import { A4_HEIGHT, PdfBuilder } from '@/lib/pdf/writer';
import { charWidth } from '@/lib/pdf/metrics';
import { inspectPdf } from '@/lib/pdf/inspect';
import { drawEjeLetterhead, drawLetterhead } from '@/services/simulated/pdf-sheet';
import { DocumentLetterhead, EjeLetterhead } from '@/components/documents/EjeLetterhead';
import { DeliveryNoteDocument } from '@/components/jobs/DeliveryNoteDocument';
import { deliveryNoteModel } from '@/test/letterhead-documents';
import { filledPaths } from '@/test/letterhead-fixture';
import { EJE_MARK_ASPECT, EJE_MARK_POLYGONS } from './eje-letterhead-mark';
import {
  EJE_MASTER_LETTERHEAD,
  LETTERHEAD_LINES,
  LETTERHEAD_MARK_BOX,
  LETTERHEAD_REFERENCE,
  carriesMasterLetterhead,
  isMasterLetterhead,
  layoutLetterhead,
  letterheadLineText,
  type LetterheadFontRole,
} from './eje-letterhead';

/**
 * LETTERHEAD-2: the EJE master letterhead — one description, drawn by the PDF and by the
 * screen from the same `layoutLetterhead`, carrying the official paper's wording exactly.
 */

describe('the master letterhead’s wording', () => {
  it('is the official paper’s, character for character, in its three faces', () => {
    const lines = LETTERHEAD_LINES.map((line) => [line.role, letterheadLineText(line)]);
    expect(lines).toEqual([
      ['sansBoldItalic', 'Reg: CK1987/020035/23'],
      ['sansBoldItalic', 'EJE Industrial Electronics cc'],
      ['sansBoldItalic', 'VAT NO: 4950134991'],
      ['serifBold', 'Bonfoi Office Park'],
      ['serifBold', 'c/oTempelhof South  Rd'],
      ['serifBold', 'and Atlas Rd'],
      ['serifBold', 'Bonaero Park'],
      ['serifBold', 'Kempton Park, 1619'],
      ['serifBold', 'Cell:  083 443 7736 – Peet Buitendag'],
      ['serifBold', 'Cell: 082 330 3404 – Dawie Malan'],
      ['serifBold', 'Tel: 083 285 1644/011 979 5080'],
      ['serifBold', 'Fax: 086 529 0073'],
      ['serifBold', 'Email: sales@ejeie.co.za or peetb@ejeie.co.za'],
      ['serifBoldItalic', 'P.O. Box 16282'],
      ['serifBoldItalic', 'Atlasville'],
      ['serifBoldItalic', '1465'],
    ]);
    // The name's "cc" is set smaller than the name, as on the paper.
    const name = LETTERHEAD_LINES[1]!;
    expect(name.runs.map((run) => run.size)).toEqual([118, 96]);
    for (const line of LETTERHEAD_LINES) expect(line.ink).toBe('#333333');
  });

  it('keeps every line and the mark inside the reference space', () => {
    expect(LETTERHEAD_MARK_BOX.width / LETTERHEAD_MARK_BOX.height).toBeCloseTo(EJE_MARK_ASPECT, 6);
    expect(LETTERHEAD_MARK_BOX.x + LETTERHEAD_MARK_BOX.width).toBeLessThan(700);
    expect(LETTERHEAD_MARK_BOX.y + LETTERHEAD_MARK_BOX.height).toBeLessThanOrEqual(LETTERHEAD_REFERENCE.height);
    for (const line of LETTERHEAD_LINES) {
      expect(line.baseline).toBeGreaterThan(0);
      expect(line.baseline).toBeLessThanOrEqual(LETTERHEAD_REFERENCE.height);
    }
  });

  it('the mark is traced outlines in normalised units, never a picture', () => {
    expect(EJE_MARK_POLYGONS.length).toBeGreaterThan(0);
    for (const polygon of EJE_MARK_POLYGONS) {
      expect(polygon.length % 2).toBe(0);
      expect(polygon.length / 2).toBeGreaterThan(100);
      for (const value of polygon) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('layoutLetterhead', () => {
  it('scales uniformly by the tighter side, centred top to bottom, left-aligned by default', () => {
    const wide = layoutLetterhead({ left: 10, top: 20, width: 1000, height: 100 });
    expect(wide.scale).toBeCloseTo(100 / 660, 9);
    expect(wide.area.left).toBe(10);
    expect(wide.area.top).toBeCloseTo(20, 9);
    expect(wide.area.width / wide.area.height).toBeCloseTo(5, 9);

    const tall = layoutLetterhead({ left: 0, top: 0, width: 330, height: 200 });
    expect(tall.scale).toBeCloseTo(0.1, 9);
    expect(tall.area.top).toBeCloseTo((200 - 66) / 2, 9);

    const centred = layoutLetterhead({ left: 0, top: 0, width: 1000, height: 100 }, { align: 'centre' });
    expect(centred.area.left).toBeCloseTo((1000 - 500) / 2, 9);
  });

  it('places every line and the mark by the same scale', () => {
    const placed = layoutLetterhead({ left: 5, top: 7, width: 660, height: 132 });
    expect(placed.scale).toBeCloseTo(0.2, 9);
    expect(placed.mark.left).toBeCloseTo(5 + LETTERHEAD_MARK_BOX.x * 0.2, 9);
    expect(placed.mark.top).toBeCloseTo(7 + LETTERHEAD_MARK_BOX.y * 0.2, 9);
    placed.lines.forEach((line, index) => {
      const source = LETTERHEAD_LINES[index]!;
      expect(line.x).toBeCloseTo(5 + source.x * 0.2, 9);
      expect(line.baseline).toBeCloseTo(7 + source.baseline * 0.2, 9);
      expect(line.runs.map((run) => run.size)).toEqual(source.runs.map((run) => run.size * 0.2));
    });
  });
});

const PDF_FONT: Record<LetterheadFontRole, Parameters<typeof charWidth>[1]> = {
  sansBoldItalic: 'boldItalic',
  serifBold: 'serifBold',
  serifBoldItalic: 'serifBoldItalic',
};
const naturalWidth = (line: (typeof LETTERHEAD_LINES)[number], scale: number) =>
  line.runs.reduce((sum, run) => sum + ([...run.text].reduce((width, character) => width + charWidth(character, PDF_FONT[line.role]), 0) / 1000) * run.size * scale, 0);

describe('the PDF and the screen draw the same layout', () => {
  const box = { x: 40, y: 760, width: 515.28, height: 67.89 };
  const pdf = new PdfBuilder();
  pdf.addPage();
  drawEjeLetterhead(pdf, box);
  const bytes = pdf.toBytes();
  const placed = layoutLetterhead({ left: box.x, top: A4_HEIGHT - (box.y + box.height), width: box.width, height: box.height });

  it('the PDF puts each line at the layout’s centre and baseline, as real text', () => {
    const runs = inspectPdf(bytes).runs;
    expect(runs.map((run) => run.value)).toEqual(LETTERHEAD_LINES.map(letterheadLineText));
    runs.forEach((run, index) => {
      const line = placed.lines[index]!;
      expect(run.y).toBeCloseTo(A4_HEIGHT - line.baseline, 2);
      expect(run.x + naturalWidth(LETTERHEAD_LINES[index]!, placed.scale) / 2).toBeCloseTo(line.x, 2);
      expect(run.size).toBeCloseTo(line.runs[0]!.size, 2);
      expect(run.font).toBe(PDF_FONT[line.role]);
    });
  });

  it('the PDF fills the mark in the layout’s mark box', () => {
    const [path] = filledPaths(bytes);
    const polygon = EJE_MARK_POLYGONS[0]!;
    expect(path!.points[0]!.x).toBeCloseTo(placed.mark.left + polygon[0]! * placed.mark.width, 2);
    expect(path!.points[0]!.y).toBeCloseTo(A4_HEIGHT - (placed.mark.top + polygon[1]! * placed.mark.height), 2);
    expect(Buffer.from(bytes).toString('latin1')).toMatch(/ h f\*/u);
  });

  it('the screen’s SVG has the same positions, in the layout’s own units (the same layout at scale 1)', () => {
    const markup = renderToStaticMarkup(createElement(EjeLetterhead));
    expect(markup).toContain(`viewBox="0 0 ${LETTERHEAD_REFERENCE.width} ${LETTERHEAD_REFERENCE.height}"`);
    const texts = [...markup.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>(.*?)<\/text>/gu)];
    expect(texts).toHaveLength(LETTERHEAD_LINES.length);
    texts.forEach((match, index) => {
      const line = placed.lines[index]!;
      // The PDF's position, taken back to the reference space, is the SVG's.
      expect(Number(match[1])).toBeCloseTo((line.x - placed.area.left) / placed.scale, 6);
      expect(Number(match[2])).toBeCloseTo((line.baseline - placed.area.top) / placed.scale, 6);
      expect(match[3]!.replace(/<[^>]+>/gu, '').replace(/&amp;/gu, '&')).toBe(letterheadLineText(LETTERHEAD_LINES[index]!));
    });
    // Centred, bold, in the paper's faces; spaces kept as written; the mark filled even-odd.
    expect(markup).toContain('text-anchor="middle"');
    expect(markup).toContain('font-family="Helvetica, Arial, sans-serif"');
    expect(markup).toContain('font-family="&#x27;Times New Roman&#x27;, Times, serif"');
    expect(markup).toContain('xml:space="preserve"');
    expect(markup).toMatch(/<path d="M[\d.,L]+Z" fill="#333333" fill-rule="evenodd"/u);
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('<image');
  });
});

describe('which header a document carries', () => {
  const fallback = createElement('p', { 'data-testid': 'text-header' }, 'The text header');
  const wdReference = { companyId: WD_HEARN_JHB_COMPANY_ID, sha256: 'abc123' };

  it('EJE: the master letterhead — even when an EJE image is on record', () => {
    const markup = renderToStaticMarkup(
      createElement(DocumentLetterhead, {
        companyId: DEFAULT_COMPANY_ID,
        companyName: 'EJE Industrial Electronics',
        letterhead: { companyId: DEFAULT_COMPANY_ID, sha256: 'eje-image' },
        fallback,
      }),
    );
    expect(markup).toContain('data-letterhead="eje-master"');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('The text header');
  });

  it('another company with an uploaded letterhead: its image, through the authorised route', () => {
    const markup = renderToStaticMarkup(
      createElement(DocumentLetterhead, { companyId: WD_HEARN_JHB_COMPANY_ID, companyName: 'WD Hearn JHB', letterhead: wdReference, fallback }),
    );
    expect(markup).toContain(`src="${companies.letterheadUrl(WD_HEARN_JHB_COMPANY_ID, 'abc123').replace(/&/gu, '&amp;')}"`);
    expect(markup).toContain('alt="WD Hearn JHB letterhead"');
    expect(markup).not.toContain('eje-master');
  });

  it('otherwise: the text header, exactly as given', () => {
    for (const letterhead of [null, undefined]) {
      expect(
        renderToStaticMarkup(createElement(DocumentLetterhead, { companyId: WD_HEARN_JHB_COMPANY_ID, companyName: 'WD Hearn JHB', letterhead, fallback })),
      ).toBe(renderToStaticMarkup(fallback));
    }
  });

  it('the on-screen Delivery Note follows its job’s company, and without one is as before', () => {
    const before = renderToStaticMarkup(createElement(DeliveryNoteDocument, { model: deliveryNoteModel }));
    expect(before).not.toContain('data-letterhead');
    expect(before).toContain(deliveryNoteModel.company.name);
    expect(renderToStaticMarkup(createElement(DeliveryNoteDocument, { model: deliveryNoteModel, companyId: DEFAULT_COMPANY_ID }))).toContain(
      'data-letterhead="eje-master"',
    );
    const wd = renderToStaticMarkup(createElement(DeliveryNoteDocument, { model: deliveryNoteModel, companyId: WD_HEARN_JHB_COMPANY_ID, letterhead: wdReference }));
    expect(wd).toContain('data-letterhead="uploaded"');
    expect(renderToStaticMarkup(createElement(DeliveryNoteDocument, { model: deliveryNoteModel, companyId: WD_HEARN_JHB_COMPANY_ID }))).toBe(before);
  });

  it('the PDF makes the same choice: the master for EJE only', () => {
    expect(carriesMasterLetterhead(DEFAULT_COMPANY_ID)).toBe(true);
    expect(carriesMasterLetterhead(WD_HEARN_JHB_COMPANY_ID)).toBe(false);
    expect(carriesMasterLetterhead(asCompanyId('another'))).toBe(false);
    expect(isMasterLetterhead(EJE_MASTER_LETTERHEAD)).toBe(true);
    expect(isMasterLetterhead(undefined)).toBe(false);
    const pdf = new PdfBuilder();
    pdf.addPage();
    expect(drawLetterhead(pdf, EJE_MASTER_LETTERHEAD, { x: 40, y: 760, width: 515, height: 68 })).toBe(true);
    expect(drawLetterhead(pdf, undefined, { x: 40, y: 760, width: 515, height: 68 })).toBe(false);
  });
});
