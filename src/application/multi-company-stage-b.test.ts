import { beforeEach, describe, expect, it } from 'vitest';
import { createJob, type NewJobInput } from './job-creation';
import { updateCustomer } from './customer-operations';
import { updateMachine } from './machine-operations';
import { customerPricingInputs, saveCustomerRates, setCustomerRateMode } from './customer-rates';
import { listCompanies, updateCompany } from './company-operations';
import { attemptCustomerEmail, companySenderFor, signedJobCardValues } from './customer-email';
import { loadJobView } from './job-view';
import { WorkflowError } from './errors';
import { buildHarness, seedUser, type Harness } from './test-harness';
import { renderJobCardPdf } from '@/components/jobs/job-card-pdf';
import { buildJobCardModel } from '@/lib/job-card/model';
import { buildDeliveryNoteModel } from '@/lib/job-card/delivery-note';
import { pdfPlainText } from '@/lib/pdf/inspect';
import { SimulatedPdfService } from '@/services/simulated/pdf';
import type { Clock, EmailMessage } from '@/services/ports';
import {
  asContactId,
  asCustomerId,
  asMachineId,
  asSiteId,
  calculateJobTotals,
  companyBlockFrom,
  companyDetailsFromSettings,
  DEFAULT_COMPANY_ID,
  WD_HEARN_JHB_COMPANY_ID,
  type CompanyId,
  type CompanyRates,
  type CustomerEmail,
} from '@/domain';

/**
 * MULTI-CO-1, STAGE B — THE SERVER: each company's own rates and letterhead,
 * the customer and machine rules, the company administration and the
 * customer email. On the demonstration backend, the same operations the
 * browser runs; the HTTP half is `multi-company-api.test.ts` and the
 * PostgreSQL half `company-admin.db.test.ts`.
 */
const master = seedUser('user-master-elmarie');
const coordinator = seedUser('user-coord-christene');
const technician = seedUser('user-tech-sipho');
const clock: Clock = { now: () => '2026-11-15T08:00:00.000Z' };

/** Midrand Automation Group is the demonstration's customer of BOTH companies; ABC is EJE's only. */
const BOTH = {
  customerId: asCustomerId('cust-midrand'),
  siteId: asSiteId('site-midrand-main'),
  contactId: asContactId('contact-midrand-main'),
  machineId: asMachineId('machine-midrand-press'),
};

const input = (companyId?: CompanyId, register = BOTH): NewJobInput => ({
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

const WDJ_RATES: CompanyRates = {
  labourRates: { normal: 111_100, overtime: 166_600, double: 222_200 },
  calloutRate: 99_900,
  testBenchFee: 12_300,
  kilometreRate: 2_100,
  vatPercentage: 15,
};

const WDJ_DETAILS = {
  name: 'WD Hearn JHB',
  registration: '1999/012345/07',
  vatNumber: '4999999999',
  physicalAddress: '12 Hearn Street, Germiston',
  postalAddress: 'PO Box 77, Germiston, 1400',
  phone: '+27 11 555 0101',
  fax: '+27 11 555 0102',
  email: 'jhb@wdhearn.example',
};

const codeOf = async (promise: Promise<unknown>): Promise<string | undefined> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WorkflowError) return error.violations[0]?.code;
    throw error;
  }
  return undefined;
};

describe('each company prices its own jobs', () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = buildHarness();
    await updateCompany(harness.as(master), WD_HEARN_JHB_COMPANY_ID, { rates: WDJ_RATES });
  });

  it('prices a WD Hearn JHB job at WD Hearn JHB’s rates, and an EJE job at EJE’s', async () => {
    const settings = await harness.repos.settings.get();
    const wd = await createJob(harness.as(master), input(WD_HEARN_JHB_COMPANY_ID));
    const eje = await createJob(harness.as(master), input(DEFAULT_COMPANY_ID));

    const wdView = (await loadJobView(harness.repos, wd.jobNumber))!;
    expect(wdView.settings.labourRates).toEqual(WDJ_RATES.labourRates);
    expect(wdView.settings.calloutRate).toBe(WDJ_RATES.calloutRate);
    expect(await customerPricingInputs(harness.as(master), wd)).toMatchObject({
      labourRates: WDJ_RATES.labourRates,
      calloutRate: WDJ_RATES.calloutRate,
      kilometreRate: WDJ_RATES.kilometreRate,
    });

    const ejeView = (await loadJobView(harness.repos, eje.jobNumber))!;
    expect(ejeView.settings.labourRates).toEqual(settings.labourRates);
    expect(await customerPricingInputs(harness.as(master), eje)).toMatchObject({
      labourRates: settings.labourRates,
      calloutRate: settings.calloutRate,
    });
    // The legacy settings — EJE's — were not touched by WD Hearn's rates.
    expect((await harness.repos.settings.get()).labourRates).toEqual(settings.labourRates);
  });

  it('lets a Custom Rates customer’s own rates override both companies', async () => {
    const custom = {
      labourRates: { normal: 50_000, overtime: 75_000, double: 100_000 },
      calloutRate: 10_000,
      testBenchFee: 0,
      kilometreRate: 900,
      vatPercentage: 15,
    };
    await setCustomerRateMode(harness.as(master), 'cust-midrand', 'custom');
    await saveCustomerRates(harness.as(master), 'cust-midrand', custom);
    for (const companyId of [WD_HEARN_JHB_COMPANY_ID, DEFAULT_COMPANY_ID]) {
      const job = await createJob(harness.as(master), input(companyId));
      expect(await customerPricingInputs(harness.as(master), job)).toMatchObject({
        labourRates: custom.labourRates,
        calloutRate: custom.calloutRate,
      });
      expect((await loadJobView(harness.repos, job.jobNumber))!.rateSource.mode).toBe('custom');
    }
  });

  it('leaves a signed EJE job card’s frozen prices exactly where they were when EJE’s rates change', async () => {
    const signed = (await harness.repos.jobs.list()).find(
      (job) => job.companyId === DEFAULT_COMPANY_ID && job.pricingSnapshot !== null && job.signature !== null,
    )!;
    expect(signed).toBeDefined();
    const before = (await loadJobView(harness.repos, signed.jobNumber))!;
    const totalsBefore = calculateJobTotals(before.job, before.settings);

    await updateCompany(harness.as(master), DEFAULT_COMPANY_ID, {
      rates: { ...WDJ_RATES, labourRates: { normal: 1, overtime: 2, double: 3 }, calloutRate: 4 },
    });

    const after = (await loadJobView(harness.repos, signed.jobNumber))!;
    expect(after.job.pricingSnapshot).toEqual(signed.pricingSnapshot);
    expect(calculateJobTotals(after.job, after.settings)).toEqual(totalsBefore);
    // …while EJE's new rates DID reach the settings (the mirror) and new work.
    expect((await harness.repos.settings.get()).labourRates).toEqual({ normal: 1, overtime: 2, double: 3 });
  });
});

describe('the letterhead is the job’s company’s', () => {
  let harness: Harness;
  beforeEach(() => {
    harness = buildHarness();
  });

  it('builds one block, leaving out whatever was never captured', () => {
    const block = companyBlockFrom({ id: WD_HEARN_JHB_COMPANY_ID, code: 'WDJ', ...WDJ_DETAILS });
    expect(block).toEqual({
      name: 'WD Hearn JHB',
      addressLines: ['12 Hearn Street, Germiston', 'Postal: PO Box 77, Germiston, 1400'],
      address: '12 Hearn Street, Germiston · Postal: PO Box 77, Germiston, 1400',
      contactLine: 'Tel +27 11 555 0101 · Fax +27 11 555 0102 · jhb@wdhearn.example',
      registrationLine: 'Reg. 1999/012345/07 · VAT 4999999999',
    });
    expect(companyBlockFrom({ id: WD_HEARN_JHB_COMPANY_ID, code: 'WDJ', ...WDJ_DETAILS }, { vat: false }).registrationLine).toBe(
      'Reg. 1999/012345/07',
    );
    const bare = companyBlockFrom({
      id: WD_HEARN_JHB_COMPANY_ID, code: 'WDJ', name: 'WD Hearn JHB', registration: '', vatNumber: '',
      physicalAddress: '', postalAddress: '', phone: '', fax: '', email: '',
    });
    expect(bare).toEqual({ name: 'WD Hearn JHB', addressLines: [], address: '', contactLine: '', registrationLine: '' });
  });

  it('prints EJE exactly as before companies existed', async () => {
    const settings = await harness.repos.settings.get();
    const job = await createJob(harness.as(master), input(DEFAULT_COMPANY_ID));
    const view = (await loadJobView(harness.repos, job.jobNumber))!;
    const model = buildJobCardModel({ ...view, generatedAt: clock.now() });
    expect(model.company).toEqual({
      name: settings.companyName,
      address: settings.companyAddress,
      contactLine: `Tel ${settings.companyPhone} · ${settings.companyEmail}`,
      registrationLine: `Reg. ${settings.companyRegistration} · VAT ${settings.companyVatNumber}`,
    });
    // The view's company and the settings-only fallback agree for EJE.
    expect(companyBlockFrom(view.company)).toEqual(companyBlockFrom(companyDetailsFromSettings(settings)));
  });

  it('prints WD Hearn JHB on a WD Hearn JHB job card, its delivery note and its PDF — and nothing of EJE', async () => {
    const settings = await harness.repos.settings.get();
    await updateCompany(harness.as(master), WD_HEARN_JHB_COMPANY_ID, { details: WDJ_DETAILS });
    const job = await createJob(harness.as(master), input(WD_HEARN_JHB_COMPANY_ID));
    const view = (await loadJobView(harness.repos, job.jobNumber))!;
    expect(view.company).toMatchObject({ id: WD_HEARN_JHB_COMPANY_ID, code: 'WDJ', name: 'WD Hearn JHB' });

    const model = buildJobCardModel({ ...view, generatedAt: clock.now() });
    expect(model.company.name).toBe('WD Hearn JHB');
    expect(model.company.contactLine).toBe('Tel +27 11 555 0101 · Fax +27 11 555 0102 · jhb@wdhearn.example');
    expect(model.footerLines[0]).toContain('WD Hearn JHB');

    const note = buildDeliveryNoteModel(view, clock.now());
    expect(note.company.name).toBe('WD Hearn JHB');
    expect(note.footer.startsWith('WD Hearn JHB')).toBe(true);

    const rendered = await renderJobCardPdf(view, new SimulatedPdfService(clock), clock, new Map());
    const text = pdfPlainText(rendered.bytes);
    expect(text).toContain('WD Hearn JHB');
    expect(text).toContain('Fax +27 11 555 0102');
    expect(text).toContain('Reg. 1999/012345/07');
    expect(text).not.toContain(settings.companyName);
    expect(text).not.toContain(settings.companyVatNumber);
  });

  it('prints only the name for WD Hearn JHB until the office captures its details', async () => {
    const job = await createJob(harness.as(master), input(WD_HEARN_JHB_COMPANY_ID));
    const view = (await loadJobView(harness.repos, job.jobNumber))!;
    const model = buildJobCardModel({ ...view, generatedAt: clock.now() });
    expect(model.company).toEqual({ name: 'WD Hearn JHB', address: '', contactLine: '', registrationLine: '' });
  });
});

describe('a customer’s companies, once it has work', () => {
  let harness: Harness;
  beforeEach(() => {
    harness = buildHarness();
  });

  it('refuses taking a company off a customer with a job for it, and allows it without', async () => {
    const customer = (await harness.repos.customers.findById(BOTH.customerId))!;
    // No WD Hearn job yet: taking WD Hearn off, and putting it back, are both fine.
    await updateCustomer(harness.as(master), { ...customer, companyIds: [DEFAULT_COMPANY_ID] });
    const relinked = await updateCustomer(harness.as(master), {
      ...customer,
      companyIds: [DEFAULT_COMPANY_ID, WD_HEARN_JHB_COMPANY_ID],
    });
    expect(relinked.companyIds).toEqual([DEFAULT_COMPANY_ID, WD_HEARN_JHB_COMPANY_ID]);

    await createJob(harness.as(master), input(WD_HEARN_JHB_COMPANY_ID));
    expect(
      await codeOf(updateCustomer(harness.as(master), { ...relinked, companyIds: [DEFAULT_COMPANY_ID] })),
    ).toBe('customer_company_in_use');
    expect((await harness.repos.customers.findById(BOTH.customerId))!.companyIds).toContain(WD_HEARN_JHB_COMPANY_ID);
    // With an EJE job there too, neither company can go.
    await createJob(harness.as(master), input(DEFAULT_COMPANY_ID));
    expect(
      await codeOf(updateCustomer(harness.as(master), { ...relinked, companyIds: [WD_HEARN_JHB_COMPANY_ID] })),
    ).toBe('customer_company_in_use');
  });

  it('refuses moving a machine with WD Hearn JHB work to a customer that is EJE’s only', async () => {
    await createJob(harness.as(master), input(WD_HEARN_JHB_COMPANY_ID));
    const machine = (await harness.repos.machines.findById(BOTH.machineId))!;
    const moved = { ...machine, customerId: asCustomerId('cust-abc'), siteId: asSiteId('site-abc-jhb') };
    expect(await codeOf(updateMachine(harness.as(master), moved))).toBe('machine_company_mismatch');
    expect((await harness.repos.machines.findById(BOTH.machineId))!.customerId).toBe(BOTH.customerId);

    // Once ABC is WD Hearn's customer too, the machine may follow.
    const abc = (await harness.repos.customers.findById(asCustomerId('cust-abc')))!;
    await updateCustomer(harness.as(master), { ...abc, companyIds: [DEFAULT_COMPANY_ID, WD_HEARN_JHB_COMPANY_ID] });
    await expect(updateMachine(harness.as(master), moved)).resolves.toMatchObject({ customerId: 'cust-abc' });
  });
});

describe('administering a company', () => {
  let harness: Harness;
  beforeEach(() => {
    harness = buildHarness();
  });

  it('is the office’s: a Master and a Coordinator may, a technician may not', async () => {
    expect((await listCompanies(harness.as(master))).map((company) => company.id)).toEqual([
      DEFAULT_COMPANY_ID,
      WD_HEARN_JHB_COMPANY_ID,
    ]);
    await expect(
      updateCompany(harness.as(coordinator), WD_HEARN_JHB_COMPANY_ID, { details: { phone: '+27 11 1' } }),
    ).resolves.toMatchObject({ phone: '+27 11 1' });
    expect(await codeOf(listCompanies(harness.as(technician)))).toBe('not_permitted');
    expect(
      await codeOf(updateCompany(harness.as(technician), WD_HEARN_JHB_COMPANY_ID, { details: { phone: 'x' } })),
    ).toBe('not_permitted');
  });

  it('refuses a prefix that overlaps the other company’s, and a start that would rewind an active sequence', async () => {
    expect(
      await codeOf(updateCompany(harness.as(master), WD_HEARN_JHB_COMPANY_ID, { numbering: { jobNumberPrefix: 'EJE-' } })),
    ).toBe('job_number_prefix_conflict');
    expect(
      await codeOf(updateCompany(harness.as(master), WD_HEARN_JHB_COMPANY_ID, { numbering: { jobNumberPrefix: 'wdj' } })),
    ).toBe('job_number_prefix_invalid');

    await updateCompany(harness.as(master), WD_HEARN_JHB_COMPANY_ID, { numbering: { jobNumberStart: 20 } });
    expect((await createJob(harness.as(master), input(WD_HEARN_JHB_COMPANY_ID))).jobNumber).toBe('WDJ-0020');
    expect(
      await codeOf(updateCompany(harness.as(master), WD_HEARN_JHB_COMPANY_ID, { numbering: { jobNumberStart: 5 } })),
    ).toBe('job_number_start_invalid');
    expect((await harness.repos.companies.findById(WD_HEARN_JHB_COMPANY_ID))!.nextJobSequence).toBe(21);
  });

  it('refuses an email address that is not one', async () => {
    expect(
      await codeOf(updateCompany(harness.as(master), WD_HEARN_JHB_COMPANY_ID, { notifications: { replyTo: 'nobody' } })),
    ).toBe('invalid_reply_to');
  });

  it('audits who changed which company, from what to what — office-only', async () => {
    await updateCompany(harness.as(master), WD_HEARN_JHB_COMPANY_ID, {
      details: { phone: '+27 11 555 0101' },
      rates: WDJ_RATES,
    });
    const events = (await harness.repos.activity.list()).filter((event) => event.summary.includes('WD Hearn JHB company details'));
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event!.type).toBe('settings_updated');
    expect(event!.actorId).toBe(master.id);
    expect(event!.changes).toEqual(
      expect.arrayContaining([
        { field: 'company.wd-hearn-jhb.phone', from: '', to: '+27 11 555 0101' },
        expect.objectContaining({ field: 'company.wd-hearn-jhb.labourNormal', to: WDJ_RATES.labourRates.normal }),
      ]),
    );
  });

  it('mirrors EJE into the legacy settings when EJE is saved', async () => {
    await updateCompany(harness.as(master), DEFAULT_COMPANY_ID, {
      details: { phone: '+27 11 000 1111' },
      rates: WDJ_RATES,
    });
    const settings = await harness.repos.settings.get();
    expect(settings.companyPhone).toBe('+27 11 000 1111');
    expect(settings.labourRates).toEqual(WDJ_RATES.labourRates);
  });
});

describe('the customer email names the job’s company', () => {
  let harness: Harness;
  beforeEach(() => {
    harness = buildHarness();
  });

  it('fills {{our_company}} with the job’s company, and {{company_name}} still with the customer', async () => {
    const wd = await createJob(harness.as(master), input(WD_HEARN_JHB_COMPANY_ID));
    const eje = await createJob(harness.as(master), input(DEFAULT_COMPANY_ID));
    const recipient = { email: 'buyer@midrand.example', displayName: 'Buyer' };
    const wdValues = await signedJobCardValues(harness.as(master), wd, recipient);
    expect(wdValues.our_company).toBe('WD Hearn JHB');
    expect(wdValues.company_name).toBe((await harness.repos.customers.findById(BOTH.customerId))!.name);
    expect((await signedJobCardValues(harness.as(master), eje, recipient)).our_company).toBe(
      (await harness.repos.settings.get()).companyName,
    );
  });

  it('sends as the company’s notification sender and reply-to, where they are set', async () => {
    const wd = await createJob(harness.as(master), input(WD_HEARN_JHB_COMPANY_ID));
    expect(await companySenderFor(harness.repos, { jobId: wd.id })).toEqual({ senderName: '', replyTo: '' });
    await updateCompany(harness.as(master), WD_HEARN_JHB_COMPANY_ID, {
      notifications: { senderName: 'WD Hearn JHB Service', replyTo: 'service@wdhearn.example' },
    });
    const sender = await companySenderFor(harness.repos, { jobId: wd.id });
    expect(sender).toEqual({ senderName: 'WD Hearn JHB Service', replyTo: 'service@wdhearn.example' });

    const sent: EmailMessage[] = [];
    const services = {
      ...harness.services,
      email: {
        send: (message: EmailMessage) => {
          sent.push(message);
          return Promise.resolve({ messageId: 'm-1', state: 'pending_delivery' as const, failureReason: '', entry: null });
        },
        checkStatus: () => Promise.resolve(null),
      },
    } as unknown as typeof harness.services;
    const email = {
      id: 'email-1', jobId: wd.id, recipient: 'buyer@midrand.example', cc: [], subject: 'S', body: 'B',
      attachment: null, extraAttachments: [],
    } as unknown as CustomerEmail;
    await attemptCustomerEmail(services, email, sender);
    expect(sent[0]).toMatchObject({ senderName: 'WD Hearn JHB Service', replyTo: 'service@wdhearn.example' });
    await attemptCustomerEmail(services, email, { senderName: '', replyTo: '' });
    expect(sent[1]).not.toHaveProperty('senderName');
    expect(sent[1]).not.toHaveProperty('replyTo');
  });
});
