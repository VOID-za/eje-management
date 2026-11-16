import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
/*
 * The seed's dates are relative to today, and some of them are taken when its modules are IMPORTED —
 * before `beforeAll` runs. So the clock is frozen here, before any import, as well as in `beforeAll`:
 * without it the hashes below held only on the day they were taken (they failed from 16 November).
 * The same instant as FROZEN_AT (src/test/letterhead-documents.ts), which cannot be imported this early.
 */
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-15T08:00:00.000Z'));
});
import type { PdfImage } from '@/lib/pdf/image';
import { A4_HEIGHT, A4_WIDTH, textWidth } from '@/lib/pdf/writer';
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
import { renderCorrectionPdf } from './correction-pdf';
import { DELIVERY_NOTE_MASTER_EXTRA, renderDeliveryNotePdf } from './delivery-note-pdf';
import { renderTimesheetPdf } from './timesheet-pdf';
import { renderAttendancePdf } from './attendance-pdf';
import { FORM_TITLE_SIZE, LETTERHEAD_TOP, TRACK_TITLE, drawLetterhead, fitLetterhead } from './pdf-sheet';
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
   * LETTERHEAD-2: how much LOWER the band reaches for the EJE master letterhead (the delivery note's
   * long-number layout reserves DELIVERY_NOTE_MASTER_EXTRA so its lines are readable). Everything below
   * then moves down by exactly this much.
   */
  readonly masterBandDrop?: number;
  /**
   * LETTERHEAD-3: the attendance and timesheet forms give the master letterhead a header of their own
   * (`drawFormHeader`), taller than the text heading; the drop is measured — how much lower the first
   * field ("Technician Name") is — and the header itself is tested on its own below.
   */
  readonly formHeader?: boolean;
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
  {
    name: 'timesheetMultiPage',
    band: { bottom: 789, left: 40, right: 555.28 },
    formHeader: true,
    multiPage: true,
    header: ['TIME SHEET'],
    render: async (letterhead, omit) =>
      renderTimesheetPdf(timesheet(400), omit === true ? { generatedAt: GENERATED_AT } : { generatedAt: GENERATED_AT, letterhead }).bytes,
  },
  {
    name: 'timesheetOnePage',
    band: { bottom: 794, left: 28, right: A4_WIDTH - 28 },
    formHeader: true,
    header: ['TIME SHEET'],
    render: async (letterhead, omit) =>
      renderTimesheetPdf(timesheet(10), omit === true ? { generatedAt: GENERATED_AT } : { generatedAt: GENERATED_AT, letterhead }).bytes,
  },
  {
    name: 'attendance',
    band: { bottom: 794, left: 28, right: A4_WIDTH - 28 },
    formHeader: true,
    header: ['ATTENDANCE'],
    render: async (letterhead, omit) =>
      renderAttendancePdf(attendance(), omit === true ? { generatedAt: GENERATED_AT } : { generatedAt: GENERATED_AT, letterhead }).bytes,
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

describe.each(GENERATORS)('$name', (generator) => {
  it('without a letterhead is the same file, to the byte, as before letterheads existed', async () => {
    const omitted = await generator.render(undefined, true);
    const undefinedGiven = await generator.render(undefined);
    expect(sha256(omitted)).toBe(BEFORE_LETTERHEADS[generator.name]);
    expect(sha256(undefinedGiven)).toBe(BEFORE_LETTERHEADS[generator.name]);
    expect(imageObjectCount(omitted)).toBe(0);
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

/** How much lower a form's first field is with the master's form header than with the text heading. */
const fieldDrop = (without: Uint8Array, withMaster: Uint8Array): number => {
  const label = (bytes: Uint8Array) => textRuns(bytes).find((run) => run.page === 1 && run.value === 'Technician Name')!.y;
  return label(without) - label(withMaster);
};

describe.each(GENERATORS)('$name with the EJE master letterhead', (generator) => {
  let drop = generator.masterBandDrop ?? 0;
  let masterBottom = generator.band.bottom - drop;
  beforeAll(async () => {
    if (generator.formHeader !== true) return;
    drop = fieldDrop(await generator.render(undefined), await generator.render(EJE_MASTER_LETTERHEAD));
    masterBottom = generator.band.bottom - drop;
  });
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
    // The faces of the paper: Helvetica-BoldOblique, Times-Bold and Times-BoldItalic, named and not embedded.
    const text = Buffer.from(bytes).toString('latin1');
    for (const font of ['Helvetica-BoldOblique', 'Times-Bold', 'Times-BoldItalic']) expect(text).toContain(`/BaseFont /${font} `);
    expect(text).not.toContain('/FontFile');
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
  it.skipIf((generator.masterBandDrop ?? 0) !== 0 || generator.formHeader === true)('is drawn in exactly the place an uploaded image of the same proportions would be', async () => {
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

describe('one-page forms stay one page with the master letterhead', () => {
  it('the one-page timesheet and the attendance form', () => {
    expect(renderTimesheetPdf(timesheet(10), { generatedAt: GENERATED_AT, letterhead: EJE_MASTER_LETTERHEAD }).pageCount).toBe(1);
    expect(renderAttendancePdf(attendance(), { generatedAt: GENERATED_AT, letterhead: EJE_MASTER_LETTERHEAD }).pageCount).toBe(1);
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
  'timesheetOnePage:image': 'f9a60dc9e315e9e1228255b470af78ffe538e3ad0417341dbdb45ac90fe85b91',
  'timesheetMultiPage:image': '7e127ef2285a8e24492b8df8d2645d21c6a8e21edafd061744b158813c1862bf',
  'attendance:image': '9cae1f013246b637781c26e42670619d87d9ad58bb17ab90b32afe1f59589c02',
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
    for (const [name, number] of Object.entries(JOB_DOCUMENTS)) {
      const source = { ...sources.get(number)!, company: WDJ };
      now[`${name}:none`] = sha256(renderJobCardPdf(source, `${number}.pdf`, GENERATED_AT).bytes);
      now[`${name}:image`] = sha256(renderJobCardPdf({ ...source, letterhead: image }, `${number}.pdf`, GENERATED_AT).bytes);
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
    now['timesheetOnePage:image'] = sha256(renderTimesheetPdf(timesheet(10), { generatedAt: GENERATED_AT, letterhead: image }).bytes);
    now['timesheetMultiPage:image'] = sha256(renderTimesheetPdf(timesheet(400), { generatedAt: GENERATED_AT, letterhead: image }).bytes);
    now['attendance:image'] = sha256(renderAttendancePdf(attendance(), { generatedAt: GENERATED_AT, letterhead: image }).bytes);
    expect(now).toEqual(WD_HEARN_BEFORE_MASTER);
  });
});

/**
 * LETTERHEAD-3 (the owner, 16 November 2026): on the attendance and timesheet forms the master letterhead
 * was squeezed into the text heading's short band — tiny, hard to read, and the title dominated. The forms
 * now give it a header of their own (`drawFormHeader`): larger, balanced, the title on the right.
 */
describe('LETTERHEAD-3 — the attendance and timesheet header', () => {
  const FORMS = [
    { name: 'attendance (one page)', title: 'ATTENDANCE', left: 28, right: A4_WIDTH - 28, render: () => renderAttendancePdf(attendance(), { generatedAt: GENERATED_AT, letterhead: EJE_MASTER_LETTERHEAD }) },
    { name: 'timesheet (one page)', title: 'TIME SHEET', left: 28, right: A4_WIDTH - 28, render: () => renderTimesheetPdf(timesheet(10), { generatedAt: GENERATED_AT, letterhead: EJE_MASTER_LETTERHEAD }) },
    { name: 'timesheet (31 days, one page)', title: 'TIME SHEET', left: 28, right: A4_WIDTH - 28, render: () => renderTimesheetPdf(timesheet(31), { generatedAt: GENERATED_AT, letterhead: EJE_MASTER_LETTERHEAD }) },
    { name: 'timesheet (several pages)', title: 'TIME SHEET', left: 40, right: A4_WIDTH - 40, render: () => renderTimesheetPdf(timesheet(400), { generatedAt: GENERATED_AT, letterhead: EJE_MASTER_LETTERHEAD }) },
  ] as const;

  it.each(FORMS)('$name: a larger, readable letterhead, the title beside it, a clear gap before the fields', (form) => {
    const bytes = form.render().bytes;
    const runs = textRuns(bytes).filter((run) => run.page === 1);
    const lines = MASTER_TEXT.map((value) => runs.find((run) => run.value === value)!);
    // Larger than the ~4.9pt / ~11.6pt the short band gave: the details ≥ 6pt, the name ≥ 14pt, Reg and VAT ≥ 5pt.
    expect(runs.find((run) => run.value === 'Bonfoi Office Park')!.size).toBeGreaterThanOrEqual(6);
    expect(runs.find((run) => run.value.startsWith('EJE Industrial Electronics'))!.size).toBeGreaterThanOrEqual(14);
    expect(runs.find((run) => run.value === 'VAT NO: 4950134991')!.size).toBeGreaterThanOrEqual(5);
    // The mark, its proportions kept (1.5 : 1), at least 50pt tall (it was ~41pt).
    const mark = filledPaths(bytes)[0]!.points;
    const markWidth = Math.max(...mark.map((p) => p.x)) - Math.min(...mark.map((p) => p.x));
    const markHeight = Math.max(...mark.map((p) => p.y)) - Math.min(...mark.map((p) => p.y));
    expect(markHeight).toBeGreaterThanOrEqual(50);
    const xs = EJE_MARK_POLYGONS.flatMap((polygon) => polygon.filter((_, index) => index % 2 === 0));
    const ys = EJE_MARK_POLYGONS.flatMap((polygon) => polygon.filter((_, index) => index % 2 === 1));
    const traced = ((Math.max(...xs) - Math.min(...xs)) * LETTERHEAD_MARK_BOX.width) / ((Math.max(...ys) - Math.min(...ys)) * LETTERHEAD_MARK_BOX.height);
    expect(markWidth / markHeight).toBeCloseTo(traced, 2);
    // The title: smaller than the 16–17pt that dominated, flush right, clear of the letterhead, centred on its height.
    const title = runs.find((run) => run.value === form.title)!;
    expect(title.size).toBe(FORM_TITLE_SIZE);
    expect(title.x + textWidth(form.title, FORM_TITLE_SIZE, 'bold', TRACK_TITLE)).toBeCloseTo(form.right, 1);
    const letterheadRight = Math.max(...lines.map((run) => run.x + run.width / SUBSTITUTION_ALLOWANCE));
    expect(title.x - letterheadRight).toBeGreaterThanOrEqual(10);
    const inkTop = Math.max(...mark.map((p) => p.y), ...lines.map((run) => run.y + run.size * 0.72));
    const inkBottom = Math.min(...mark.map((p) => p.y), ...lines.map((run) => run.y - run.size * 0.22));
    expect(title.y + title.size * 0.36).toBeCloseTo((inkTop + inkBottom) / 2, 0);
    // Inside the paper's printable area, and the whole letterhead within the form's margins.
    expect(inkTop).toBeLessThanOrEqual(A4_HEIGHT - 20);
    expect(Math.min(...mark.map((p) => p.x))).toBeGreaterThanOrEqual(form.left - 0.01);
    // The fields start a clear gap below the letterhead (a rule between): ≥ 18pt from its ink to the first capitals.
    const field = runs.find((run) => run.value === 'Technician Name')!;
    expect(inkBottom - (field.y + field.size * 0.72)).toBeGreaterThanOrEqual(18);
    // Nothing collides, overruns or leaves the page (the footer sits 18pt from the foot, as it always has).
    expect(inspectPdf(bytes, { margin: form.left, edge: A4_HEIGHT - LETTERHEAD_TOP }).problems).toEqual([]);
  });

  it('the attendance form and the timesheets carry the letterhead at the same size on one-page forms', () => {
    const size = (bytes: Uint8Array) => textRuns(bytes).find((run) => run.value === 'Bonfoi Office Park')!.size;
    expect(size(FORMS[0].render().bytes)).toBeCloseTo(size(FORMS[1].render().bytes), 6);
  });

  it('pagination: one-page forms stay one page; the multi-page timesheet keeps its pages and repeats no letterhead', () => {
    expect(FORMS[0].render().pageCount).toBe(1);
    expect(FORMS[1].render().pageCount).toBe(1);
    expect(FORMS[2].render().pageCount).toBe(1);
    const multi = FORMS[3].render();
    const plain = renderTimesheetPdf(timesheet(400), { generatedAt: GENERATED_AT });
    expect(multi.pageCount).toBe(plain.pageCount);
    expect(inspectPdf(multi.bytes).pageCount).toBe(multi.pageCount);
    expect(textRuns(multi.bytes).filter((run) => run.page > 1 && MASTER_TEXT.includes(run.value))).toEqual([]);
  });
});

/**
 * LETTERHEAD-3: the approved headers are NOT touched — the job card, the parts collection note, the
 * installation delivery note, the correction addendum and the delivery note with the master letterhead
 * render to exactly the bytes v1.13.0 (a7e2a31) rendered, on the same frozen inputs.
 */
const APPROVED_MASTER_DOCUMENTS = {
  jobCard: 'd0156a7bb91418d9cd19267ac06e74e49630062f935e545562434819e5879c15',
  partsCollectionNote: 'efb1fa327dbad3c03aac6eff34b6d88db4ebe5f09a682add6a11882a20cb4ef9',
  installationDeliveryNote: 'a616c02a2a9f16a6037bd9ae3ca874932ab5515e40859ac8b041da4c8889d8b1',
  correction: 'f8a0bae3e1f85ce09031a53797c279c7056be7e40e3cf06482c23de430a6c892',
  deliveryNote: '95d87e5093f22c7d06d7aeaf7a2020c47f3629e84e7f535c972bc6c94488e254',
};

describe('LETTERHEAD-3 leaves every approved master header as v1.13.0 drew it', () => {
  it('the job card, parts collection note, installation delivery note, correction and delivery note: same bytes', async () => {
    const now: Record<string, string> = {};
    for (const generator of GENERATORS) {
      if (generator.name in APPROVED_MASTER_DOCUMENTS) now[generator.name] = sha256(await generator.render(EJE_MASTER_LETTERHEAD));
    }
    expect(now).toEqual(APPROVED_MASTER_DOCUMENTS);
  });
});

describe('the clock frozen before the imports', () => {
  it('is the same instant as FROZEN_AT, so the two cannot drift apart', () => {
    expect(FROZEN_AT.toISOString()).toBe('2026-11-15T08:00:00.000Z');
  });
});
