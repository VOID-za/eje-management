import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PdfImage } from '@/lib/pdf/image';
import { A4_HEIGHT, A4_WIDTH } from '@/lib/pdf/writer';
import { pdfPlainText } from '@/lib/pdf/inspect';
import { renderJobCardPdf } from './job-card-pdf';
import { renderCorrectionPdf } from './correction-pdf';
import { renderDeliveryNotePdf } from './delivery-note-pdf';
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
  /** What must still read in the header with a letterhead. */
  readonly header: readonly string[];
  readonly render: (letterhead: PdfImage | undefined, omit?: boolean) => Promise<Uint8Array>;
}

const sources = new Map<string, FinalDocumentSource>();
const job = (number: string) => async (letterhead: PdfImage | undefined, omit = false) => {
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
    header: ['TIME SHEET'],
    render: async (letterhead, omit) =>
      renderTimesheetPdf(timesheet(400), omit === true ? { generatedAt: GENERATED_AT } : { generatedAt: GENERATED_AT, letterhead }).bytes,
  },
  {
    name: 'timesheetOnePage',
    band: { bottom: 794, left: 28, right: A4_WIDTH - 28 },
    header: ['TIME SHEET'],
    render: async (letterhead, omit) =>
      renderTimesheetPdf(timesheet(10), omit === true ? { generatedAt: GENERATED_AT } : { generatedAt: GENERATED_AT, letterhead }).bytes,
  },
  {
    name: 'attendance',
    band: { bottom: 794, left: 28, right: A4_WIDTH - 28 },
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
