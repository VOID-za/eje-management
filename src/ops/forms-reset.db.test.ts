import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from '@/db/client';
import * as schema from '@/db/schema';
import { IDS, seedBaseline } from '@/data/postgres/test-fixtures';
import { openTestDatabase, testDatabaseUrl, truncateAll } from '@/data/postgres/test-database';
import { businessToday } from '@/lib/business-time';
import { hashPassword } from '@/server/auth/passwords';
import { ApiTestClient, completeForm, startPostgresTestServer, submitForms } from '@/test/api-harness';
import { countForms, fingerprintOthers, formStorageFiles, FORM_TABLES, resetForms, ResetRefused, verifyArchive } from './forms-reset';

/**
 * FORMS-RESET-1 ON REAL POSTGRESQL. Every form table is filled the way the
 * application fills it — attendance, open and removed lines, a working comment,
 * a submission to the office with its stored PDFs and the line ledger, a
 * correction of a sent timesheet, a completed form withdrawn and its correction
 * draft, a completed form awaiting — then the reset must leave every form table
 * empty, every other table exactly as it was, an archive that decrypts to every
 * row and file, and forms that work again from nothing.
 */
const url = testDatabaseUrl();
const describeDb = url === null ? describe.skip : describe;
const PASSWORD = 'a-real-test-password';
const KEY = Buffer.alloc(32, 7);

const shift = (date: string, days: number): string => {
  const at = new Date(`${date}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};
const typed = (overtime: string, customerName = 'ABC Engineering') => ({
  pick: '', customerName, overtime, double: '0', callout: '0', internalKm: '0', customerKm: '0',
});

describeDb('the attendance and timesheet reset (FORMS-RESET-1)', () => {
  let db: Database;
  let storage: string;
  let archives: string;
  const signIn = async (email: string): Promise<ApiTestClient> => {
    const client = new ApiTestClient();
    const response = await client.signIn(email, PASSWORD);
    if (response.status !== 200) throw new Error(`sign-in failed for ${email}`);
    return client;
  };

  /** Every kind of form record there is, through the API. */
  const fillEveryForm = async (): Promise<void> => {
    const today = businessToday();
    const tech = await signIn('sipho@example-test.co.za');
    const office = await signIn('christene@example-test.co.za');
    for (const days of [-9, -8, -7, -2]) {
      expect((await tech.post('/api/attendance', { userId: IDS.technician, date: shift(today, days), status: 'present', note: '' })).status).toBe(200);
    }
    expect((await office.post('/api/attendance', { userId: IDS.coordinator, date: shift(today, -2), status: 'present', note: '' })).status).toBe(200);
    // A submission to the office: period, payroll submission, stored PDFs, the line ledger, a notification.
    const sentLine = await tech.post<{ entry: { id: string } }>(`/api/timesheets/${IDS.technician}/entries`, { date: shift(today, -8), customerName: 'ABC Engineering', overtimeHours: 2, doubleHours: 0 });
    expect(sentLine.status, JSON.stringify(sentLine.error)).toBe(200);
    const sent = await submitForms(tech, IDS.technician, shift(today, -9), shift(today, -7));
    expect(sent.status, JSON.stringify(sent.error)).toBe(200);
    // A correction of that sent timesheet, waiting for the office.
    const asked = await tech.post(`/api/timesheets/${IDS.technician}/period/corrections`, {
      from: shift(today, -9), to: shift(today, -7), reason: 'OT was 3', comment: '',
      lines: [{ entryId: sentLine.data.entry.id, date: shift(today, -8), customerName: 'ABC Engineering', overtimeHours: 3, doubleHours: 0 }],
    });
    expect(asked.status, JSON.stringify(asked.error)).toBe(200);
    // Open lines, one removed, a working comment.
    for (const name of ['Open one', 'Open two']) {
      expect((await tech.post(`/api/timesheets/${IDS.technician}/lines`, { id: crypto.randomUUID(), date: shift(today, -2), typed: typed('1', name), expectedRevision: null })).status).toBe(200);
    }
    const removed = crypto.randomUUID();
    expect((await tech.post(`/api/timesheets/${IDS.technician}/lines`, { id: removed, date: shift(today, -2), typed: typed('1', 'Gone'), expectedRevision: null })).status).toBe(200);
    expect((await tech.post(`/api/timesheets/${IDS.technician}/lines/${removed}/remove`, {})).status).toBe(200);
    expect((await tech.post(`/api/timesheets/${IDS.technician}/working/comment`, { comment: 'Working on it.' })).status).toBe(200);
    // A completed attendance withdrawn (its correction draft opens), and a completed timesheet awaiting.
    const done = await completeForm<{ id: string }>(tech, IDS.technician, 'attendance', shift(today, -3), shift(today, -1));
    expect(done.status, JSON.stringify(done.error)).toBe(200);
    expect((await tech.post(`/api/payroll/forms/${IDS.technician}/withdraw`, { completionId: done.data.id })).status).toBe(200);
    // Its correction, completed for the same dates: a completion that `corrects_id` the withdrawn one.
    const corrected = await completeForm(tech, IDS.technician, 'attendance', shift(today, -3), shift(today, -1));
    expect(corrected.status, JSON.stringify(corrected.error)).toBe(200);
    expect((await completeForm(tech, IDS.technician, 'timesheet', shift(today, -3), shift(today, -1))).status).toBe(200);
    // A name given to the next working PDF.
    const renamed = await tech.post(`/api/payroll/forms/${IDS.technician}/rename`, { kind: 'attendance', name: 'Sipho next.pdf' });
    expect(renamed.status, JSON.stringify(renamed.error)).toBe(200);
    // A monthly submission (PAY-02, retired by PAYROLL-ONE-1 but held by production), an old daily comment (0033)
    // and a legacy month (0037), as an old database holds them.
    // A notification that is not about a form, which must stay.
    await db.insert(schema.notifications).values({ id: crypto.randomUUID(), recipientId: IDS.technician, type: 'job_assigned', title: 'EJE-1001 assigned to you', channels: ['in_app'] });
    await db.insert(schema.monthlySubmissions).values({ id: crypto.randomUUID(), userId: IDS.coordinator, month: '2026-01', timesheetPeriodId: null, attendanceSnapshot: { days: [] }, submittedAt: new Date().toISOString(), submittedBy: IDS.coordinator });
    await db.insert(schema.timesheetComments).values({ id: crypto.randomUUID(), userId: IDS.otherTechnician, workDate: shift(today, -30), comment: 'Old.', updatedBy: IDS.otherTechnician, commentedAt: new Date().toISOString() });
    await db.insert(schema.timesheetMonths).values({ id: crypto.randomUUID(), userId: IDS.otherTechnician, month: '2026-01', comment: '', updatedBy: IDS.otherTechnician, commentedAt: new Date().toISOString() });
  };

  beforeAll(async () => {
    db = await openTestDatabase(url ?? '');
  });
  afterAll(async () => {
    await db.$client.end({ timeout: 5 });
  });
  beforeEach(async () => {
    storage = mkdtempSync(join(tmpdir(), 'eje-reset-storage-'));
    archives = mkdtempSync(join(tmpdir(), 'eje-reset-archive-'));
    process.env.EJE_STORAGE_DIR = storage;
    await truncateAll(db);
    await seedBaseline(db);
    await db.update(schema.users).set({ passwordHash: await hashPassword(PASSWORD) });
    startPostgresTestServer(url ?? '');
  });

  it('clears every form table and only those, archives every row and stored PDF, and forms work again from nothing', async () => {
    await fillEveryForm();
    const client = db.$client;
    const before = await countForms(client);
    // Every form table holds rows (a line draft only exists while a line is half-typed in a browser).
    for (const table of FORM_TABLES.filter((name) => name !== 'timesheet_line_drafts')) {
      expect(before[table], table).toBeGreaterThan(0);
    }
    expect((await db.select().from(schema.payrollFormCompletions)).some((form) => form.correctsId !== null)).toBe(true);
    expect(before['notifications (form)']).toBeGreaterThan(0);
    const files = formStorageFiles(storage);
    expect(files.length).toBeGreaterThanOrEqual(4);
    const others = await fingerprintOthers(client);
    const users = await db.select().from(schema.users);
    const jobNotices = await db.select().from(schema.notifications).where(sql`type not in ('timesheet_submitted', 'timesheet_correction_requested', 'timesheet_correction_decided')`);
    const audits = (await db.select().from(schema.auditEvents)).length;

    // A dry run proves everything and changes nothing.
    const dry = await resetForms(client, { archiveRoot: archives, storageRoot: storage, key: KEY, dryRun: true, expect: before });
    expect(dry.after).toEqual(Object.fromEntries(Object.keys(before).map((key) => [key, 0])));
    expect(await countForms(client)).toEqual(before);
    expect(formStorageFiles(storage)).toEqual(files);
    expect(readdirSync(archives)).toEqual([]);

    const result = await resetForms(client, { archiveRoot: archives, storageRoot: storage, key: KEY, dryRun: false, expect: before });
    expect(result.before).toEqual(before);
    expect(Object.values(await countForms(client)).every((count) => count === 0)).toBe(true);
    expect(result.filesRemoved).toBe(files.length);
    expect(formStorageFiles(storage)).toEqual([]);
    // Everything else exactly as it was: users, their settings, job notifications, the audit trail (only the reset's own reads).
    const { audit_events: auditBefore, ...othersKept } = others;
    const { audit_events: auditAfter, ...othersNow } = await fingerprintOthers(client);
    expect(othersNow).toEqual(othersKept);
    expect(auditAfter).not.toBe(auditBefore);
    expect(await db.select().from(schema.users)).toEqual(users);
    expect(await db.select().from(schema.notifications)).toEqual(jobNotices);
    // The audit trail: every earlier event kept, and one more — the reset itself.
    const trail = await db.select().from(schema.auditEvents);
    expect(trail.length).toBe(audits + 1);
    expect(trail.filter((event) => event.type === 'forms_reset')).toHaveLength(1);
    // The archive: no plaintext beside it; it decrypts to every row and file.
    const archiveDir = readdirSync(archives).map((name) => join(archives, name))[0]!;
    expect(readdirSync(archiveDir).sort()).toEqual([`${result.archive.split(/[\\/]/u).pop()}`, 'report.json'].sort());
    const manifest = await verifyArchive(result.archive, KEY);
    expect(manifest.counts).toEqual(Object.fromEntries(Object.entries(before).filter(([key]) => key !== 'finance_packages')));
    expect(Object.keys(manifest.files).map((file) => file.replace(/^storage\//u, ''))).toEqual(files);
    expect(manifest.auditCopied).toBeGreaterThan(0);
    await expect(verifyArchive(result.archive, Buffer.alloc(32, 8))).rejects.toThrow();
    // The guards are back: a submitted record cannot be deleted again by the application's rules.
    const [guard] = await client<{ enabled: string }[]>`select tgenabled::text as enabled from pg_trigger where tgname = 'payroll_submissions_guard'`;
    expect(guard?.enabled).toBe('O');

    // Forms work again from nothing: attendance, a line, completed, submitted to the office, in History.
    const today = businessToday();
    const tech = await signIn('sipho@example-test.co.za');
    expect((await tech.post('/api/attendance', { userId: IDS.technician, date: shift(today, -9), status: 'present', note: '' })).status).toBe(200);
    expect((await tech.post(`/api/timesheets/${IDS.technician}/lines`, { id: crypto.randomUUID(), date: shift(today, -8), typed: typed('2', 'Fresh'), expectedRevision: null })).status).toBe(200);
    const again = await submitForms(tech, IDS.technician, shift(today, -9), shift(today, -7));
    expect(again.status, JSON.stringify(again.error)).toBe(200);
    expect(await db.select().from(schema.payrollSubmissions)).toHaveLength(1);
    expect(await db.select().from(schema.timesheetSubmittedLines)).toHaveLength(1);
  });

  it('refuses, changing nothing, when the forms differ from the counts the operator expected', async () => {
    await fillEveryForm();
    const before = await countForms(db.$client);
    await expect(resetForms(db.$client, { archiveRoot: archives, storageRoot: storage, key: KEY, dryRun: false, expect: { ...before, attendance: (before.attendance ?? 0) - 1 } })).rejects.toThrow(ResetRefused);
    expect(await countForms(db.$client)).toEqual(before);
    expect(readdirSync(archives)).toEqual([]);
  });

  it('refuses while a Finance package exists — a payroll record that is the owner\'s to delete, not this tool\'s', async () => {
    await fillEveryForm();
    await db.insert(schema.financePackages).values({
      id: crypto.randomUUID(), month: '2026-01', status: 'prepared', recipient: 'x@example.test', manifest: [], attachmentCount: 1, totalBytes: 10,
      preparedBy: IDS.master, preparedAt: new Date().toISOString(),
    });
    const before = await countForms(db.$client);
    await expect(resetForms(db.$client, { archiveRoot: archives, storageRoot: storage, key: KEY, dryRun: false })).rejects.toThrow(/Finance package/u);
    expect(await countForms(db.$client)).toEqual(before);
    expect(existsSync(join(storage, 'payroll-submissions'))).toBe(true);
  });

  it('a delete that fails rolls everything back — rows, guard triggers, stored PDFs — and an executed run keeps the archive it wrote', async () => {
    await fillEveryForm();
    // Something outside the forms that references a form row: the foreign key, still enforced, refuses the delete.
    await db.execute(sql`create table reset_probe (attendance_id uuid references attendance(id))`);
    try {
      await db.execute(sql`insert into reset_probe select id from attendance limit 1`);
      const before = await countForms(db.$client);
      const files = formStorageFiles(storage);
      await expect(resetForms(db.$client, { archiveRoot: archives, storageRoot: storage, key: KEY, dryRun: false, expect: before })).rejects.toThrow(/reset_probe|foreign key/u);
      expect(await countForms(db.$client)).toEqual(before);
      expect(formStorageFiles(storage)).toEqual(files);
      const [guard] = await db.$client<{ enabled: string }[]>`select tgenabled::text as enabled from pg_trigger where tgname = 'payroll_form_completions_guard'`;
      expect(guard?.enabled).toBe('O');
      const kept = readdirSync(archives);
      expect(kept).toHaveLength(1);
      expect(readdirSync(join(archives, kept[0]!)).filter((file) => file.endsWith('.tar.enc'))).toHaveLength(1);
    } finally {
      await db.execute(sql`drop table reset_probe`);
    }
  });

  it('refuses when a stored form PDF a row names is missing, changing nothing', async () => {
    await fillEveryForm();
    const [form] = await db.select().from(schema.payrollFormCompletions).where(eq(schema.payrollFormCompletions.kind, 'timesheet'));
    rmSync(join(storage, `${(form!.document as { storageKey: string }).storageKey}.bin`));
    const before = await countForms(db.$client);
    await expect(resetForms(db.$client, { archiveRoot: archives, storageRoot: storage, key: KEY, dryRun: false })).rejects.toThrow(/missing/u);
    expect(await countForms(db.$client)).toEqual(before);
  });
});
