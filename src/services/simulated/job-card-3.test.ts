import { beforeAll, describe, expect, it, vi } from 'vitest';
/*
 * The seed reads the date when it is imported, so the clock is frozen before anything else loads
 * (as the other job-card tests do).
 */
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-15T08:00:00.000Z'));
});
import { pdfPlainText } from '@/lib/pdf/inspect';
import { formatDate } from '@/lib/format';
import { businessDateOf } from '@/lib/business-time';
import { EJE_MASTER_LETTERHEAD } from '@/lib/branding/eje-letterhead';
import { buildJobCardModel } from '@/lib/job-card/model';
import { JOB_CARD_2_RENDERER, JOB_CARD_LAYOUT_RENDERER, fullWidthHeaderStyleOf, jobCardEditionOf, jobCardLayoutOf } from '@/lib/job-card/layout-version';
import { asUserId, type IsoDateTime, type Job } from '@/domain';
import { GENERATED_AT, jobSource } from '@/test/letterhead-documents';
import { withWork } from '@/test/job-card-fixtures';
import type { FinalDocumentSource } from '../ports';
import { renderJobCardPdf } from './job-card-pdf';

/**
 * JOB-CARD-3 (the owner, 17 November 2026): the machine shown by its name and number only; a Parts
 * Collection Note dated with the day it was raised and naming who released the parts; and every one
 * of these only from edition 7 — a document issued in v1.15.0 (edition 6) is drawn exactly as it was.
 */
let service: FinalDocumentSource; // EJE-1044: a Service, signed, on the Leadwell V-40
let parts: FinalDocumentSource; // EJE-1062: a Parts collection

const model = (source: FinalDocumentSource, edition?: 6 | 7) => buildJobCardModel({ ...source, generatedAt: GENERATED_AT, ...(edition === undefined ? {} : { edition }) });
const text = (source: FinalDocumentSource) =>
  pdfPlainText(renderJobCardPdf({ ...source, letterhead: EJE_MASTER_LETTERHEAD }, 'J.pdf', GENERATED_AT).bytes);
const withJob = (source: FinalDocumentSource, change: Partial<Job>): FinalDocumentSource => ({ ...source, job: { ...source.job, ...change } });

beforeAll(async () => {
  service = await jobSource('EJE-1044');
  parts = withWork(await jobSource('EJE-1062'), {
    parts: [
      { partNumber: 'FAN-24V-80', description: 'Spindle drive cooling fan', quantity: 2, unitPriceCents: 48500 },
      { partNumber: 'BRG-6204', description: 'Bearing', quantity: 4, unitPriceCents: 12000 },
    ],
  });
});

describe('which edition a document is drawn in', () => {
  it("today's for anything not yet issued; 7 and 6 as issued; the frozen V5 for everything older", () => {
    expect(jobCardLayoutOf(null)).toBe(JOB_CARD_LAYOUT_RENDERER);
    expect(jobCardLayoutOf({ renderer: 7 })).toBe(7);
    expect(jobCardLayoutOf({ renderer: 6 })).toBe(6);
    for (const renderer of [null, 1, 4, 5]) expect(jobCardLayoutOf({ renderer })).toBe('v5');
    expect(jobCardEditionOf({ renderer: 6 })).toBe(JOB_CARD_2_RENDERER);
    expect(jobCardEditionOf(null)).toBe(JOB_CARD_LAYOUT_RENDERER);
  });

  it('JOB-CARD-5: 9 for anything not yet issued or issued in it; a v1.16.1 issue (8) stays 8, its header too', () => {
    expect(JOB_CARD_LAYOUT_RENDERER).toBe(9);
    expect(jobCardLayoutOf({ renderer: 9 })).toBe(9);
    expect(jobCardLayoutOf({ renderer: 8 })).toBe(8);
    expect(jobCardEditionOf({ renderer: 8 })).toBe(8);
    expect(fullWidthHeaderStyleOf(9, false)).toBe(9);
    expect(fullWidthHeaderStyleOf(8, false)).toBe(8);
    expect(fullWidthHeaderStyleOf(7, false)).toBe(7);
    // The Installation Delivery Note keeps edition 7's header in every edition.
    for (const edition of [7, 8, 9] as const) expect(fullWidthHeaderStyleOf(edition, true)).toBe(7);
  });
});

describe('the MACHINE section of a job card', () => {
  it('shows the machine name and the machine number, and nothing else', () => {
    const { machine } = model(service, 7);
    expect(machine).not.toBeNull();
    expect(machine!.title).toBe('');
    expect(machine!.rows.map((row) => row.label)).toEqual(['Machine name', 'Machine number']);
    expect(machine!.rows[0]!.value).toBe('Leadwell V-40');
    // No number on the record: the field is there, with a dash — never invented.
    expect(machine!.rows[1]!.value).toBe('—');
    const withNumber = model(withJob(service, {}), 7);
    expect(withNumber.machine!.rows).toHaveLength(2);
  });

  it('prints them on the PDF, and not the serial number, type, control or year', () => {
    const plain = text(service);
    for (const value of ['MACHINE', 'Machine name', 'Leadwell V-40', 'Machine number']) expect(plain).toContain(value);
    // (The bare words 'Control' and 'Year' occur in the checklist's own wording; their ROWS are gone — see above.)
    for (const value of ['Serial number', 'LW-V40-70214', 'Machine type', 'CNC Milling Machine', 'Fanuc 0i-MF', '2018']) {
      expect(plain, value).not.toContain(value);
    }
  });

  it('a machine with a number of its own prints it', () => {
    const numbered = { ...service, machine: { ...service.machine!, machineNumber: 'CNC-07' } };
    expect(model(numbered, 7).machine!.rows[1]).toEqual({ label: 'Machine number', value: 'CNC-07' });
    expect(text(numbered)).toContain('CNC-07');
  });

  it('edition 6 (v1.15.0) keeps the full description it was issued with', () => {
    expect(model(service, 6).machine!.rows.map((row) => row.label)).toEqual(['Serial number', 'Machine type', 'Control', 'Year']);
    expect(model(service).machine!.title).toBe('Leadwell V-40');
  });
});

describe('a Parts Collection Note', () => {
  it('dates every part with the day the note was RAISED, from the record — not the day the PDF is drawn', () => {
    const raised = '2026-11-12T21:30:00.000Z' as IsoDateTime; // 23:30 in Johannesburg: still the 12th there
    const note = withJob(parts, { createdAt: raised });
    const rows = model(note, 7).charges!.rows.filter((row) => row.description === 'FAN-24V-80' || row.description === 'BRG-6204');
    expect(rows).toHaveLength(2);
    const day = formatDate(businessDateOf(raised)!);
    expect(day).toBe(formatDate('2026-11-12' as never));
    for (const row of rows) expect(row.date).toBe(day);
    expect(text(note)).toContain(day);
    // Drawn on another day, the same date.
    const later = buildJobCardModel({ ...note, generatedAt: '2026-12-01T10:00:00.000Z' as IsoDateTime, edition: 7 });
    expect(later.charges!.rows.find((row) => row.description === 'FAN-24V-80')!.date).toBe(day);
  });

  it('a job card leaves its parts undated, as JOB-CARD-2 did', () => {
    const card = withWork(service, { parts: [{ partNumber: 'P-1', description: 'Part', quantity: 1, unitPriceCents: 1000 }] });
    expect(model(card, 7).charges!.rows.find((row) => row.description === 'P-1')!.date).toBe('');
  });

  it('names who RELEASED the parts, not the assigned technician', () => {
    const releaser = parts.users.find((user) => user.role === 'coordinator')!;
    const note = withJob(parts, { partsReleasedBy: releaser.id, primaryTechnicianId: null });
    const details = model(note, 7).jobDetails;
    expect(details.find((row) => row.label === 'Released by')!.value).toBe(`${releaser.firstName} ${releaser.lastName}`);
    expect(details.some((row) => row.label === 'Technician')).toBe(false);
    const plain = text(note);
    expect(plain).toContain('Released by');
    expect(plain).toContain(`${releaser.firstName} ${releaser.lastName}`);
    expect(plain).not.toContain('Unassigned');
  });

  it('says "Not recorded" when nobody was recorded — never a guessed name, never "Unassigned"', () => {
    const note = withJob(parts, { partsReleasedBy: null, primaryTechnicianId: null });
    expect(model(note, 7).jobDetails.find((row) => row.label === 'Released by')!.value).toBe('Not recorded');
    const unknown = withJob(parts, { partsReleasedBy: asUserId('somebody-not-on-the-register'), primaryTechnicianId: null });
    expect(model(unknown, 7).jobDetails.find((row) => row.label === 'Released by')!.value).toBe('Not recorded');
  });

  it('edition 6 (v1.15.0) is unchanged: undated parts and the Technician row', () => {
    const note = withJob(parts, { partsReleasedBy: parts.users[0]!.id });
    const six = model(note, 6);
    expect(six.charges!.rows.filter((row) => row.description === 'FAN-24V-80').map((row) => row.date)).toEqual(['']);
    expect(six.jobDetails.some((row) => row.label === 'Technician')).toBe(true);
    expect(six.jobDetails.some((row) => row.label === 'Released by')).toBe(false);
  });
});
