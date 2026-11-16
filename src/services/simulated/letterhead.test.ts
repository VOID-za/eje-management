import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
/*
 * The seed's dates are relative to today, and some of them are taken when its modules are IMPORTED —
 * before `beforeAll` runs. So the clock is frozen here, before any import, as well as in `beforeAll`:
 * without it the hashes below held only on the day they were taken (they failed from 16 November).
 * The same instant as FROZEN_AT (src/test/letterhead-documents.ts), checked below.
 */
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-15T08:00:00.000Z'));
});
import type { PdfImage } from '@/lib/pdf/image';
import { A4_HEIGHT } from '@/lib/pdf/writer';
import { inspectPdf, pdfPlainText } from '@/lib/pdf/inspect';
import { SUBSTITUTION_ALLOWANCE } from '@/lib/pdf/metrics';
import { WD_HEARN_JHB_COMPANY_ID, type CompanyDetails } from '@/domain';
import {
  EJE_MASTER_LETTERHEAD,
  LETTERHEAD_LINES,
  LETTERHEAD_MARK_BOX,
  LETTERHEAD_REFERENCE,
  letterheadLineText,
  type DocumentLetterhead,
} from '@/lib/branding/eje-letterhead';
import { EJE_MARK_POLYGONS } from '@/lib/branding/eje-letterhead-mark';
import { renderJobCardPdf } from './job-card-pdf';
import { renderJobCardPdfV5 } from './job-card-pdf-v5';
import { renderCorrectionPdf } from './correction-pdf';
import { DELIVERY_NOTE_MASTER_EXTRA, renderDeliveryNotePdf } from './delivery-note-pdf';
import { renderTimesheetPdf } from './timesheet-pdf';
import { renderAttendancePdf } from './attendance-pdf';
import { LETTERHEAD_TOP, drawLetterhead, fitLetterhead } from './pdf-sheet';
import { PdfBuilder } from '@/lib/pdf/writer';
import {
  FROZEN_AT,
  GENERATED_AT,
  JOB_DOCUMENTS,
  attendance,
  correctionSource,
  deliveryNoteModel,
  jobSource,
  timesheet,
} from '@/test/letterhead-documents';
import {
  drawnImages,
  embedsImageData,
  filledPaths,
  imageObjectCount,
  letterheadPng,
  preparedLetterhead,
  runsBelow,
  sha256,
  textRuns,
} from '@/test/letterhead-fixture';
import type { FinalDocumentSource } from '../ports';

/**
 * LETTERHEAD-1: every generator, with and without a company's uploaded
 * letterhead, through the real renderers and read back from the real bytes.
 *
 *  (a) NO LETTERHEAD, NO CHANGE: each document is the same file, to the byte,
 *      as before letterheads existed. The hashes below were taken from the
 *      renderers as they stood BEFORE this change (HEAD e08202a), on the same
 *      frozen inputs — so they prove "unchanged", not merely "consistent".
 *  (b) WITH ONE: the image is embedded once, drawn inside the header band with
 *      its proportions kept, the document's title and number are still there,
 *      and every line of text below the header is exactly where it was.
 */

/** sha256 of each document's bytes, rendered by the code before LETTERHEAD-1. */
const BEFORE_LETTERHEADS = {
  jobCard: '230bf843b9f649ae4814effb358c627e6252baf25fe29a968fc88ab6a4de9ad0',
  partsCollectionNote: '0bfc16f78bdfa3d87cfbadbad5a214796e2d54fbb97bde2e3110ce91f4a8a2d1',
  installationDeliveryNote: 'a6c9de88632d8ec1cdfad7fb801b1d861da0244e529e3c6938159fe8859a8515',
  correction: 'a754046bf3e32aabdf3241e1bbe058617feba07223f7c99bfd8e9316084c0037',
  deliveryNote: '5a9a532e888e609ac84823d137ee11d9780c18714b0eae2de023816cb503e8ef',
} as const;

/**
 * FORMS-INTERNAL-1 (the owner, 16 November 2026): attendance forms and timesheets are INTERNAL
 * documents and carry NO letterhead — exactly the forms as they were before letterheads existed.
 * sha256 of each rendered by the code before LETTERHEAD-1 (the same hashes this file has held since).
 */
const FORMS_BEFORE_LETTERHEADS = {
  timesheetOnePage: 'cacff5bd8bdf505aa66ebc8ed5e50d9910c241814088492051aa8c3be4bf559f',
  timesheetMultiPage: '59379314b7a0fd668b2ee1a223cba07550c1b035e25cbb06bc541c0be4b17225',
  attendance: '3452105ec7d2df679d22f6e0bd27f5d4d2a4ea3c738a8854a22a58a7d34e7a66',
} as const;

type Name = keyof typeof BEFORE_LETTERHEADS;

interface Generator {
  readonly name: Name;
  /** The header band: the letterhead must be drawn inside it, and nothing below `bottom` may move. */
  readonly band: { readonly bottom: number; readonly left: number; readonly right: number };
  /**
   * LETTERHEAD-2: how much LOWER the band reaches for the EJE master letterhead (one-page forms reserve
   * MASTER_HEADER_EXTRA so its lines are readable). Everything below then moves down by exactly this much.
   */
  readonly masterBandDrop?: number;
  /** A document that runs onto further pages: what no longer fits on page 1 flows onto the next. */
  readonly multiPage?: boolean;
  /** What must still read in the header with a letterhead. */
  readonly header: readonly string[];
  readonly render: (letterhead: DocumentLetterhead | undefined, omit?: boolean) => Promise<Uint8Array>;
}

const sources = new Map<string, FinalDocumentSource>();
const job = (number: string) => async (letterhead: DocumentLetterhead | undefined, omit = false) => {
  const source = sources.get(number)!;
  const given = omit ? source : { ...source, letterhead };
  return renderJobCardPdf(given, `${number}.pdf`, GENERATED_AT).bytes;
};

const GENERATORS: readonly Generator[] = [
  { name: 'jobCard', band: { bottom: 745.89, left: 40, right: 555.28 }, header: ['JOB CARD', 'EJE-1044'], render: job(JOB_DOCUMENTS.jobCard) },
  {
    name: 'partsCollectionNote',
    band: { bottom: 745.89, left: 40, right: 555.28 },
    header: ['PARTS COLLECTION NOTE', 'EJE-1062'],
    render: job(JOB_DOCUMENTS.partsCollectionNote),
  },
  {
    name: 'installationDeliveryNote',
    band: { bottom: 745.89, left: 40, right: 555.28 },
    header: ['DELIVERY NOTE', 'EJE-1050'],
    render: job(JOB_DOCUMENTS.installationDeliveryNote),
  },
  {
    name: 'correction',
    band: { bottom: 733.89, left: 40, right: 555.28 },
    header: ['CORRECTION TO JOB CARD', 'EJE-1044 · 1'],
    render: async (letterhead, omit) =>
      renderCorrectionPdf(omit === true ? correctionSource : { ...correctionSource, letterhead }, 'C.pdf').bytes,
  },
  {
    name: 'deliveryNote',
    band: { bottom: 767, left: 40, right: 555.28 },
    header: ['DELIVERY NOTE', 'EJE-9001'],
    render: async (letterhead, omit) =>
      (omit === true ? renderDeliveryNotePdf(deliveryNoteModel) : renderDeliveryNotePdf(deliveryNoteModel, letterhead)).bytes,
  },
];

let wide: PdfImage;
let tall: PdfImage;
const WIDE_PNG = letterheadPng(600, 100);

beforeAll(async () => {
  // The seed's dates are relative to today: frozen, so the inputs are the ones the hashes were taken from.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FROZEN_AT);
  for (const number of Object.values(JOB_DOCUMENTS)) sources.set(number, await jobSource(number));
  wide = await preparedLetterhead(WIDE_PNG);
  tall = await preparedLetterhead(letterheadPng(120, 160, [200, 30, 30]));
});
afterAll(() => {
  vi.useRealTimers();
});

describe('drawLetterhead', () => {
  it('draws nothing and says so without a letterhead', () => {
    const pdf = new PdfBuilder();
    pdf.addPage();
    expect(drawLetterhead(pdf, undefined, { x: 40, y: 700, width: 500, height: 100 })).toBe(false);
    expect(drawnImages(pdf.toBytes())).toEqual([]);
  });

  it('fits the image left-aligned and vertically centred, its proportions kept', async () => {
    expect(fitLetterhead(wide, { x: 40, y: 700, width: 300, height: 100 })).toEqual({ x: 40, y: 725, width: 300, height: 50 });
    expect(fitLetterhead(tall, { x: 40, y: 700, width: 300, height: 80 })).toEqual({ x: 40, y: 700, width: 60, height: 80 });
  });
});

/**
 * JOB-CARD-2 (16 November 2026): the job card, the Parts Collection Note and the Installation Delivery
 * Note are drawn in a redesigned layout now, so "the same file as before letterheads" is a promise about
 * HISTORY: the frozen renderer (job-card-pdf-v5.ts) that draws a job issued before the redesign — the
 * backfill of the seeded history, a preview of such a job — still produces exactly those bytes.
 */
const JOB_GENERATORS = new Set<Name>(['jobCard', 'partsCollectionNote', 'installationDeliveryNote']);
const historyRender = async (generator: Generator): Promise<Uint8Array> => {
  if (!JOB_GENERATORS.has(generator.name)) return generator.render(undefined, true);
  const number = JOB_DOCUMENTS[generator.name as keyof typeof JOB_DOCUMENTS];
  return renderJobCardPdfV5(sources.get(number)!, `${number}.pdf`, GENERATED_AT).bytes;
};

describe.each(GENERATORS)('$name', (generator) => {
  it('without a letterhead is the same file, to the byte, as before letterheads existed (as history is drawn)', async () => {
    const history = await historyRender(generator);
    expect(sha256(history)).toBe(BEFORE_LETTERHEADS[generator.name]);
    expect(imageObjectCount(history)).toBe(0);
    // Omitted or given as undefined: the same file.
    expect(sha256(await generator.render(undefined, true))).toBe(sha256(await generator.render(undefined)));
  });

  it('with a letterhead embeds exactly that image once, inside the header band', async () => {
    const bytes = await generator.render(wide);
    expect(imageObjectCount(bytes)).toBe(1);
    expect(embedsImageData(bytes, wide)).toBe(true);
    const drawn = drawnImages(bytes);
    expect(drawn).toHaveLength(1);
    const [image] = drawn;
    expect(image!.x).toBeCloseTo(generator.band.left, 1);
    expect(image!.y).toBeGreaterThanOrEqual(generator.band.bottom);
    expect(image!.y + image!.height).toBeLessThanOrEqual(LETTERHEAD_TOP + 0.01);
    expect(image!.x + image!.width).toBeLessThanOrEqual(generator.band.right + 0.01);
    // Never stretched: 600 × 100 stays 6 : 1.
    expect(image!.width / image!.height).toBeCloseTo(6, 1);
    // A useful size, not a postage stamp.
    expect(image!.height).toBeGreaterThan(20);
  });

  it('keeps the document’s title and number, and replaces the text header', async () => {
    const without = textRuns(await generator.render(undefined));
    const withLetterhead = textRuns(await generator.render(wide));
    const header = withLetterhead.filter((run) => run.page === 1 && run.y >= generator.band.bottom - 8).map((run) => run.value);
    // By prefix: the Installation Delivery Note's title runs on after "DELIVERY NOTE".
    for (const value of generator.header) expect(header.some((run) => run.startsWith(value)), value).toBe(true);
    // The company name drawn as text is gone from the header: the image carries it.
    const companyLine = without.find((run) => run.page === 1 && run.y > generator.band.bottom && run.font === 'bold' && run.x < 100)!;
    expect(companyLine).toBeDefined();
    expect(header).not.toContain(companyLine.value);
    // And no header text runs into the image.
    const [image] = drawnImages(await generator.render(wide));
    for (const run of withLetterhead.filter((candidate) => candidate.page === 1 && candidate.y >= generator.band.bottom - 8)) {
      const overlapsX = run.x < image!.x + image!.width && run.x + run.width > image!.x;
      const overlapsY = run.y + run.size * 0.75 > image!.y && run.y < image!.y + image!.height;
      expect(overlapsX && overlapsY, run.value).toBe(false);
    }
  });

  it('leaves every line below the header exactly where it was', async () => {
    const without = await generator.render(undefined);
    const withLetterhead = await generator.render(wide);
    const below = runsBelow(without, generator.band.bottom - 8);
    expect(below.length).toBeGreaterThan(5);
    expect(runsBelow(withLetterhead, generator.band.bottom - 8)).toEqual(below);
    // The same pages, and the same words on them below the header.
    expect(pdfPlainText(withLetterhead).split('\n').length).toBeLessThanOrEqual(pdfPlainText(without).split('\n').length);
  });

  it('a tall letterhead is fitted to the band’s height, never stretched or run off the page', async () => {
    const [image] = drawnImages(await generator.render(tall));
    expect(image!.width / image!.height).toBeCloseTo(120 / 160, 2);
    expect(image!.y).toBeGreaterThanOrEqual(generator.band.bottom);
    expect(image!.y + image!.height).toBeLessThanOrEqual(A4_HEIGHT);
  });
});

describe('the delivery note with a job number too long to sit beside the letterhead', () => {
  it('puts the title and number on one line just above the body, and the body does not move', async () => {
    const model = { ...deliveryNoteModel, jobNumber: 'EJE-9001-'.padEnd(60, 'X') };
    const without = renderDeliveryNotePdf(model).bytes;
    const withLetterhead = renderDeliveryNotePdf(model, wide).bytes;
    const title = textRuns(withLetterhead).find((run) => run.value === 'DELIVERY NOTE')!;
    const number = textRuns(withLetterhead).find((run) => run.value === model.jobNumber)!;
    expect(title.y).toBe(number.y);
    expect(title.y).toBeLessThan(780);
    const [image] = drawnImages(withLetterhead);
    expect(image!.y).toBeGreaterThan(title.y + 12);
    expect(runsBelow(withLetterhead, 766)).toEqual(runsBelow(without, 766));
  });
});

/**
 * LETTERHEAD-2: in the delivery note's second arrangement (a job number too long to sit beside the band) the EJE
 * master letterhead takes a band DELIVERY_NOTE_MASTER_EXTRA taller, so its lines are readable; the title line and
 * everything below move down by exactly that much. An uploaded image there is unchanged (tested above).
 */
describe('the delivery note with a long job number and the EJE master letterhead', () => {
  it('draws the master at a readable size and moves the title line and the body down by exactly the extra', () => {
    const model = { ...deliveryNoteModel, jobNumber: 'EJE-9001-'.padEnd(60, 'X') };
    const withImage = renderDeliveryNotePdf(model, wide).bytes;
    const withMaster = renderDeliveryNotePdf(model, EJE_MASTER_LETTERHEAD).bytes;
    const runs = textRuns(withMaster);
    expect(runs.find((run) => run.value === 'Bonfoi Office Park')!.size).toBeGreaterThanOrEqual(4.5);
    const title = runs.find((run) => run.value === 'DELIVERY NOTE')!;
    const imageTitle = textRuns(withImage).find((run) => run.value === 'DELIVERY NOTE')!;
    expect(title.y).toBeCloseTo(imageTitle.y - DELIVERY_NOTE_MASTER_EXTRA, 3);
    for (const line of MASTER_TEXT) expect(runs.find((run) => run.value === line)!.y, line).toBeGreaterThan(title.y + 12);
    const below = (bytes: Uint8Array, y: number) => textRuns(bytes).filter((run) => run.page > 1 || (run.y < y && run.y >= 40));
    const moved = below(withMaster, title.y - 4);
    const before = below(withImage, imageTitle.y - 4);
    expect(moved.map((run) => run.value)).toEqual(before.map((run) => run.value));
    moved.forEach((run, index) => {
      expect(run.x).toBeCloseTo(before[index]!.x, 3);
      expect(run.y).toBeCloseTo(run.page > 1 ? before[index]!.y : before[index]!.y - DELIVERY_NOTE_MASTER_EXTRA, 3);
    });
    expect(inspectPdf(withMaster).pageCount).toBe(inspectPdf(withImage).pageCount);
  });
});

/**
 * LETTERHEAD-2: the EJE MASTER LETTERHEAD on every generator — drawn as vector text and the
 * traced mark in exactly the header band an uploaded image would occupy, and nothing below
 * the band moved. And WD Hearn JHB (or any company that is not EJE) unchanged to the byte.
 */
const MASTER_TEXT = LETTERHEAD_LINES.map(letterheadLineText);

describe.each(GENERATORS)('$name with the EJE master letterhead', (generator) => {
  const drop = generator.masterBandDrop ?? 0;
  const masterBottom = generator.band.bottom - drop;
  it('carries every line of the official letterhead as text, inside the header band, and no image', async () => {
    const bytes = await generator.render(EJE_MASTER_LETTERHEAD);
    expect(imageObjectCount(bytes)).toBe(0);
    const runs = textRuns(bytes).filter((run) => run.page === 1);
    for (const line of MASTER_TEXT) {
      const run = runs.find((candidate) => candidate.value === line);
      expect(run, line).toBeDefined();
      expect(run!.y, line).toBeGreaterThan(masterBottom);
      expect(run!.y + run!.size * 0.75, line).toBeLessThanOrEqual(LETTERHEAD_TOP + 0.01);
      expect(run!.x, line).toBeGreaterThanOrEqual(generator.band.left - 0.01);
      expect(run!.x + run!.width / SUBSTITUTION_ALLOWANCE, line).toBeLessThanOrEqual(generator.band.right + 0.01);
    }
    // Readable: the serif address and contact lines at about the job card's size (~5 pt), never the ~3 pt of a thin strip.
    const serif = runs.find((candidate) => candidate.value === 'Bonfoi Office Park')!;
    expect(serif.size).toBeGreaterThanOrEqual(4.5);
    // LETTERHEAD-4: the paper's faces are drawn as glyph OUTLINES (forms), and the words are there as
    // invisible text (render mode 3) for search and copy — no stand-in face, no font file embedded.
    const text = Buffer.from(bytes).toString('latin1');
    for (const font of ['Helvetica-BoldOblique', 'Times-Bold', 'Times-BoldItalic']) expect(text).not.toContain(`/BaseFont /${font} `);
    expect(text).not.toContain('/FontFile');
    expect(text).toContain('/Subtype /Form');
    expect(text).toMatch(/q 3 Tr [\d.]+ Tz BT 0 0 0 rg \/F1 [\d.]+ Tf 0 Tc 1 0 0 1 [\d.]+ [\d.]+ Tm \(VAT NO: 4950134991\) Tj ET Q/u);
    // The en dash is WinAnsi 0x96, not a stand-in.
    expect(text).toContain('7736 \x96 Peet Buitendag');
    // Only on the first page: a multi-page document is not re-headed.
    expect(textRuns(bytes).filter((run) => run.page > 1 && MASTER_TEXT.includes(run.value))).toEqual([]);
  });

  it('draws the EJE mark as filled vector outlines inside the band, against its left edge', async () => {
    const paths = filledPaths(await generator.render(EJE_MASTER_LETTERHEAD));
    expect(paths).toHaveLength(1);
    const [path] = paths;
    expect(path!.page).toBe(1);
    expect(path!.points.length).toBe(EJE_MARK_POLYGONS.reduce((sum, polygon) => sum + polygon.length / 2, 0));
    for (const point of path!.points) {
      expect(point.x).toBeGreaterThanOrEqual(generator.band.left);
      expect(point.x).toBeLessThanOrEqual(generator.band.right);
      expect(point.y).toBeGreaterThanOrEqual(masterBottom);
      expect(point.y).toBeLessThanOrEqual(LETTERHEAD_TOP);
    }
    // Near the band's left edge, as on the paper (16 of 3300 units in).
    expect(Math.min(...path!.points.map((point) => point.x)) - generator.band.left).toBeLessThan(5);
  });

  it('keeps the title and number, drops the text header, and leaves every line below the band where it was', async () => {
    const without = await generator.render(undefined);
    const withMaster = await generator.render(EJE_MASTER_LETTERHEAD);
    const header = textRuns(withMaster).filter((run) => run.page === 1 && run.y >= masterBottom - 8).map((run) => run.value);
    for (const value of generator.header) expect(header.some((run) => run.startsWith(value)), value).toBe(true);
    const companyLine = textRuns(without).find((run) => run.page === 1 && run.y > masterBottom && run.font === 'bold' && run.x < 100)!;
    expect(header).not.toContain(companyLine.value);
    if (drop === 0) {
      expect(runsBelow(withMaster, masterBottom - 8)).toEqual(runsBelow(without, masterBottom - 8));
    } else if (generator.multiPage === true) {
      // Page 1: every line it still holds is the same line, exactly `drop` lower (the footer stays at the foot).
      const firstPage = (bytes: Uint8Array, y: number) => textRuns(bytes).filter((run) => run.page === 1 && run.y < y && run.y >= 40);
      const moved = firstPage(withMaster, masterBottom - 8);
      const before = firstPage(without, generator.band.bottom - 8);
      expect(moved.length).toBeGreaterThan(before.length * 0.8);
      moved.forEach((run, index) => {
        expect(run.value).toBe(before[index]!.value);
        expect(run.x).toBeCloseTo(before[index]!.x, 3);
        expect(run.y).toBeCloseTo(before[index]!.y - drop, 3);
        expect(run.size).toBeCloseTo(before[index]!.size, 3);
      });
      // What no longer fits flows on: every body line is still printed, in order, nothing dropped or doubled.
      const repeated = new Set(['Time Sheet (continued)', 'Date', 'Customer', 'OT', 'D/T', 'Callout', 'Int Km', 'Cust Km']);
      const content = (bytes: Uint8Array, y: number) =>
        textRuns(bytes).filter((run) => (run.page > 1 || run.y < y) && run.y >= 40 && !repeated.has(run.value)).map((run) => run.value);
      expect(content(withMaster, masterBottom - 8)).toEqual(content(without, generator.band.bottom - 8));
      const pages = inspectPdf(withMaster).pageCount;
      expect(pages - inspectPdf(without).pageCount).toBeGreaterThanOrEqual(0);
      expect(pages - inspectPdf(without).pageCount).toBeLessThanOrEqual(1);
      textRuns(withMaster).forEach((run) => expect(run.page).toBeLessThanOrEqual(pages));
    } else {
      const below = (bytes: Uint8Array, y: number) => textRuns(bytes).filter((run) => run.page > 1 || run.y < y);
      const moved = below(withMaster, masterBottom - 8);
      const before = below(without, generator.band.bottom - 8);
      expect(moved.map((run) => run.value)).toEqual(before.map((run) => run.value));
      moved.forEach((run, index) => {
        expect(run.x).toBeCloseTo(before[index]!.x, 3);
        // The footer is anchored to the foot of the page and stays; every body line moves down by exactly `drop`.
        const footer = before[index]!.y < 40;
        expect(run.y).toBeCloseTo(footer ? before[index]!.y : before[index]!.y - drop, 3);
        expect(run.size).toBeCloseTo(before[index]!.size, 3);
      });
    }
    if (generator.multiPage !== true) expect(inspectPdf(withMaster).pageCount).toBe(inspectPdf(without).pageCount);
    // No new collision, overrun or off-page text. The edge is the letterhead's own limit
    // (LETTERHEAD_TOP, 14pt from the paper's top): the band reaches it, image or master.
    const read = { margin: generator.band.left, edge: A4_HEIGHT - LETTERHEAD_TOP };
    expect(inspectPdf(withMaster, read).problems).toEqual(inspectPdf(without, read).problems);
  });

  // Where the master reserves a taller band (one-page forms) it is deliberately NOT where an image would be.
  it.skipIf(drop !== 0)('is drawn in exactly the place an uploaded image of the same proportions would be', async () => {
    const image = await preparedLetterhead(letterheadPng(LETTERHEAD_REFERENCE.width / 10, LETTERHEAD_REFERENCE.height / 10));
    const [drawn] = drawnImages(await generator.render(image));
    const mark = filledPaths(await generator.render(EJE_MASTER_LETTERHEAD))[0]!.points;
    const scale = drawn!.width / LETTERHEAD_REFERENCE.width;
    // Where the traced outline's own extremes fall inside the mark's box.
    const xs = EJE_MARK_POLYGONS.flatMap((polygon) => polygon.filter((_, index) => index % 2 === 0));
    const ys = EJE_MARK_POLYGONS.flatMap((polygon) => polygon.filter((_, index) => index % 2 === 1));
    const left = drawn!.x + (LETTERHEAD_MARK_BOX.x + Math.min(...xs) * LETTERHEAD_MARK_BOX.width) * scale;
    const top = drawn!.y + drawn!.height - (LETTERHEAD_MARK_BOX.y + Math.min(...ys) * LETTERHEAD_MARK_BOX.height) * scale;
    expect(Math.min(...mark.map((point) => point.x))).toBeCloseTo(left, 1);
    expect(Math.max(...mark.map((point) => point.y))).toBeCloseTo(top, 1);
  });
});

describe('FORMS-INTERNAL-1 — attendance and timesheets are the original internal forms, with no letterhead', () => {
  it('render to exactly the bytes they had before letterheads existed', () => {
    const now = {
      timesheetOnePage: sha256(renderTimesheetPdf(timesheet(10), { generatedAt: GENERATED_AT }).bytes),
      timesheetMultiPage: sha256(renderTimesheetPdf(timesheet(400), { generatedAt: GENERATED_AT }).bytes),
      attendance: sha256(renderAttendancePdf(attendance(), { generatedAt: GENERATED_AT }).bytes),
    };
    expect(now).toEqual(FORMS_BEFORE_LETTERHEADS);
  });

  it('carry no letterhead of any kind: no image, no filled mark, none of the letterhead lines', () => {
    for (const bytes of [
      renderTimesheetPdf(timesheet(10), { generatedAt: GENERATED_AT }).bytes,
      renderTimesheetPdf(timesheet(400), { generatedAt: GENERATED_AT }).bytes,
      renderAttendancePdf(attendance(), { generatedAt: GENERATED_AT }).bytes,
    ]) {
      expect(imageObjectCount(bytes)).toBe(0);
      expect(filledPaths(bytes)).toEqual([]);
      const values = textRuns(bytes).map((run) => run.value);
      for (const line of MASTER_TEXT) expect(values).not.toContain(line);
    }
  });

  it('the clock frozen before the imports is the same instant as FROZEN_AT', () => {
    expect(FROZEN_AT.toISOString()).toBe('2026-11-15T08:00:00.000Z');
  });
});

/**
 * WD HEARN JHB IS UNCHANGED, TO THE BYTE. sha256 of WD Hearn JHB's documents — with no
 * letterhead, and with an uploaded one — rendered by the code BEFORE LETTERHEAD-2 (HEAD
 * e5b9c4d, on the same frozen inputs), so they prove "unchanged", not merely "consistent".
 */
const WD_HEARN_BEFORE_MASTER = {
  'jobCard:none': 'b79d408fbd6acc426248bd4dc4a17405f3741c27c77bdd85329bca4c0fc13a59',
  'jobCard:image': '86a370fbf9024c782e40b5684db20abfbbbb50a8a4f90c3ba94f14aae71941bd',
  'partsCollectionNote:none': '8ac0891d8c72daf8d96d9c0a912d16331d293c8bf19efd4616a66f35b0f1b741',
  'partsCollectionNote:image': '61d1b289c1de24cf9030b349c31f798d42b7983cd7fda6c938aa1bf4381a6122',
  'installationDeliveryNote:none': '2fc9118766a006db9d4b2e79beec08d3aed24b1f619be09666d72bd99abbd4be',
  'installationDeliveryNote:image': 'f11b2cea7b70d4290340670709e56d3030b6f360e0def63517d04e1bac12260c',
  'correction:none': '996642c99dcc2e3139947cbb48699280041336e462ff3e3bf692a41fa2b96d25',
  'correction:image': '294041142df7c740bdbb682d156e39ce35b145ca26eee0f01c3ad1c8f1e8870b',
  'deliveryNote:none': '019acc64b3255899c1467109c397e29a2c78d0d0d7702518091805b77dc5590b',
  'deliveryNote:image': 'd20f8ccca38ac8d1b3c178fb1bf1faf5879a2b54f3f3aa5c5a3f277141a761fb',
} as const;

describe('WD Hearn JHB, with and without its uploaded letterhead', () => {
  it('renders every document to the same bytes as before the master letterhead', async () => {
    const WDJ: CompanyDetails = {
      id: WD_HEARN_JHB_COMPANY_ID,
      code: 'WDJ',
      name: 'WD Hearn JHB',
      registration: '',
      vatNumber: '',
      physicalAddress: '12 Hearn Street, Germiston',
      postalAddress: '',
      phone: '',
      fax: '',
      email: '',
    };
    const image = await preparedLetterhead(letterheadPng(500, 120, [200, 30, 30]));
    const now: Record<string, string> = {};
    // JOB-CARD-2: WD Hearn's job documents as HISTORY is drawn (the frozen layout) — unchanged to the byte.
    for (const [name, number] of Object.entries(JOB_DOCUMENTS)) {
      const source = { ...sources.get(number)!, company: WDJ };
      now[`${name}:none`] = sha256(renderJobCardPdfV5(source, `${number}.pdf`, GENERATED_AT).bytes);
      now[`${name}:image`] = sha256(renderJobCardPdfV5({ ...source, letterhead: image }, `${number}.pdf`, GENERATED_AT).bytes);
    }
    const wdCorrection = {
      ...correctionSource,
      company: { id: WD_HEARN_JHB_COMPANY_ID, name: 'WD Hearn JHB', address: '12 Hearn Street', contactLine: '', registrationLine: '' },
    };
    now['correction:none'] = sha256(renderCorrectionPdf(wdCorrection, 'C.pdf').bytes);
    now['correction:image'] = sha256(renderCorrectionPdf({ ...wdCorrection, letterhead: image }, 'C.pdf').bytes);
    const wdNote = { ...deliveryNoteModel, company: { name: 'WD Hearn JHB', address: '12 Hearn Street', contactLine: '' } };
    now['deliveryNote:none'] = sha256(renderDeliveryNotePdf(wdNote).bytes);
    now['deliveryNote:image'] = sha256(renderDeliveryNotePdf(wdNote, image).bytes);
    expect(now).toEqual(WD_HEARN_BEFORE_MASTER);
  });

  it('in the redesigned job card (JOB-CARD-2) keeps its own branding and never inherits EJE’s letterhead', async () => {
    const WDJ: CompanyDetails = {
      id: WD_HEARN_JHB_COMPANY_ID, code: 'WDJ', name: 'WD Hearn JHB', registration: '', vatNumber: '',
      physicalAddress: '12 Hearn Street, Germiston', postalAddress: '', phone: '', fax: '', email: '',
    };
    const image = await preparedLetterhead(letterheadPng(500, 120, [200, 30, 30]));
    for (const number of Object.values(JOB_DOCUMENTS)) {
      const source = { ...sources.get(number)!, company: WDJ };
      const plain = renderJobCardPdf(source, `${number}.pdf`, GENERATED_AT).bytes;
      const withOwn = renderJobCardPdf({ ...source, letterhead: image }, `${number}.pdf`, GENERATED_AT).bytes;
      for (const bytes of [plain, withOwn]) {
        expect(filledPaths(bytes)).toEqual([]);
        const values = textRuns(bytes).map((run) => run.value);
        for (const line of MASTER_TEXT) expect(values, line).not.toContain(line);
      }
      // No letterhead uploaded: its own name in the text header. Uploaded: exactly its own image, once.
      expect(pdfPlainText(plain)).toContain('WD Hearn JHB');
      expect(imageObjectCount(plain)).toBe(0);
      expect(embedsImageData(withOwn, image)).toBe(true);
    }
  });
});
