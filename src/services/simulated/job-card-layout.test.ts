import { beforeAll, describe, expect, it, vi } from 'vitest';
/*
 * The seed's dates are relative to today and some are taken at import, so the clock is frozen before
 * any import (the same instant as FROZEN_AT in src/test/letterhead-documents.ts).
 */
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-15T08:00:00.000Z'));
});
import { A4_HEIGHT } from '@/lib/pdf/writer';
import { inspectPdf, pdfPlainText } from '@/lib/pdf/inspect';
import { formatDate } from '@/lib/format';
import { EJE_MASTER_LETTERHEAD } from '@/lib/branding/eje-letterhead';
import { documentPhotos } from '@/lib/job-card/model';
import { JOB_CARD_LAYOUT_RENDERER, showsCurrentJobCardLayout } from '@/lib/job-card/layout-version';
import type { IsoDate } from '@/domain';
import { GENERATED_AT, jobSource } from '@/test/letterhead-documents';
import { drawnImages, textRuns } from '@/test/letterhead-fixture';
import { photoImagesFor, withWork, type WorkLines } from '@/test/job-card-fixtures';
import type { FinalDocumentSource } from '../ports';
import { renderJobCardPdf } from './job-card-pdf';
import { MARGIN, RIGHT } from './pdf-sheet';

/**
 * JOB-CARD-2 — THE JOB CARD REDESIGN (the owner, 16 November 2026), pinned on the rendered PDF:
 * the labour, travel and parts table with an honest Date column; the contact details grouped; Job
 * Details to the right; WORK CARRIED OUT over its subheadings in two columns; the acceptance on the
 * right under the totals, kept together; then the checklist; then the photographs on a page of their own.
 */

const L = (date: string, rateType: 'normal' | 'overtime' | 'double', hours: number, description: string) => ({ date, rateType, hours, description });
const T = (date: string, kilometres: number, description: string) => ({ date, kilometres, description });
const P = (partNumber: string, description: string, quantity: number, unitPriceCents: number) => ({ partNumber, description, quantity, unitPriceCents });

const RICH: WorkLines = {
  callout: true,
  labour: [
    L('2026-11-10', 'normal', 6, 'Spindle drive fault finding'),
    L('2026-11-10', 'overtime', 2, 'After hours testing'),
    L('2026-11-11', 'normal', 4.5, 'Replaced drive board'),
    L('2026-11-13', 'double', 3, 'Sunday commissioning'),
  ],
  travel: [T('2026-11-10', 64, 'Isando to Vereeniging, first visit'), T('2026-11-11', 64, 'Isando to Vereeniging, second visit'), T('2026-11-13', 70, 'Isando to Vereeniging via Alberton')],
  parts: [P('6SL3120-1TE21-0AA4', 'Motor module 9A', 1, 1854000), P('FUSE-10A-GG', 'Fuse 10A gG', 6, 4500)],
  additional: [{ description: 'Consumables', amountCents: 15000 }],
  discount: { amountCents: 50000, reason: 'Loyal customer' },
  photos: 5,
};

let service: FinalDocumentSource; // EJE-1044: a Service with its checklist, signed
let breakdown: FinalDocumentSource; // EJE-1054: a Breakdown, signed, with photographs
let testAndRepair: FinalDocumentSource; // EJE-1067: Test & Repair, not signed

const render = async (source: FinalDocumentSource) =>
  renderJobCardPdf({ ...source, photoImages: await photoImagesFor(source.job), letterhead: EJE_MASTER_LETTERHEAD }, 'J.pdf', GENERATED_AT).bytes;

beforeAll(async () => {
  const template = documentPhotos((await jobSource('EJE-1054')).job)[0];
  service = withWork(await jobSource('EJE-1044'), RICH, template);
  breakdown = withWork(await jobSource('EJE-1054'), {
    labour: [L('2026-11-14', 'normal', 5, 'Fault finding')],
    travel: [T('2026-11-14', 128, 'Isando to Vereeniging return')],
    parts: [P('TRF-400-110', 'Control transformer', 1, 312000)],
    photos: 2,
  }, template);
  testAndRepair = withWork(await jobSource('EJE-1067'), {
    labour: [L('2026-11-03', 'normal', 3, 'Bench test'), L('2026-11-05', 'normal', 2.5, 'Repair and soak test')],
    travel: [T('2026-11-03', 22, 'Collection'), T('2026-11-06', 22, 'Delivery')],
    parts: [P('CAP-470UF', 'DC bus capacitor', 2, 38500)],
  });
});

/** The table's rows as read back from the PDF: the text on each row, left to right, keyed by its y. */
const tableRows = (bytes: Uint8Array) => {
  const runs = textRuns(bytes);
  const header = runs.find((run) => run.value === 'Description' && runs.some((other) => other.value === 'Date' && other.page === run.page && Math.abs(other.y - run.y) < 0.5))!;
  return { runs, header };
};

describe('JOB-CARD-2 — the labour, travel and parts table', () => {
  it('has the columns Date | Description | Qty | Rate | Amount, in that order, Date first', async () => {
    const { runs, header } = tableRows(await render(service));
    const labels = runs.filter((run) => run.page === header.page && Math.abs(run.y - header.y) < 0.5).sort((a, b) => a.x - b.x).map((run) => run.value);
    expect(labels).toEqual(['Date', 'Description', 'Qty', 'Rate', 'Amount']);
  });

  it('dates every labour and travel line with the date recorded on THAT entry, and no other', async () => {
    const bytes = await render(service);
    const runs = textRuns(bytes);
    const job = service.job;
    for (const entry of [...job.labour, ...job.travel]) {
      const description = runs.find((run) => run.value.includes(entry.description))!;
      expect(description, entry.description).toBeDefined();
      const date = runs.find((run) => run.page === description.page && Math.abs(run.y - description.y) < 0.5 && run.x < description.x);
      expect(date?.value, entry.description).toBe(formatDate(entry.date as IsoDate));
    }
    // Several days for one job: each line keeps its own.
    expect(new Set(job.labour.map((entry) => entry.date)).size).toBeGreaterThan(1);
    expect(new Set(job.travel.map((entry) => entry.date)).size).toBeGreaterThan(1);
  });

  it('leaves the Date blank for parts, the call-out fee and any other charge — never an invented date', async () => {
    const runs = textRuns(await render(service));
    for (const marker of ['6SL3120-1TE21-0AA4', 'FUSE-10A-GG', 'Call-out', 'Additional charge']) {
      const row = runs.find((run) => run.value.startsWith(marker))!;
      expect(row, marker).toBeDefined();
      const left = runs.filter((run) => run.page === row.page && Math.abs(run.y - row.y) < 0.5 && run.x < row.x);
      expect(left.map((run) => run.value), marker).toEqual([]);
    }
    // And the dates printed anywhere in the table are only the recorded ones.
    const recorded = new Set([...service.job.labour, ...service.job.travel].map((entry) => formatDate(entry.date as IsoDate)));
    const dated = runs.filter((run) => /^\d{2} [A-Z][a-z]{2} \d{4}$/u.test(run.value) && run.x <= MARGIN + 1);
    for (const run of dated) expect(recorded.has(run.value), run.value).toBe(true);
  });

  it('draws no line through the header band under its labels ("Line removed")', async () => {
    const bytes = await render(service);
    const { header } = tableRows(bytes);
    // The page's own content stream — the one that draws the table's header labels.
    const streams = [...Buffer.from(bytes).toString('latin1').matchAll(/stream\r?\n([\s\S]*?)endstream/gu)].map((m) => m[1]!);
    const content = streams.find((stream) => stream.includes('(Description)') && stream.includes('(Amount)'))!;
    // Every horizontal line on it: none lies between the band's lower edge and the labels' top.
    const lines = [...content.matchAll(/([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l S/gu)].map((m) => ({ y1: Number(m[2]), y2: Number(m[4]) }));
    const through = lines.filter((line) => line.y1 === line.y2 && line.y1 > header.y - 4 && line.y1 < header.y + 8);
    expect(through).toEqual([]);
  });

  it('keeps every amount, the subtotal, the discount, VAT and the total exactly as the model calculates them', async () => {
    const text = pdfPlainText(await render(service));
    for (const figure of ['R 4 920,00', 'R 2 460,00', 'R 18 540,00', 'R 150,00', 'Subtotal after discount', 'Discount', 'Loyal customer', 'VAT @ 15%', 'Total']) {
      expect(text, figure).toContain(figure);
    }
  });

  it('repeats the column headings on every page a long table reaches', async () => {
    const long = withWork(breakdown, {
      labour: Array.from({ length: 40 }, (_, i) => L(`2026-10-${String(1 + (i % 28)).padStart(2, '0')}`, 'normal', 2, `Attendance ${i + 1}`)),
      travel: Array.from({ length: 20 }, (_, i) => T(`2026-10-${String(1 + i).padStart(2, '0')}`, 40, `Trip ${i + 1}`)),
      parts: Array.from({ length: 10 }, (_, i) => P(`PRT-${i}`, `Part ${i}`, 1, 10000)),
    });
    const runs = textRuns(await render(long));
    const tablePages = new Set(runs.filter((run) => /^(Attendance|Trip) \d+$/u.test(run.value.split(' — ')[1] ?? '') || run.value.startsWith('PRT-')).map((run) => run.page));
    expect(tablePages.size).toBeGreaterThan(1);
    for (const page of tablePages) {
      expect(runs.some((run) => run.page === page && run.value === 'Date'), `page ${page}`).toBe(true);
      expect(runs.some((run) => run.page === page && run.value === 'Amount'), `page ${page}`).toBe(true);
    }
  });
});

describe('JOB-CARD-2 — the customer and job details', () => {
  it('groups the contact person under CONTACT DETAILS, apart from the address: name, position, telephone, email', async () => {
    const runs = textRuns(await render(service)).filter((run) => run.page === 1);
    const contact = service.contact!;
    const label = runs.find((run) => run.value === 'CONTACT DETAILS')!;
    const lastAddress = runs.find((run) => run.value === `${service.site.city}, ${service.site.province} ${service.site.postalCode}`)!;
    expect(label.y).toBeLessThan(lastAddress.y);
    const below = runs.filter((run) => run.x === label.x && run.y < label.y).sort((a, b) => b.y - a.y).map((run) => run.value);
    expect(below.slice(0, 4)).toEqual([`${contact.firstName} ${contact.lastName}`.trim(), contact.position, contact.phone, contact.email]);
  });

  it('moves Machine and Job details to the right: their column ends at the right margin', async () => {
    const runs = textRuns(await render(service)).filter((run) => run.page === 1);
    const jobDetails = runs.find((run) => run.value === 'JOB DETAILS')!;
    const machine = runs.find((run) => run.value === 'MACHINE')!;
    expect(jobDetails.x).toBe(machine.x);
    expect(jobDetails.x).toBeGreaterThan(MARGIN + 515 / 2 + 20);
    expect(jobDetails.x).toBeCloseTo(RIGHT - 230, 0);
  });
});

describe('JOB-CARD-2 — WORK CARRIED OUT', () => {
  it('is a main heading, larger than the subheadings, which are bold and a little larger than the text', async () => {
    const runs = textRuns(await render(service));
    const heading = runs.find((run) => run.value === 'WORK CARRIED OUT')!;
    const sub = runs.find((run) => run.value === 'FAULT FINDINGS')!;
    const body = runs.find((run) => run.value.startsWith(service.job.completionReport.faultFindings.split(' ')[0]!) && run.y < sub.y)!;
    expect(heading.size).toBeGreaterThan(sub.size);
    expect(sub.font).toBe('bold');
    expect(sub.size).toBeLessThan(body.size + 0.01);
    expect(sub.size).toBeGreaterThan(7.5);
    expect(body.font).toBe('regular');
  });

  it('sets Fault findings and Diagnosis beside Work performed, Recommendations and General notes ("Next to each other")', async () => {
    const runs = textRuns(await render(breakdown)).filter((run) => run.page === 1);
    const at = (value: string) => runs.find((run) => run.value === value)!;
    const [findings, diagnosis, performed, recommendations, general] = ['FAULT FINDINGS', 'DIAGNOSIS', 'WORK PERFORMED', 'RECOMMENDATIONS', 'GENERAL NOTES'].map(at);
    expect(findings!.x).toBe(MARGIN);
    expect(diagnosis!.x).toBe(MARGIN);
    for (const right of [performed, recommendations, general]) expect(right!.x).toBeGreaterThan(MARGIN + 515 / 2);
    // Side by side: the right column starts level with the left one.
    expect(performed!.y).toBeCloseTo(findings!.y, 3);
  });
});

describe('JOB-CARD-2 — the acceptance, the checklist and the photographs', () => {
  it('puts the WHOLE acceptance block on the right, directly under the totals, on the same page', async () => {
    const runs = textRuns(await render(breakdown));
    const total = runs.find((run) => run.value === 'Total')!;
    const title = runs.find((run) => run.value === 'CUSTOMER ACCEPTANCE')!;
    expect(title.page).toBe(total.page);
    expect(title.y).toBeLessThan(total.y);
    expect(title.x).toBeCloseTo(RIGHT - 250, 0);
    const block = runs.filter((run) => run.page === title.page && run.y <= title.y && run.y > title.y - 140);
    for (const value of ['I confirm that the work described above has been', 'Name', 'Signed', 'Customer signature']) {
      const run = block.find((candidate) => candidate.value.startsWith(value))!;
      expect(run, value).toBeDefined();
      expect(run.x, value).toBeGreaterThanOrEqual(RIGHT - 250 - 0.01);
    }
  });

  it('keeps the totals and the acceptance together when the table ends near the foot of a page', async () => {
    for (let lines = 8; lines <= 40; lines += 2) {
      const source = withWork(breakdown, { labour: Array.from({ length: lines }, (_, i) => L('2026-11-14', 'normal', 1, `Line ${i + 1}`)), photos: 0 });
      const runs = textRuns(await render(source));
      const total = runs.find((run) => run.value === 'Total')!;
      const subtotal = runs.find((run) => run.value === 'Subtotal')!;
      const caption = runs.find((run) => run.value === 'Customer signature')!;
      expect(subtotal.page, `${lines} lines`).toBe(total.page);
      expect(caption.page, `${lines} lines`).toBe(total.page);
    }
  });

  it('prints the checklist after the acceptance, and the photographs last, from the top of a new page', async () => {
    const bytes = await render(service);
    const runs = textRuns(bytes);
    const acceptance = runs.find((run) => run.value === 'CUSTOMER ACCEPTANCE')!;
    const checklist = runs.find((run) => run.value.startsWith('PREVENTATIVE SERVICE CHECKLIST'))!;
    const photographs = runs.find((run) => run.value === 'PHOTOGRAPHS')!;
    const order = (run: { page: number; y: number }) => run.page * 10000 - run.y;
    expect(order(checklist)).toBeGreaterThan(order(acceptance));
    expect(order(photographs)).toBeGreaterThan(order(checklist));
    // A new page, nothing above the heading but the page's own top margin, and nothing else on it before.
    const lastBefore = runs.filter((run) => run.page === photographs.page && run.y > photographs.y);
    expect(lastBefore).toEqual([]);
    expect(photographs.y).toBeGreaterThan(A4_HEIGHT - 60);
    // The heading and the first photograph together: photographs are the only images on the document
    // (the letterhead is vector), and the first one drawn sits directly under the heading.
    const images = drawnImages(bytes);
    expect(images).toHaveLength(service.job.photos.length);
    const first = images[0]!;
    expect(first.y + first.height).toBeLessThan(photographs.y);
    expect(first.y + first.height).toBeGreaterThan(photographs.y - 140);
  });

  it('starts the photographs on a new page even when there is room for them on the last one', async () => {
    const bytes = await render(testAndRepair);
    expect(inspectPdf(bytes).pageCount).toBe(1); // no photographs: no photographs page
    const photographed = await render(withWork(testAndRepair, { ...{}, labour: testAndRepair.job.labour.map((entry) => ({ date: entry.date, rateType: entry.rateType, hours: entry.hours, description: entry.description })), photos: 1 }, documentPhotos(breakdown.job)[0]));
    const runs = textRuns(photographed);
    const heading = runs.find((run) => run.value === 'PHOTOGRAPHS')!;
    expect(heading.page).toBe(2);
    expect(runs.filter((run) => run.page === 2 && run.y > heading.y)).toEqual([]);
  });

  it('leaves nothing overlapping, overrunning or off the page — short, long, signed and unsigned', async () => {
    for (const source of [service, breakdown, testAndRepair]) {
      expect(inspectPdf(await render(source), { margin: MARGIN, edge: 14 }).problems).toEqual([]);
    }
  });
});

describe('JOB-CARD-2 — which layout a document is shown in', () => {
  it('a job not yet issued, or issued in the new layout, is shown in it; one issued before keeps the old', () => {
    expect(showsCurrentJobCardLayout(null)).toBe(true);
    expect(showsCurrentJobCardLayout({ renderer: JOB_CARD_LAYOUT_RENDERER })).toBe(true);
    for (const renderer of [1, 2, 3, 4, 5, null]) expect(showsCurrentJobCardLayout({ renderer })).toBe(false);
  });
});
