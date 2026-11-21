import { beforeAll, describe, expect, it, vi } from 'vitest';
/*
 * The seed's dates are relative to today and some are taken at import, so the clock is frozen before
 * any import (as the other job-card tests do).
 */
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-15T08:00:00.000Z'));
});
import { createHash } from 'node:crypto';
import { A4_HEIGHT } from '@/lib/pdf/writer';
import { inspectPdf } from '@/lib/pdf/inspect';
import { EJE_MASTER_LETTERHEAD } from '@/lib/branding/eje-letterhead';
import { documentPhotos } from '@/lib/job-card/model';
import { JOB_CARD_LAYOUT_RENDERER, hasFlowingPagination, jobCardLayoutOf } from '@/lib/job-card/layout-version';
import type { Attachment, FinalDocument } from '@/domain';
import { GENERATED_AT, JOB_DOCUMENTS, jobSource } from '@/test/letterhead-documents';
import { textRuns } from '@/test/letterhead-fixture';
import { photoImagesFor, withWork, type WorkLines } from '@/test/job-card-fixtures';
import type { FinalDocumentSource } from '../ports';
import { renderJobCardPdf } from './job-card-pdf';
import { FOOTER_SPACE, GENUINE_FOOTER_SPACE, MARGIN } from './pdf-sheet';

/**
 * JOB-CARD-6 — PAGINATION (the owner, 21 November 2026, on the issued EJE-2138: page 1 half empty, the
 * totals and signature alone on page 2, one photograph alone on page 3). From edition 10: the totals and
 * the whole acceptance go directly under the table whenever they fit there, measured as drawn; the
 * photographs follow on, the heading always with the first row; nothing is sent to a new page needlessly.
 * Pinned on the rendered PDF. EJE-2138 itself is never re-rendered: its equivalent here is a fixture.
 */

const L = (date: string, hours: number, description: string) => ({ date, rateType: 'normal' as const, hours, description });
const T = (date: string, kilometres: number, description: string) => ({ date, kilometres, description });
const P = (partNumber: string, description: string, quantity: number, unitPriceCents: number) => ({ partNumber, description, quantity, unitPriceCents });

/** EJE-2138's work: three labour lines on two days, the call-out, a test bench fee of 12, two trips, one photograph. */
const EJE_2138: WorkLines = {
  callout: true,
  labour: [L('2026-11-21', 8, 'Normal Time'), L('2026-11-21', 2, 'Normal Time'), L('2026-11-22', 6, 'Normal Time')],
  travel: [T('2026-11-21', 80, 'Travel'), T('2026-11-22', 50, 'Travel')],
  parts: [P('TB-FEE', 'Test bench fee', 12, 75000)],
  photos: 1,
};

let breakdown: FinalDocumentSource; // EJE-1054: a Breakdown, signed
let unsigned: FinalDocumentSource; // EJE-1067: Test & Repair, not signed
let template: Attachment;

/** EJE-2138's write-up: a one-line fault and a one-line piece of work, and no job notes. */
const brief = (source: FinalDocumentSource): FinalDocumentSource => ({
  ...source,
  job: {
    ...source.job,
    notes: [],
    faultDescription: 'Hydraulic leaks',
    completionReport: { faultFindings: '', diagnosis: '', workPerformed: 'Replace pipes and seals', recommendations: '', generalNotes: '' },
  },
});

const draw = async (source: FinalDocumentSource, layout?: 9) =>
  renderJobCardPdf(
    { ...source, ...(layout === undefined ? {} : { layout }), photoImages: await photoImagesFor(source.job), letterhead: EJE_MASTER_LETTERHEAD },
    'J.pdf',
    GENERATED_AT,
  );

beforeAll(async () => {
  breakdown = await jobSource('EJE-1054');
  unsigned = await jobSource('EJE-1067');
  template = documentPhotos(breakdown.job)[0]!;
});

const find = (runs: ReturnType<typeof textRuns>, value: string) => runs.find((run) => run.value === value)!;
const photoCaptions = (runs: ReturnType<typeof textRuns>) => runs.filter((run) => /^Photograph \d+ of \d+/u.test(run.value));

/** The checks every edition-10 job card must pass, whatever its content. */
const assertFlow = (bytes: Uint8Array, floor: number = MARGIN + GENUINE_FOOTER_SPACE) => {
  const report = inspectPdf(bytes, { margin: MARGIN, edge: 14 });
  expect(report.problems).toEqual([]);
  const runs = report.runs;
  // No blank page: every page carries body text above the footer, not only the footer.
  for (let page = 1; page <= report.pageCount; page += 1) {
    expect(runs.some((run) => run.page === page && run.y > MARGIN + FOOTER_SPACE), `page ${page} has content`).toBe(true);
  }
  // Nothing of the body below the floor, on any page (the footer lines sit at MARGIN + 16 and below).
  // (The demonstration stamp is part of the footer: it is drawn in the band the floor keeps clear.)
  for (const run of runs.filter((candidate) => candidate.y > MARGIN + 20 && !candidate.value.startsWith('SIMULATED'))) {
    expect(run.y, run.value).toBeGreaterThanOrEqual(floor);
  }
  // The totals and the whole acceptance on one page.
  const subtotal = runs.find((run) => run.value === 'Subtotal');
  const caption = runs.find((run) => run.value === 'Customer signature');
  if (subtotal !== undefined && caption !== undefined) {
    expect(find(runs, 'Total').page).toBe(subtotal.page);
    expect(caption.page).toBe(subtotal.page);
    expect(find(runs, 'CUSTOMER ACCEPTANCE').page).toBe(subtotal.page);
  }
  // The photographs' heading never alone: the first photograph (its caption) directly under it.
  const heading = runs.find((run) => run.value === 'PHOTOGRAPHS');
  const captions = photoCaptions(runs);
  if (heading !== undefined) {
    const first = captions.find((run) => run.value.startsWith('Photograph 1 of'))!;
    expect(first.page).toBe(heading.page);
    expect(heading.y - first.y).toBeLessThan(160);
    expect(heading.y - first.y).toBeGreaterThan(0);
  }
  return report;
};

describe('JOB-CARD-6 — the EJE-2138 case (B: the sign-off fits under the table, the photograph does not)', () => {
  it('keeps the totals and the signature on page 1, and moves the heading and photograph together to page 2', async () => {
    const source = brief(withWork(breakdown, EJE_2138, template));
    const after = await draw(source);
    const before = await draw(source, 9);
    const runs = assertFlow(after.bytes).runs;
    expect(find(runs, 'Subtotal').page).toBe(1);
    expect(find(runs, 'Customer signature').page).toBe(1);
    expect(find(runs, 'PHOTOGRAPHS').page).toBe(2);
    expect(find(runs, 'PHOTOGRAPHS').y).toBeGreaterThan(A4_HEIGHT - 60); // the top of page 2
    expect(after.pageCount).toBe(2);
    // Edition 9 drew it as EJE-2138 was issued: three pages, the sign-off alone on page 2.
    expect(before.pageCount).toBe(3);
    expect(find(textRuns(before.bytes), 'Subtotal').page).toBe(2);
  });
});

describe('JOB-CARD-6 — A: a short job', () => {
  it('puts the sign-off on page 1 and, only when the photograph cannot fit under it, the photograph on page 2', async () => {
    const source = brief(withWork(breakdown, { labour: [L('2026-11-14', 3, 'Fault finding')], travel: [T('2026-11-14', 40, 'Return trip')], photos: 1 }, template));
    const { bytes, pageCount } = await draw(source);
    const runs = assertFlow(bytes).runs;
    expect(find(runs, 'Customer signature').page).toBe(1);
    expect(pageCount).toBe(2);
    // It genuinely does not fit: the heading and first row need more than is left below the signature.
    const caption = find(runs, 'Customer signature');
    const firstCaption = photoCaptions(runs)[0]!;
    const rowAndHeading = find(runs, 'PHOTOGRAPHS').y - firstCaption.y;
    expect(caption.y - (MARGIN + GENUINE_FOOTER_SPACE)).toBeLessThan(rowAndHeading);
  });

  it('is ONE page when everything physically fits (an unsigned card: no signature box)', async () => {
    const source = brief(withWork(unsigned, { labour: [L('2026-11-03', 3, 'Bench test')], photos: 1 }, template));
    const after = await draw(source);
    expect(after.pageCount).toBe(1);
    const runs = assertFlow(after.bytes).runs;
    expect(find(runs, 'PHOTOGRAPHS').page).toBe(1);
    expect((await draw(source, 9)).pageCount).toBe(2); // edition 9: the photograph on a page of its own
  });
});

describe('JOB-CARD-6 — C: several photographs', () => {
  it('flows them row by row into the room left, with no needless page', async () => {
    const source = brief(withWork(breakdown, { labour: [L('2026-11-14', 4, 'Fault finding')], photos: 8 }, template));
    const { bytes, pageCount } = await draw(source);
    const runs = assertFlow(bytes).runs;
    expect(pageCount).toBe(2);
    expect(photoCaptions(runs)).toHaveLength(8);
    // Each page's photographs start right after what precedes them: a row moves on only when it cannot fit.
    const lastPage = Math.max(...photoCaptions(runs).map((run) => run.page));
    expect(lastPage).toBe(pageCount);
  });

  it('starts the photographs under the signature when the first row fits there', async () => {
    // A sign-off high on page 1 leaves room for a row; the heading and that row stay on page 1.
    const source = brief(withWork(unsigned, { labour: [L('2026-11-03', 3, 'Bench test')], photos: 7 }, template));
    const runs = assertFlow((await draw(source)).bytes).runs;
    expect(find(runs, 'PHOTOGRAPHS').page).toBe(1);
    expect(photoCaptions(runs).filter((run) => run.page === 2).length).toBeGreaterThan(0);
  });
});

describe('JOB-CARD-6 — D: a long job', () => {
  it('splits the table with its headings repeated, keeps the totals and acceptance together, and lets the photographs follow', async () => {
    const source = withWork(breakdown, {
      callout: true,
      labour: Array.from({ length: 40 }, (_, i) => L(`2026-11-${String(1 + (i % 28)).padStart(2, '0')}`, 1 + (i % 3), `Attendance ${i + 1}`)),
      travel: Array.from({ length: 6 }, (_, i) => T('2026-11-14', 60 + i, `Trip ${i + 1}`)),
      photos: 5,
    }, template);
    const { bytes, pageCount } = await draw(source);
    const runs = assertFlow(bytes).runs;
    const tablePages = new Set(runs.filter((run) => /Attendance \d+$|Trip \d+$/u.test(run.value)).map((run) => run.page));
    expect(tablePages.size).toBeGreaterThan(1);
    for (const page of tablePages) {
      expect(runs.some((run) => run.page === page && run.value === 'Description'), `headings on page ${page}`).toBe(true);
    }
    const signature = find(runs, 'Customer signature');
    expect(find(runs, 'PHOTOGRAPHS').page).toBe(signature.page); // following on, not on a page of their own
    expect(pageCount).toBeLessThan((await draw(source, 9)).pageCount);
  });

  it('never leaves the sign-off a page away from room it would have fitted in, however long the table', async () => {
    for (let lines = 1; lines <= 46; lines += 1) {
      const source = brief(withWork(breakdown, { labour: Array.from({ length: lines }, (_, i) => L('2026-11-14', 1, `Line ${i + 1}`)), photos: 2 }, template));
      const runs = assertFlow((await draw(source)).bytes).runs;
      const subtotal = find(runs, 'Subtotal');
      const caption = find(runs, 'Customer signature');
      const lastRow = runs.filter((run) => /^Normal Time — Line \d+$/u.test(run.value)).at(-1)!;
      if (subtotal.page !== lastRow.page) {
        // Moved on only because it could not fit: the block, placed under the last row, would cross the floor.
        const span = subtotal.y - caption.y;
        expect(lastRow.y - 21 - span, `${lines} lines`).toBeLessThan(MARGIN + GENUINE_FOOTER_SPACE + 3);
      }
    }
  });
});

describe('JOB-CARD-6 — E: no photographs', () => {
  it('draws no PHOTOGRAPHS heading and no page for them', async () => {
    const source = brief(withWork(breakdown, { labour: [L('2026-11-14', 5, 'Fault finding')], travel: [T('2026-11-14', 128, 'Return trip')], parts: [P('TRF-400-110', 'Control transformer', 1, 312000)], photos: 0 }, template));
    const { bytes, pageCount } = await draw(source);
    const runs = assertFlow(bytes).runs;
    expect(runs.some((run) => run.value === 'PHOTOGRAPHS')).toBe(false);
    expect(pageCount).toBe(1);
  });
});

describe('JOB-CARD-6 — what it does not change', () => {
  it('keeps the demonstration stamp band clear on a demonstration document', async () => {
    const source = brief(withWork(breakdown, EJE_2138, template));
    const demo = { ...source, job: { ...source.job, finalDocument: { ...(source.job.finalDocument ?? {}), provenance: 'simulated' } as FinalDocument } };
    for (let lines = 1; lines <= 30; lines += 3) {
      const withLines = withWork(demo, { ...EJE_2138, labour: Array.from({ length: lines }, (_, i) => L('2026-11-14', 1, `Line ${i + 1}`)) }, template);
      assertFlow((await draw(withLines)).bytes, MARGIN + FOOTER_SPACE);
    }
  });

  it('draws edition 9 (a document issued in v1.16.2) to the very bytes v1.16.2 drew', async () => {
    const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    // Hashes taken from 436abab (v1.16.2 + docs) on these inputs.
    const job = await jobSource(JOB_DOCUMENTS.jobCard);
    expect(sha(renderJobCardPdf({ ...job, layout: 9, letterhead: EJE_MASTER_LETTERHEAD }, 'J.pdf', GENERATED_AT).bytes)).toBe(E9_JOB_CARD);
    const worked = withWork(breakdown, { labour: Array.from({ length: 6 }, (_, i) => L('2026-11-14', 1, `Line ${i + 1}`)), callout: true, photos: 1 }, template);
    expect(sha((await draw(worked, 9)).bytes)).toBe(E9_BREAKDOWN_6_LINES_1_PHOTO);
  });

  it('a document issued in edition 10 is shown in it; one issued in 9 keeps 9', () => {
    expect(JOB_CARD_LAYOUT_RENDERER).toBe(10);
    expect(jobCardLayoutOf({ renderer: 10 })).toBe(10);
    expect(jobCardLayoutOf({ renderer: 9 })).toBe(9);
    expect(hasFlowingPagination(10)).toBe(true);
    for (const edition of [6, 7, 8, 9] as const) expect(hasFlowingPagination(edition)).toBe(false);
  });
});

const E9_JOB_CARD = '76746f7f5cdd616ccae21a73062b8e896313ee63e6fc3d7cc8e6956f164f80c2';
const E9_BREAKDOWN_6_LINES_1_PHOTO = '1957cb33d839733e65b3b8865d22cc0a48b70020198fc73345375dfb31ae2d13';
