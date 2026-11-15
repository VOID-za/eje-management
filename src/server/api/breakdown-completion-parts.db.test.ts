import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import type { Database } from '@/db/client';
import * as schema from '@/db/schema';
import type { Job } from '@/domain';
import { IDS, seedBaseline } from '@/data/postgres/test-fixtures';
import { openTestDatabase, testDatabaseUrl, truncateAll } from '@/data/postgres/test-database';
import { hashPassword } from '@/server/auth/passwords';
import { ApiTestClient, startPostgresTestServer } from '@/test/api-harness';

/**
 * BD-PARTS-1 on PostgreSQL (the owner, 15 November 2026): a Breakdown's parts added, changed and removed in
 * completion are the ROWS in `job_parts` — not just what an answer said — and survive a fresh read; once the
 * customer is shown the job card the rows do not move; and concurrent additions are kept or refused by the job's
 * version, never lost (the optimistic lock in `job-repository.ts`, exercised here on the real database).
 */

const url = testDatabaseUrl();
const describeDb = url === null ? describe.skip : describe;

const PASSWORD = 'a-real-test-password';
const MASTER = 'elmarie@example-test.co.za';
const TECHNICIAN = 'sipho@example-test.co.za';

const part = (partNumber: string, quantity: number, unitPrice: number) => ({ partNumber, description: `${partNumber} part`, quantity, unitPrice });

describeDb('BD-PARTS-1 — a Breakdown’s parts in completion, on PostgreSQL', () => {
  let db: Database;

  const signIn = async (email: string): Promise<ApiTestClient> => {
    const client = new ApiTestClient();
    const response = await client.signIn(email, PASSWORD);
    if (response.status !== 200) throw new Error(`sign-in failed for ${email}`);
    return client;
  };

  /** The `job_parts` rows for a job, as stored. */
  const rows = async (jobId: string) =>
    (await db.select().from(schema.jobParts).where(eq(schema.jobParts.jobId, jobId)).orderBy(asc(schema.jobParts.capturedAt), asc(schema.jobParts.partNumber)))
      .map((row) => [row.partNumber, row.quantity, row.unitPriceCents]);
  const statusOf = async (jobId: string) => (await db.select({ status: schema.jobs.status }).from(schema.jobs).where(eq(schema.jobs.id, jobId)))[0]?.status;

  /** A Breakdown accepted by the technician, with labour, one part and a write-up, moved into `completion`. */
  const inCompletion = async (): Promise<{ tech: ApiTestClient; master: ApiTestClient; id: string }> => {
    const master = await signIn(MASTER);
    const created = await master.post<Job>('/api/jobs', {
      customerId: IDS.customer, siteId: IDS.site, contactId: IDS.contact, machineId: IDS.machine,
      jobType: 'breakdown', priority: 'urgent', scheduledDate: null, scheduledEndDate: null,
      orderNumber: 'PO-BD-DB', referenceNumber: '', faultDescription: 'Spindle drive alarm 9.',
      primaryTechnicianId: IDS.technician, courierCollection: false, deliveryNote: '',
    });
    expect(created.status, JSON.stringify(created.error)).toBe(200);
    const id = created.data.id;
    const tech = await signIn(TECHNICIAN);
    expect((await tech.post(`/api/jobs/${id}/accept`)).status).toBe(200);
    expect((await tech.post(`/api/jobs/${id}/add_labour`, { date: '2026-11-14', rateType: 'normal', hours: 2, description: 'Fault found.' })).status).toBe(200);
    expect((await tech.post(`/api/jobs/${id}/add_part`, part('BRG-6205', 1, 9_500))).status).toBe(200);
    expect((await tech.post(`/api/jobs/${id}/save_report`, {
      faultFindings: 'Bearing collapsed.', diagnosis: 'Worn bearing.', workPerformed: 'Replaced the bearing.', recommendations: '', generalNotes: '',
    })).status).toBe(200);
    const started = await tech.post(`/api/jobs/${id}/start_completion`);
    expect(started.status, JSON.stringify(started.error)).toBe(200);
    expect(await statusOf(id)).toBe('completion');
    return { tech, master, id };
  };

  beforeAll(async () => {
    db = await openTestDatabase(url ?? '');
    startPostgresTestServer(url ?? '');
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await truncateAll(db);
    await seedBaseline(db);
    await db.update(schema.users).set({ passwordHash: await hashPassword(PASSWORD) });
    startPostgresTestServer(url ?? '');
  });

  it('add, change and remove in completion are the stored rows; the job stays in completion', async () => {
    const { tech, id } = await inCompletion();
    expect((await tech.post(`/api/jobs/${id}/add_part`, part('FUSE-10A', 2, 1_200))).status).toBe(200);
    const relay = await tech.post<Job>(`/api/jobs/${id}/add_part`, part('RLY-24V', 1, 4_300));
    expect(relay.status).toBe(200);
    const relayId = relay.data.parts.find((line) => line.partNumber === 'RLY-24V')!.id;
    expect((await tech.post(`/api/jobs/${id}/update_part`, { lineId: relayId, ...part('RLY-24V', 3, 4_300) })).status).toBe(200);
    const fuseId = relay.data.parts.find((line) => line.partNumber === 'FUSE-10A')!.id;
    expect((await tech.post(`/api/jobs/${id}/remove_line`, { kind: 'part', lineId: fuseId })).status).toBe(200);

    expect(await statusOf(id)).toBe('completion');
    expect(await rows(id)).toEqual([['BRG-6205', 1, 9_500], ['RLY-24V', 3, 4_300]]);
    const audited = await db.select({ type: schema.auditEvents.type, summary: schema.auditEvents.summary }).from(schema.auditEvents).where(eq(schema.auditEvents.jobId, id));
    expect(audited.filter((event) => event.summary === 'Part captured: FUSE-10A' || event.summary === 'Part captured: RLY-24V')).toHaveLength(2);
    expect(audited.some((event) => event.summary === 'Part amended: RLY-24V')).toBe(true);
    expect(audited.filter((event) => event.type === 'line_item_removed')).toHaveLength(1);
  });

  it('once the customer is shown the job card, the rows do not move — for the technician or the office', async () => {
    const { tech, master, id } = await inCompletion();
    expect((await tech.post(`/api/jobs/${id}/start_signature`)).status).toBe(200);
    const before = await rows(id);
    const [lineId] = (await db.select({ id: schema.jobParts.id }).from(schema.jobParts).where(eq(schema.jobParts.jobId, id))).map((row) => row.id);
    for (const client of [tech, master]) {
      expect((await client.post(`/api/jobs/${id}/add_part`, part('LATE', 1, 1))).status).toBe(422);
      expect((await client.post(`/api/jobs/${id}/update_part`, { lineId, ...part('BRG-6205', 9, 1) })).status).toBe(422);
      expect((await client.post(`/api/jobs/${id}/remove_line`, { kind: 'part', lineId })).status).toBe(422);
    }
    expect(await rows(id)).toEqual(before);
  });

  it('four additions sent at once: every accepted one is a row, every other one was refused — none lost, none duplicated', async () => {
    const { tech, id } = await inCompletion();
    const numbers = ['CON-A', 'CON-B', 'CON-C', 'CON-D'];
    const answers = await Promise.all(numbers.map((number) => tech.post(`/api/jobs/${id}/add_part`, part(number, 1, 100))));
    for (const answer of answers) expect([200, 409, 422]).toContain(answer.status);
    const accepted = numbers.filter((_, index) => answers[index]!.status === 200);
    expect(accepted.length).toBeGreaterThanOrEqual(1);
    const stored = (await rows(id)).map(([number]) => number).filter((number) => numbers.includes(number as string));
    expect([...stored].sort()).toEqual([...accepted].sort());
  });
});
