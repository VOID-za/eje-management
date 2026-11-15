import { beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '@/domain';
import { DEMO_USERS, signedInAs, startTestServer, type ApiTestClient } from '@/test/api-harness';

/**
 * MULTI-CO-1, STAGE B, OVER HTTP: the routes a browser — or anybody with a
 * session cookie — reaches. Raising a job for a company, the job's company on
 * its screen, the customer register's company filter and links, and the
 * company administration routes with their permission, rules and audit.
 */
const MIDRAND = {
  customerId: 'cust-midrand',
  siteId: 'site-midrand-main',
  contactId: 'contact-midrand-main',
  machineId: 'machine-midrand-press',
};
const ABC = {
  customerId: 'cust-abc',
  siteId: 'site-abc-jhb',
  contactId: 'contact-abc-jhb',
  machineId: 'machine-abc-lv40',
};

const body = (register: typeof MIDRAND, over: Record<string, unknown> = {}) => ({
  ...register,
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
  ...over,
});

interface CompanyRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly jobNumberPrefix: string;
  readonly jobNumberStart: number;
  readonly nextJobSequence: number;
}

describe('raising a job for a company over HTTP', () => {
  let master: ApiTestClient;
  beforeEach(async () => {
    startTestServer();
    master = await signedInAs(DEMO_USERS.master);
  });

  it('numbers a WD Hearn JHB job WDJ-0001, and the job screen names its company', async () => {
    const created = await master.post<Job>('/api/jobs', body(MIDRAND, { companyId: 'wd-hearn-jhb' }));
    expect(created.status, JSON.stringify(created.error)).toBe(200);
    expect(created.data.jobNumber).toBe('WDJ-0001');
    expect(created.data.companyId).toBe('wd-hearn-jhb');

    const screen = await master.get<{ view: { job: Job; company: { id: string; code: string; name: string } } }>(
      `/api/jobs/${created.data.jobNumber}`,
    );
    expect(screen.status).toBe(200);
    expect(screen.data.view.job.companyId).toBe('wd-hearn-jhb');
    expect(screen.data.view.company).toMatchObject({ id: 'wd-hearn-jhb', code: 'WDJ', name: 'WD Hearn JHB' });
    // Never a way in: the letterhead's storage key is not part of a job screen.
    expect(JSON.stringify(screen.data.view.company)).not.toContain('letterhead');
  });

  it('is EJE when the client says nothing, exactly as before', async () => {
    const created = await master.post<Job>('/api/jobs', body(MIDRAND));
    expect(created.status, JSON.stringify(created.error)).toBe(200);
    expect(created.data.companyId).toBe('eje');
    expect(created.data.jobNumber.startsWith('EJE-')).toBe(true);
  });

  it('refuses a customer that is not the company’s, and a company nobody knows', async () => {
    const refused = await master.post('/api/jobs', body(ABC, { companyId: 'wd-hearn-jhb' }));
    expect(refused.status).toBe(422);
    expect(refused.error?.violations[0]?.code).toBe('customer_not_of_company');
    const unknown = await master.post('/api/jobs', body(MIDRAND, { companyId: 'nobody' }));
    expect(unknown.status).toBe(422);
    expect(unknown.error?.violations[0]?.code).toBe('unknown_company');
  });

  it('offers the companies and each customer’s companies on the New Job form', async () => {
    const form = await master.get<{
      companies: readonly { id: string; code: string; name: string; jobNumberPrefix: string }[];
      customers: readonly { id: string; companyIds: readonly string[] }[];
    }>('/api/jobs/form');
    expect(form.status).toBe(200);
    expect(form.data.companies.map((company) => [company.id, company.code, company.jobNumberPrefix])).toEqual([
      ['eje', 'EJE', 'EJE-'],
      ['wd-hearn-jhb', 'WDJ', 'WDJ-'],
    ]);
    expect(JSON.stringify(form.data.companies)).not.toContain('rates');
    expect(form.data.customers.find((customer) => customer.id === 'cust-midrand')?.companyIds).toEqual([
      'eje',
      'wd-hearn-jhb',
    ]);
  });
});

describe('the customer register’s companies over HTTP', () => {
  let master: ApiTestClient;
  beforeEach(async () => {
    startTestServer();
    master = await signedInAs(DEMO_USERS.master);
  });

  it('lists each customer’s companies, and filters by one', async () => {
    const all = await master.get<readonly { id: string; companyIds: readonly string[] }[]>('/api/customers');
    expect(all.data.find((row) => row.id === 'cust-abc')?.companyIds).toEqual(['eje']);
    const wd = await master.get<readonly { id: string }[]>('/api/customers?company=wd-hearn-jhb');
    expect(wd.data.map((row) => row.id)).toEqual(['cust-midrand']);
    expect((await master.get<readonly unknown[]>('/api/customers?company=eje')).data.length).toBe(all.data.length);
  });

  it('creates a customer for the companies chosen, EJE when none is sent, and refuses an unknown one', async () => {
    const customer = (name: string, over: Record<string, unknown> = {}) => ({
      name,
      accountNumber: '',
      registrationNumber: '',
      vatNumber: '',
      phone: '',
      industry: '',
      paymentTerms: '',
      site: { name: 'Main', addressLine1: '1 Main Road', addressLine2: '', city: 'Midrand', province: 'Gauteng', postalCode: '1685', accessNotes: '' },
      contact: null,
      ...over,
    });
    const both = await master.post<{ customer: { companyIds: readonly string[] } }>(
      '/api/customers',
      customer('Both Co', { companyIds: ['wd-hearn-jhb', 'eje'] }),
    );
    expect(both.status, JSON.stringify(both.error)).toBe(200);
    expect(both.data.customer.companyIds).toEqual(['wd-hearn-jhb', 'eje']);
    const plain = await master.post<{ customer: { companyIds: readonly string[] } }>('/api/customers', customer('Plain Co'));
    expect(plain.data.customer.companyIds).toEqual(['eje']);
    const none = await master.post('/api/customers', customer('None Co', { companyIds: [] }));
    expect(none.error?.violations[0]?.code).toBe('customer_company_required');
    const unknown = await master.post('/api/customers', customer('Odd Co', { companyIds: ['nobody'] }));
    expect(unknown.error?.violations[0]?.code).toBe('unknown_company');
  });

  it('refuses taking WD Hearn JHB off a customer with a WD Hearn JHB job', async () => {
    expect((await master.post('/api/jobs', body(MIDRAND, { companyId: 'wd-hearn-jhb' }))).status).toBe(200);
    const detail = await master.get<{ customer: { name: string; accountNumber: string; registrationNumber: string; vatNumber: string; phone: string; industry: string; paymentTerms: string } }>(
      '/api/customers/cust-midrand',
    );
    const { name, accountNumber, registrationNumber, vatNumber, phone, industry, paymentTerms } = detail.data.customer;
    const refused = await master.post('/api/customers/cust-midrand/update', {
      name, accountNumber, registrationNumber, vatNumber, phone, industry, paymentTerms, companyIds: ['eje'],
    });
    expect(refused.status).toBe(422);
    expect(refused.error?.violations[0]?.code).toBe('customer_company_in_use');
  });
});

describe('company administration over HTTP', () => {
  beforeEach(() => startTestServer());

  it('lists the companies to the office and refuses a technician', async () => {
    const master = await signedInAs(DEMO_USERS.master);
    const listed = await master.get<readonly CompanyRow[]>('/api/admin/companies');
    expect(listed.status).toBe(200);
    expect(listed.data.map((company) => company.id)).toEqual(['eje', 'wd-hearn-jhb']);
    const coordinator = await signedInAs(DEMO_USERS.coordinator);
    expect((await coordinator.get('/api/admin/companies')).status).toBe(200);
    const technician = await signedInAs(DEMO_USERS.technician);
    expect((await technician.get('/api/admin/companies')).status).toBe(403);
    const patched = await technician.send('PATCH', '/api/admin/companies/wd-hearn-jhb', { body: { details: { phone: '1' } } });
    expect(patched.status).toBe(403);
  });

  it('saves details and rates, refuses an overlapping prefix and a rewinding start, and audits the change', async () => {
    const master = await signedInAs(DEMO_USERS.master);
    const saved = await master.send<CompanyRow & { phone: string }>('PATCH', '/api/admin/companies/wd-hearn-jhb', {
      body: {
        details: { phone: '+27 11 555 0101', fax: '+27 11 555 0102' },
        rates: {
          labourRates: { normal: 111_100, overtime: 166_600, double: 222_200 },
          calloutRate: 99_900,
          testBenchFee: 0,
          kilometreRate: 2_100,
          vatPercentage: 15,
        },
      },
    });
    expect(saved.status, JSON.stringify(saved.error)).toBe(200);
    expect(saved.data.phone).toBe('+27 11 555 0101');

    const overlap = await master.send('PATCH', '/api/admin/companies/wd-hearn-jhb', { body: { numbering: { jobNumberPrefix: 'EJE-' } } });
    expect(overlap.status).toBe(422);
    expect(overlap.error?.violations[0]?.code).toBe('job_number_prefix_conflict');

    // The fixed fields are not on offer at all.
    const fixed = await master.send('PATCH', '/api/admin/companies/wd-hearn-jhb', { body: { nextJobSequence: 1 } });
    expect(fixed.status).toBe(400);

    expect((await master.post('/api/jobs', body(MIDRAND, { companyId: 'wd-hearn-jhb' }))).status).toBe(200);
    const rewind = await master.send('PATCH', '/api/admin/companies/wd-hearn-jhb', { body: { numbering: { jobNumberStart: 1 } } });
    // Unchanged start: allowed. A forward one: allowed. Anything below the next number: refused.
    expect(rewind.status).toBe(200);
    expect((await master.send('PATCH', '/api/admin/companies/wd-hearn-jhb', { body: { numbering: { jobNumberStart: 50 } } })).status).toBe(200);
    const back = await master.send('PATCH', '/api/admin/companies/wd-hearn-jhb', { body: { numbering: { jobNumberStart: 10 } } });
    expect(back.status).toBe(422);
    expect(back.error?.violations[0]?.code).toBe('job_number_start_invalid');

    const activity = await master.get<{ events: readonly { summary: string; changes: readonly { field: string }[] }[] }>('/api/activity');
    const events = (activity.data.events ?? []).filter((event) => event.summary.includes('WD Hearn JHB company details'));
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.flatMap((event) => event.changes.map((change) => change.field))).toEqual(
      expect.arrayContaining(['company.wd-hearn-jhb.phone', 'company.wd-hearn-jhb.labourNormal', 'company.wd-hearn-jhb.jobNumberStart']),
    );
  });
});
