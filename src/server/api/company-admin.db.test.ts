import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Database } from '@/db/client';
import * as schema from '@/db/schema';
import type { Job, SystemSettings } from '@/domain';
import { IDS, seedBaseline } from '@/data/postgres/test-fixtures';
import { openTestDatabase, testDatabaseUrl, truncateAll } from '@/data/postgres/test-database';
import { hashPassword } from '@/server/auth/passwords';
import { ApiTestClient, startPostgresTestServer } from '@/test/api-harness';

/**
 * COMPANY ADMINISTRATION AND PER-COMPANY RATES, ON POSTGRESQL. MULTI-CO-1,
 * stage B. The demonstration half is `multi-company-api.test.ts`.
 *
 * Through the real routes and the real transaction: a WD Hearn JHB job is
 * numbered from its own counter and priced at its own company's rates; saving
 * EJE writes the legacy settings row (which the release before companies
 * reads); the numbering rules refuse with a sentence rather than a database
 * exception; a technician is refused; and a company stays on a customer while
 * it has work there.
 *
 * Run with `npm run db:test`. Skipped where there is no `TEST_DATABASE_URL`.
 */
const url = testDatabaseUrl();
const describeDb = url === null ? describe.skip : describe;

const PASSWORD = 'a-real-test-password';

const WDJ_RATES = {
  labourRates: { normal: 111_100, overtime: 166_600, double: 222_200 },
  calloutRate: 99_900,
  testBenchFee: 12_300,
  kilometreRate: 2_100,
  vatPercentage: 15,
};

const jobBody = (companyId?: string) => ({
  ...(companyId === undefined ? {} : { companyId }),
  customerId: IDS.customer,
  siteId: IDS.site,
  contactId: IDS.contact,
  machineId: IDS.machine,
  jobType: 'breakdown',
  priority: 'normal',
  scheduledDate: null,
  scheduledEndDate: null,
  orderNumber: '',
  referenceNumber: '',
  faultDescription: 'Spindle will not start.',
  primaryTechnicianId: null,
  additionalTechnicianIds: [],
  courierCollection: false,
  deliveryNote: '',
});

describeDb('company administration and per-company rates, on PostgreSQL', () => {
  let db: Database;
  let master: ApiTestClient;

  const signIn = async (email: string): Promise<ApiTestClient> => {
    const client = new ApiTestClient();
    const response = await client.signIn(email, PASSWORD);
    if (response.status !== 200) throw new Error(`sign-in failed for ${email}`);
    return client;
  };

  /** The customer's editable fields as stored, with the companies given. */
  const customerUpdate = async (companyIds: readonly string[]) => {
    const detail = await master.get<{
      customer: {
        name: string;
        accountNumber: string;
        registrationNumber: string;
        vatNumber: string;
        phone: string;
        industry: string;
        paymentTerms: string;
      };
    }>(`/api/customers/${IDS.customer}`);
    const { name, accountNumber, registrationNumber, vatNumber, phone, industry, paymentTerms } = detail.data.customer;
    return master.post(`/api/customers/${IDS.customer}/update`, {
      name, accountNumber, registrationNumber, vatNumber, phone, industry, paymentTerms, companyIds,
    });
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
    master = await signIn('elmarie@example-test.co.za');
  });

  it('prices a WD Hearn JHB job at WD Hearn JHB’s rates and an EJE job at EJE’s', async () => {
    const saved = await master.send('PATCH', '/api/admin/companies/wd-hearn-jhb', { body: { rates: WDJ_RATES } });
    expect(saved.status, JSON.stringify(saved.error)).toBe(200);
    expect((await customerUpdate(['eje', 'wd-hearn-jhb'])).status).toBe(200);

    const wd = await master.post<Job>('/api/jobs', jobBody('wd-hearn-jhb'));
    expect(wd.status, JSON.stringify(wd.error)).toBe(200);
    expect(wd.data.jobNumber).toBe('WDJ-0001');
    const eje = await master.post<Job>('/api/jobs', jobBody());
    expect(eje.data.companyId).toBe('eje');

    type Screen = { view: { settings: SystemSettings; company: { id: string; name: string } } };
    const wdScreen = await master.get<Screen>(`/api/jobs/${wd.data.jobNumber}`);
    expect(wdScreen.data.view.company).toMatchObject({ id: 'wd-hearn-jhb', name: 'WD Hearn JHB' });
    expect(wdScreen.data.view.settings.labourRates).toEqual(WDJ_RATES.labourRates);
    expect(wdScreen.data.view.settings.calloutRate).toBe(WDJ_RATES.calloutRate);
    const ejeScreen = await master.get<Screen>(`/api/jobs/${eje.data.jobNumber}`);
    expect(ejeScreen.data.view.settings.labourRates).toEqual({ normal: 95000, overtime: 142500, double: 190000 });

    // The company stays on the customer now that it has work there.
    const removed = await customerUpdate(['eje']);
    expect(removed.status).toBe(422);
    expect(removed.error?.violations[0]?.code).toBe('customer_company_in_use');
  });

  it('writes EJE’s details and rates into the settings row the release before companies reads, and audits it', async () => {
    const saved = await master.send('PATCH', '/api/admin/companies/eje', {
      body: { details: { phone: '+27 11 555 0100', fax: '+27 11 555 0101' }, rates: WDJ_RATES },
    });
    expect(saved.status, JSON.stringify(saved.error)).toBe(200);
    const [row] = await db.execute<{ company_phone: string; labour_normal_cents: string | number }>(
      sql`select company_phone, labour_normal_cents from system_settings where id = 1`,
    );
    expect(row?.company_phone).toBe('+27 11 555 0100');
    expect(Number(row?.labour_normal_cents)).toBe(WDJ_RATES.labourRates.normal);
    const [company] = await db.execute<{ fax: string }>(sql`select fax from companies where id = 'eje'`);
    expect(company?.fax).toBe('+27 11 555 0101');

    const activity = await master.get<{ events: readonly { summary: string; actorId: string; changes: readonly { field: string }[] }[] }>(
      '/api/activity',
    );
    const event = activity.data.events.find((candidate) => candidate.summary.includes('company details updated'));
    expect(event?.actorId).toBe(IDS.master);
    expect(event?.changes.map((change) => change.field)).toEqual(
      expect.arrayContaining(['company.eje.phone', 'company.eje.fax', 'company.eje.labourNormal']),
    );
  });

  it('refuses an overlapping prefix and a start that would rewind an active sequence, as sentences', async () => {
    const overlap = await master.send('PATCH', '/api/admin/companies/wd-hearn-jhb', {
      body: { numbering: { jobNumberPrefix: 'EJE-' } },
    });
    expect(overlap.status).toBe(422);
    expect(overlap.error?.violations[0]?.code).toBe('job_number_prefix_conflict');

    expect((await customerUpdate(['eje', 'wd-hearn-jhb'])).status).toBe(200);
    expect((await master.post('/api/jobs', jobBody('wd-hearn-jhb'))).status).toBe(200);
    const rewind = await master.send('PATCH', '/api/admin/companies/wd-hearn-jhb', {
      body: { numbering: { jobNumberStart: 1 } },
    });
    // Unchanged: nothing to refuse.
    expect(rewind.status).toBe(200);
    expect(
      (await master.send('PATCH', '/api/admin/companies/wd-hearn-jhb', { body: { numbering: { jobNumberStart: 40 } } })).status,
    ).toBe(200);
    const back = await master.send('PATCH', '/api/admin/companies/wd-hearn-jhb', {
      body: { numbering: { jobNumberStart: 10 } },
    });
    expect(back.status).toBe(422);
    expect(back.error?.violations[0]?.code).toBe('job_number_start_invalid');
    const next = await master.post<Job>('/api/jobs', jobBody('wd-hearn-jhb'));
    expect(next.data.jobNumber).toBe('WDJ-0040');
  });

  it('refuses a technician', async () => {
    const technician = await signIn('sipho@example-test.co.za');
    expect((await technician.get('/api/admin/companies')).status).toBe(403);
    const refused = await technician.send('PATCH', '/api/admin/companies/wd-hearn-jhb', {
      body: { rates: WDJ_RATES },
    });
    expect(refused.status).toBe(403);
    const [row] = await db.execute<{ labour_normal_cents: string | number }>(
      sql`select labour_normal_cents from companies where id = 'wd-hearn-jhb'`,
    );
    expect(Number(row?.labour_normal_cents)).not.toBe(WDJ_RATES.labourRates.normal);
  });
});
