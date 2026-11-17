import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { asChecklistTemplateId, type ChecklistTemplate } from '@/domain';
import type { Database } from '@/db/client';
import * as schema from '@/db/schema';
import { PostgresChecklistTemplateRepository } from '@/data/postgres/checklist-template-repository';
import { IDS, seedBaseline } from '@/data/postgres/test-fixtures';
import { openTestDatabase, testDatabaseUrl, truncateAll } from '@/data/postgres/test-database';
import { hashPassword } from '@/server/auth/passwords';
import { ApiTestClient, startPostgresTestServer } from '@/test/api-harness';

/**
 * CHK-RACE-1 (17 November 2026), on PostgreSQL — where the race is real.
 *
 * Two checklist answers saved at the same moment both load the job at one version; the second write
 * found it moved on and was refused — as a 500 on production. Now the command re-runs an answer that
 * lost a race against the fresh job: every answer sent together is stored, each exactly once, and the
 * LAST answer to a single item is the one kept.
 *
 * CUST-ACCT-1 (0059), on the database itself: any number of customers without an account number; a
 * real number still belongs to one customer only.
 */
const url = testDatabaseUrl();
const describeDb = url === null ? describe.skip : describe;

const PASSWORD = 'a-real-test-password';
const MASTER = 'elmarie@example-test.co.za';
const TECHNICIAN = 'sipho@example-test.co.za';

const TEMPLATE_ID = asChecklistTemplateId('00000000-0000-4000-8000-000000000300');
const ITEMS = Array.from({ length: 8 }, (_, index) => `00000000-0000-4000-8000-0000000003${String(index + 10).padStart(2, '0')}`);

const template = (): ChecklistTemplate => ({
  id: TEMPLATE_ID,
  name: 'Service checklist',
  description: 'Planned preventative maintenance.',
  jobTypeCode: 'service',
  version: '1.0',
  status: 'current',
  sourceDocument: 'TEST CONTENT',
  updatedAt: '2026-10-01T08:00:00.000Z',
  sections: [
    {
      id: '00000000-0000-4000-8000-000000000301',
      title: 'Condition',
      description: '',
      items: ITEMS.map((id, index) => ({
        id,
        text: `Check ${index + 1}`,
        helpText: '',
        responseType: 'pass_fail_na' as const,
        required: true,
        photoRequired: false,
        unit: null,
        expectedRange: null,
      })),
    },
  ],
});

interface JobBody {
  readonly id: string;
  readonly checklist: { readonly responses: readonly { readonly itemId: string; readonly choice: string | null }[] } | null;
}

describeDb('checklist answers saved together, on PostgreSQL', () => {
  let db: Database;

  const signIn = async (email: string): Promise<ApiTestClient> => {
    const client = new ApiTestClient();
    const response = await client.signIn(email, PASSWORD);
    if (response.status !== 200) throw new Error(`sign-in failed for ${email}`);
    return client;
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
    await new PostgresChecklistTemplateRepository(db).save(template());
  });

  const startedChecklist = async () => {
    const master = await signIn(MASTER);
    const created = await master.post<JobBody>('/api/jobs', {
      customerId: IDS.customer,
      siteId: IDS.site,
      contactId: IDS.contact,
      machineId: IDS.machine,
      jobType: 'service',
      priority: 'normal',
      scheduledDate: '2026-10-20',
      scheduledEndDate: null,
      orderNumber: 'PO-91001',
      referenceNumber: '',
      faultDescription: 'Six-monthly service.',
      primaryTechnicianId: IDS.technician,
      courierCollection: false,
      deliveryNote: '',
    });
    expect(created.status).toBe(200);
    const tech = await signIn(TECHNICIAN);
    expect((await tech.post(`/api/jobs/${created.data.id}/accept`)).status).toBe(200);
    expect((await tech.post(`/api/jobs/${created.data.id}/start_checklist`)).status).toBe(200);
    return { tech, jobId: created.data.id };
  };

  it('stores every answer sent at once — none refused, none a 500', async () => {
    const { tech, jobId } = await startedChecklist();
    const responses = await Promise.all(
      ITEMS.map((itemId) => tech.post<JobBody>(`/api/jobs/${jobId}/answer_checklist`, { itemId, choice: 'pass' })),
    );
    expect(responses.map((response) => response.status)).toEqual(ITEMS.map(() => 200));
    const answers = await db.select().from(schema.checklistAnswers);
    expect(answers.filter((answer) => ITEMS.includes(answer.questionId))).toHaveLength(ITEMS.length);
    const job = (await tech.get<JobBody>(`/api/jobs/${jobId}`)).data as unknown as { view: { job: JobBody } };
    const stored = job.view.job.checklist!.responses;
    for (const itemId of ITEMS) expect(stored.find((response) => response.itemId === itemId)?.choice).toBe('pass');
  });

  it('one item changed twice in a row keeps the second answer', async () => {
    const { tech, jobId } = await startedChecklist();
    const [itemId] = ITEMS;
    // As the runner sends them: one after the other (its queue), the second a change of mind.
    expect((await tech.post(`/api/jobs/${jobId}/answer_checklist`, { itemId, choice: 'pass' })).status).toBe(200);
    expect((await tech.post(`/api/jobs/${jobId}/answer_checklist`, { itemId, choice: 'fail', notes: 'Wiper torn.' })).status).toBe(200);
    const answers = await db.select().from(schema.checklistAnswers).where(eq(schema.checklistAnswers.questionId, itemId!));
    expect(answers).toHaveLength(1);
    expect(answers[0]!.choice).toBe('fail');
  });

  it('the database lets any number of customers go without an account number, and no two share one', async () => {
    const insert = (id: string, name: string, accountNumber: string) =>
      db.execute(sql`insert into customers (id, name, account_number) values (${id}::uuid, ${name}, ${accountNumber})`);
    await insert('00000000-0000-4000-8000-000000000401', 'No number one', '');
    await insert('00000000-0000-4000-8000-000000000402', 'No number two', '');
    await insert('00000000-0000-4000-8000-000000000403', 'Numbered', 'ACC-1');
    await expect(insert('00000000-0000-4000-8000-000000000404', 'Same number', 'ACC-1')).rejects.toThrow();
  });
});
