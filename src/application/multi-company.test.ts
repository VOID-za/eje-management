import { beforeEach, describe, expect, it } from 'vitest';
import { createJob, releaseDraft, type NewJobInput } from './job-creation';
import { createCustomer, updateCustomer } from './customer-operations';
import { WorkflowError } from './errors';
import { buildHarness, seedUser, type Harness } from './test-harness';
import {
  asCompanyId,
  asContactId,
  asCustomerId,
  asMachineId,
  asSiteId,
  CompanyRuleError,
  DEFAULT_COMPANY_ID,
  WD_HEARN_JHB_COMPANY_ID,
  type CompanyId,
} from '@/domain';

/**
 * TWO COMPANIES, ONE REGISTER. MULTI-CO-1 (15 November 2026), on the
 * demonstration backend — the same operations and repositories the browser
 * runs. The PostgreSQL half is `multi-company.db.test.ts`.
 *
 * The owner's rules, each asserted: every job belongs to one company, fixed
 * when it is raised; a company raises work only for its own customers (a
 * customer may be both companies'); each company numbers from its own
 * sequence, EJE- and WDJ- independently, WD Hearn's first job WDJ-0001.
 */
const master = seedUser('user-master-elmarie');

/** Midrand Automation Group is the demonstration's customer of BOTH companies; ABC is EJE's only. */
const BOTH = {
  customerId: asCustomerId('cust-midrand'),
  siteId: asSiteId('site-midrand-main'),
  contactId: asContactId('contact-midrand-main'),
  machineId: asMachineId('machine-midrand-press'),
};
const EJE_ONLY = {
  customerId: asCustomerId('cust-abc'),
  siteId: asSiteId('site-abc-jhb'),
  contactId: asContactId('contact-abc-jhb'),
  machineId: asMachineId('machine-abc-lv40'),
};

const input = (register: typeof BOTH, companyId?: CompanyId): NewJobInput => ({
  ...register,
  ...(companyId === undefined ? {} : { companyId }),
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

describe('raising a job for a company', () => {
  let harness: Harness;
  beforeEach(() => {
    harness = buildHarness();
  });

  it('defaults to EJE, numbered from EJE’s sequence exactly as before', async () => {
    const before = (await harness.repos.settings.get()).nextJobSequence;
    const job = await createJob(harness.as(master), input(EJE_ONLY));
    expect(job.companyId).toBe(DEFAULT_COMPANY_ID);
    expect(job.jobNumber).toBe(`EJE-${before}`);
    expect((await harness.repos.settings.get()).nextJobSequence).toBe(before + 1);
  });

  it('numbers WD Hearn JHB from WDJ-0001, independently of EJE', async () => {
    const ejeNext = (await harness.repos.settings.get()).nextJobSequence;
    const first = await createJob(harness.as(master), input(BOTH, WD_HEARN_JHB_COMPANY_ID));
    const eje = await createJob(harness.as(master), input(BOTH, DEFAULT_COMPANY_ID));
    const second = await createJob(harness.as(master), input(BOTH, WD_HEARN_JHB_COMPANY_ID));

    expect([first.jobNumber, second.jobNumber]).toEqual(['WDJ-0001', 'WDJ-0002']);
    expect([first.companyId, second.companyId]).toEqual([WD_HEARN_JHB_COMPANY_ID, WD_HEARN_JHB_COMPANY_ID]);
    // EJE's sequence moved by its own job only.
    expect(eje.jobNumber).toBe(`EJE-${ejeNext}`);
    expect((await harness.repos.settings.get()).nextJobSequence).toBe(ejeNext + 1);
    expect((await harness.repos.companies.findById(WD_HEARN_JHB_COMPANY_ID))?.nextJobSequence).toBe(3);
  });

  it('refuses a customer that is not a customer of that company, before a number is used', async () => {
    const attempt = createJob(harness.as(master), input(EJE_ONLY, WD_HEARN_JHB_COMPANY_ID));
    await expect(attempt).rejects.toThrow(WorkflowError);
    await expect(attempt).rejects.toThrow('ABC Engineering (Pty) Ltd is not a customer of WD Hearn JHB.');
    expect((await harness.repos.companies.findById(WD_HEARN_JHB_COMPANY_ID))?.nextJobSequence).toBe(1);
  });

  it('refuses a company nobody knows rather than reading it as EJE', async () => {
    await expect(createJob(harness.as(master), input(BOTH, asCompanyId('nobody')))).rejects.toThrow(
      'That company is not one the system serves.',
    );
  });

  it('re-asks the company on releasing a draft: the customer must still be the company’s', async () => {
    const draft = await createJob(harness.as(master), input(BOTH, WD_HEARN_JHB_COMPANY_ID), { asDraft: true });
    const customer = await harness.repos.customers.findById(BOTH.customerId);
    await updateCustomer(harness.as(master), { ...customer!, companyIds: [DEFAULT_COMPANY_ID] });
    await expect(releaseDraft(harness.as(master), draft)).rejects.toThrow('is not a customer of WD Hearn JHB');
  });

  it('keeps the job’s company fixed: a save that moves it is refused', async () => {
    const job = await createJob(harness.as(master), input(BOTH, WD_HEARN_JHB_COMPANY_ID));
    await expect(harness.repos.jobs.save({ ...job, companyId: DEFAULT_COMPANY_ID })).rejects.toThrow(
      "a job's company is fixed when it is raised",
    );
    expect((await harness.repos.jobs.findById(job.id))?.companyId).toBe(WD_HEARN_JHB_COMPANY_ID);
  });
});

describe('a customer’s companies', () => {
  let harness: Harness;
  beforeEach(() => {
    harness = buildHarness();
  });

  const newCustomer = (companyIds?: readonly CompanyId[]) => ({
    name: 'Strucmac Engineering',
    accountNumber: 'STR-001',
    registrationNumber: '',
    vatNumber: '',
    phone: '',
    email: '',
    industry: '',
    paymentTerms: '',
    ...(companyIds === undefined ? {} : { companyIds }),
    site: { name: 'Main', addressLine1: '1 Main Road', addressLine2: '', city: 'Midrand', province: 'Gauteng', postalCode: '1685', accessNotes: '' },
    contact: null,
  });

  it('is EJE when nobody says otherwise', async () => {
    const { customer } = await createCustomer(harness.as(master), newCustomer());
    expect(customer.companyIds).toEqual([DEFAULT_COMPANY_ID]);
  });

  it('may be one company or both, each named once', async () => {
    const { customer } = await createCustomer(
      harness.as(master),
      newCustomer([WD_HEARN_JHB_COMPANY_ID, DEFAULT_COMPANY_ID, WD_HEARN_JHB_COMPANY_ID]),
    );
    expect(customer.companyIds).toEqual([WD_HEARN_JHB_COMPANY_ID, DEFAULT_COMPANY_ID]);
  });

  it('is never none, and never a company that does not exist', async () => {
    await expect(createCustomer(harness.as(master), newCustomer([]))).rejects.toThrow(
      'Choose at least one company for the customer.',
    );
    await expect(createCustomer(harness.as(master), newCustomer([asCompanyId('nobody')]))).rejects.toThrow(
      'That company is not one the system serves.',
    );
  });
});

describe('the company repository (demonstration)', () => {
  let harness: Harness;
  beforeEach(() => {
    harness = buildHarness();
  });

  it('holds EJE from the settings and WD Hearn JHB with nothing invented', async () => {
    const [eje, wdHearn] = await harness.repos.companies.list();
    const settings = await harness.repos.settings.get();
    expect(eje).toMatchObject({ id: 'eje', name: settings.companyName, jobNumberPrefix: 'EJE-', isDefault: true });
    expect(wdHearn).toMatchObject({
      id: 'wd-hearn-jhb', name: 'WD Hearn JHB', jobNumberPrefix: 'WDJ-', jobNumberStart: 1, nextJobSequence: 1,
      registration: '', vatNumber: '', physicalAddress: '', postalAddress: '', phone: '', fax: '', email: '',
      letterhead: null, isDefault: false, jobNumbersIssued: false,
    });
    expect(wdHearn?.rates).toEqual(eje?.rates);
  });

  it('refuses a prefix that would be confused with the other company’s', async () => {
    const wdHearn = (await harness.repos.companies.findById(WD_HEARN_JHB_COMPANY_ID))!;
    await expect(harness.repos.companies.save({ ...wdHearn, jobNumberPrefix: 'EJE-' })).rejects.toBeInstanceOf(
      CompanyRuleError,
    );
  });

  it('sets the start freely before a number is issued, and only forward after', async () => {
    const companies = harness.repos.companies;
    const wdHearn = (await companies.findById(WD_HEARN_JHB_COMPANY_ID))!;
    expect((await companies.save({ ...wdHearn, jobNumberStart: 500 })).nextJobSequence).toBe(500);
    expect((await createJob(harness.as(master), input(BOTH, WD_HEARN_JHB_COMPANY_ID))).jobNumber).toBe('WDJ-0500');

    const active = (await companies.findById(WD_HEARN_JHB_COMPANY_ID))!;
    expect(active.jobNumbersIssued).toBe(true);
    await expect(companies.save({ ...active, jobNumberStart: 400 })).rejects.toThrow(
      'Job numbers up to 500 have already been issued',
    );
    await expect(companies.save({ ...active, jobNumberStart: 501 })).resolves.toMatchObject({ nextJobSequence: 501 });
  });

  it('mirrors EJE’s details into the settings record, where the release before companies reads them', async () => {
    const eje = (await harness.repos.companies.findById(DEFAULT_COMPANY_ID))!;
    await harness.repos.companies.save({ ...eje, phone: '+27 11 999 0000', fax: '+27 11 999 0001' });
    expect((await harness.repos.settings.get()).companyPhone).toBe('+27 11 999 0000');
    expect((await harness.repos.companies.findById(DEFAULT_COMPANY_ID))?.fax).toBe('+27 11 999 0001');
  });

  it('refuses to allocate for a company nobody knows', async () => {
    await expect(harness.repos.companies.allocateJobNumber(asCompanyId('nobody'))).rejects.toBeInstanceOf(
      CompanyRuleError,
    );
  });
});
