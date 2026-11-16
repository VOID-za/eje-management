import { describe, expect, it } from 'vitest';
import type { TimesheetDocument, TimesheetDocumentRow } from '@/application/timesheets';
import { EJE_MASTER_LETTERHEAD } from '@/lib/branding/eje-letterhead';
import { textRuns } from '@/test/letterhead-fixture';
import { renderTimesheetPdf } from './timesheet-pdf';

/**
 * LETTERHEAD-3 — A LARGER HEADER NEVER COSTS A MONTH ITS PAGE.
 *
 * The independent review (16 November 2026) rendered 726 month shapes: with the full form header
 * alone, about two lines a day (62–69 rows) went from one page to two. So a tight month steps the
 * header down (one-page-form.ts, `choosePlan`). Below: how v1.13.0 (a7e2a31) landed each month
 * from 55 to 110 rows — '1'/'2' one page in one/two panels, 'm' several pages — recorded by
 * rendering the same documents through a7e2a31's code. The new header must land every one the same.
 */
const V113_LANDING: readonly (readonly [comment: number, absences: number, landing: string])[] = [
  [0, 0, '111111111111111mmmmmmmmmmmmmmmmmmmmmmmmmmmm22222mmmmmmmm'],
  [0, 4, '11111111111111mmmmmmmmmmmmmmmmmmmmmmmmmmm2222222mmmmmmmm'],
  [200, 0, '111111111111111mmmmmmmmmmmmmmmmmmmmmmmmmmmm22222mmmmmmmm'],
  [200, 4, '1111111111111mmmmmmmmmmmmmmmmmmmmmmmmmmmm22222mmmmmmmmmm'],
  [504, 0, '1111111111111mmmmmmmmmmmmmmmmmmmmmmmmmmm222222mmmmmmmmmm'],
  [504, 4, '11111111111mmmmmmmmmmmmmmmmmmmmmmmmmmmm222mmmmmmmmmmmmmm'],
];
const FIRST_ROWS = 55;

const days = (n: number) => Array.from({ length: n }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
const row = (date: string, i: number, customer: string): TimesheetDocumentRow =>
  ({
    date, weekday: 'Mon', customer, recorded: true, overtimeHours: 2.25, doubleHours: i % 2 ? 1.5 : 0,
    calloutAmount: i % 4 === 0 ? 123456 : 0, calloutShared: false, internalKm: 12.4, customerKm: 98.6,
    historicalNormalHours: 0, historicalCallouts: 0,
  }) as TimesheetDocumentRow;
const month = (n: number, comment: number, absences: number): TimesheetDocument =>
  ({
    companyName: 'EJE', technicianName: 'Jan van der Merwe', fileName: 'x.pdf', from: '2026-10-01', to: '2026-10-31',
    periodLabel: 'Thu 1 Oct 2026 – Sat 31 Oct 2026',
    rows: Array.from({ length: n }, (_, i) => row(days(31)[Math.floor((i * 31) / n)]!, i, i % 3 === 0 ? 'Kruger Engineering Midrand' : 'ABC')),
    comment: 'x '.repeat(comment / 2),
    totals: { overtimeHours: 99.75, doubleHours: 23.5, calloutAmount: 9876500, internalKm: 3825.4, customerKm: 30615.6, historicalNormalHours: 0, historicalCallouts: 0 },
    submittedAt: '2026-10-31T15:00:00.000Z', submittedByName: 'Jan', versionLabel: '', inForce: true,
    absences: days(absences).map((date) => ({ date, reason: 'Sick' })),
  }) as unknown as TimesheetDocument;
const GENERATED = '2026-10-31T16:00:00.000Z';
const serifSize = (bytes: Uint8Array) => textRuns(bytes).find((run) => run.value === 'Bonfoi Office Park')!.size;

describe('LETTERHEAD-3 — the timesheet lands every tight month exactly as v1.13.0 did', () => {
  it.each(V113_LANDING)('comment %i characters, %i absences: 55–110 rows', { timeout: 120_000 }, (comment, absences, landing) => {
    let got = '';
    for (let n = FIRST_ROWS; n < FIRST_ROWS + landing.length; n++) {
      const rendered = renderTimesheetPdf(month(n, comment, absences), { generatedAt: GENERATED, letterhead: EJE_MASTER_LETTERHEAD });
      got += rendered.layout === null ? 'm' : String(rendered.layout.panels);
      // Never smaller than the letterhead v1.13.0 printed: its serif lines were 4.65–4.83pt in these months.
      expect(serifSize(rendered.bytes), `${n} rows`).toBeGreaterThanOrEqual(4.65);
      if (rendered.layout !== null) expect(rendered.pageCount).toBe(1);
    }
    expect(got).toBe(landing);
  });

  it('an ordinary month keeps the full, readable header; a tight one steps down, not to v1.13.0 size unless it must', () => {
    const ordinary = renderTimesheetPdf(month(31, 0, 0), { generatedAt: GENERATED, letterhead: EJE_MASTER_LETTERHEAD });
    expect(serifSize(ordinary.bytes)).toBeGreaterThanOrEqual(6.4);
    const tight = renderTimesheetPdf(month(66, 0, 0), { generatedAt: GENERATED, letterhead: EJE_MASTER_LETTERHEAD });
    expect(tight.layout?.panels).toBe(1);
    expect(tight.layout!.bodyPt).toBeGreaterThanOrEqual(7);
    expect(serifSize(tight.bytes)).toBeGreaterThanOrEqual(4.65);
  });
});

/**
 * LETTERHEAD-3 — AND NEVER ADDS A PAGE. The re-review: with the full header on page 1, about one
 * multi-page timesheet in twenty ran one page longer than v1.13.0's. Below, v1.13.0's page counts
 * ('1' = one page) for 30–120 rows, every other line an 80-character customer, the version line
 * printed — recorded through a7e2a31's code. The new header must print each on as many pages.
 */
const LONG = 'Kruger Engineering Vanderbijlpark Plant Works and Heavy Fabrication Division (Pty)';
const V113_PAGES: readonly (readonly [comment: number, absences: number, longNames: boolean, pages: string])[] = [
  [0, 0, true, '1111111113333333333334444444444444555555555555'],
  [980, 10, true, '1111113333333333333444444444444555555555555566'],
  [980, 0, false, '1111111111111111122222233333333113333333333334'],
];
const longMonth = (n: number, comment: number, absences: number, longNames: boolean): TimesheetDocument => {
  const base = month(n, comment, absences);
  return {
    ...base,
    periodLabel: 'Oct',
    technicianName: 'Jan van der Merwe',
    versionLabel: 'Corrected by the office after submission (2 days)',
    rows: base.rows.map((line, i) => ({ ...line, customer: longNames && i % 2 ? LONG : line.customer })),
  };
};

describe('LETTERHEAD-3 — the multi-page timesheet prints on as many pages as v1.13.0', () => {
  it.each(V113_PAGES)('comment %i characters, %i absences, long names %s: 30–120 rows', { timeout: 120_000 }, (comment, absences, longNames, pages) => {
    let got = '';
    for (let n = 30, index = 0; index < pages.length; n += 2, index++) {
      const rendered = renderTimesheetPdf(longMonth(n, comment, absences, longNames), { generatedAt: GENERATED, letterhead: EJE_MASTER_LETTERHEAD });
      got += rendered.layout === null ? String(rendered.pageCount) : '1';
      expect(serifSize(rendered.bytes), `${n} rows`).toBeGreaterThanOrEqual(4.65);
    }
    expect(got).toBe(pages);
  });
});
