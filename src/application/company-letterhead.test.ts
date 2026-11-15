import { beforeEach, describe, expect, it } from 'vitest';
import {
  asContactId,
  asCustomerId,
  asMachineId,
  asSiteId,
  DEFAULT_COMPANY_ID,
  WD_HEARN_JHB_COMPANY_ID,
  type Job,
} from '@/domain';
import type { PdfImage } from '@/lib/pdf/image';
import { pdfPlainText } from '@/lib/pdf/inspect';
import {
  acceptJob,
  addPart,
  addLabour,
  captureSignature,
  saveCompletionReport,
  setCollectionMethod,
  startCompletion,
  startSignature,
  submitJobCard,
} from './job-operations';
import { createJob } from './job-creation';
import { loadCorrectionDocument, raiseJobCorrection } from './job-corrections';
import { loadFinalDocumentFile, storeFinalDocument } from './final-document';
import { generateDeliveryNote } from './delivery-note';
import { loadJobView } from './job-view';
import { EJE_MASTER_LETTERHEAD } from '@/lib/branding/eje-letterhead';
import {
  defaultCompanyLetterhead,
  downloadCompanyLetterheadFile,
  loadCompanyLetterhead,
  removeCompanyLetterhead,
  uploadCompanyLetterhead,
} from './company-letterhead';
import { WorkflowError } from './errors';
import { StorageIntegrityFailed } from '@/services/ports';
import { buildHarness, seedUser, type Harness } from './test-harness';
import { embedsImageData, imageObjectCount, letterheadPng, preparedLetterhead } from '@/test/letterhead-fixture';

/**
 * LETTERHEAD-1 THROUGH THE REAL PATHS: a document issued NOW carries the
 * letterhead of the company its job belongs to — WD Hearn's on a WD Hearn job,
 * EJE's on an EJE job — through the same operations that issue it; history
 * rendered for a job issued before letterheads keeps its text header.
 *
 * LETTERHEAD-2: EJE's is the MASTER letterhead — vector text and the traced
 * mark, no image — even when an EJE image has been uploaded; WD Hearn's is
 * still its uploaded image.
 */
const MASTER_LINES = ['Reg: CK1987/020035/23', 'EJE Industrial Electronics cc', 'VAT NO: 4950134991', 'P.O. Box 16282'];
const carriesMaster = (bytes: Uint8Array) => {
  const text = pdfPlainText(bytes);
  for (const line of MASTER_LINES) expect(text, line).toContain(line);
  expect(imageObjectCount(bytes)).toBe(0);
};
const master = seedUser('user-master-elmarie');
const technician = seedUser('user-tech-sipho');

const EJE_PNG = letterheadPng(600, 100, [20, 60, 140]);
const WD_PNG = letterheadPng(500, 120, [200, 30, 30]);

const issuedEjeJob = async (harness: Harness): Promise<Job> => {
  const view = await loadJobView(harness.repos, 'EJE-1048');
  const tech = harness.as(technician);
  let job = await acceptJob(tech, view!.job);
  job = await addLabour(tech, job, { date: '2026-09-17', rateType: 'normal', hours: 3, description: 'Spindle drive repair' });
  job = await saveCompletionReport(tech, job, { ...job.completionReport, workPerformed: 'Replaced the spindle drive cooling fan.' });
  job = await startCompletion(tech, job);
  job = await startSignature(tech, job);
  job = await captureSignature(tech, job, { customerName: 'Pieter', customerSurname: 'Nel', strokeData: 'M0,0 L1,1' });
  return (await submitJobCard(tech, job, 'pieter@abc-engineering-demo.co.za', 'Pieter Nel')).job;
};

const wdJob = (harness: Harness) =>
  createJob(harness.as(master), {
    customerId: asCustomerId('cust-midrand'),
    siteId: asSiteId('site-midrand-main'),
    contactId: asContactId('contact-midrand-main'),
    machineId: asMachineId('machine-midrand-press'),
    companyId: WD_HEARN_JHB_COMPANY_ID,
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

describe('each job document on its own company’s letterhead', () => {
  let harness: Harness;
  let eje: PdfImage;
  let wd: PdfImage;

  beforeEach(async () => {
    harness = buildHarness();
    await uploadCompanyLetterhead(harness.as(master), DEFAULT_COMPANY_ID, { fileName: 'eje.png', bytes: EJE_PNG });
    await uploadCompanyLetterhead(harness.as(master), WD_HEARN_JHB_COMPANY_ID, { fileName: 'wd.png', bytes: WD_PNG });
    eje = await preparedLetterhead(EJE_PNG);
    wd = await preparedLetterhead(WD_PNG);
  });

  it('loads the master letterhead for EJE (its uploaded image is not printed), and WD Hearn’s own image', async () => {
    expect(await loadCompanyLetterhead(harness.as(master), DEFAULT_COMPANY_ID)).toBe(EJE_MASTER_LETTERHEAD);
    expect(await defaultCompanyLetterhead(harness.as(master))).toBe(EJE_MASTER_LETTERHEAD);
    expect(((await loadCompanyLetterhead(harness.as(master), WD_HEARN_JHB_COMPANY_ID)) as PdfImage).data).toEqual(wd.data);
    await removeCompanyLetterhead(harness.as(master), WD_HEARN_JHB_COMPANY_ID);
    expect(await loadCompanyLetterhead(harness.as(master), WD_HEARN_JHB_COMPANY_ID)).toBeUndefined();
  });

  it('with damaged stored bytes: the download is refused as document_damaged, and documents fall back to the text header', async () => {
    const company = (await harness.repos.companies.findById(WD_HEARN_JHB_COMPANY_ID))!;
    const storageKey = company.letterhead!.storageKey;
    const original = harness.services.storage.getDocument.bind(harness.services.storage);
    harness.services.storage.getDocument = async (key: string) => {
      if (key === storageKey) throw new StorageIntegrityFailed(key, 'The stored file is 10 bytes and its record says 4096.');
      return original(key);
    };

    const refusal = await downloadCompanyLetterheadFile(harness.as(master), WD_HEARN_JHB_COMPANY_ID).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(WorkflowError);
    expect((refusal as WorkflowError).violations.map((violation) => violation.code)).toEqual(['document_damaged']);
    // EJE's, undamaged, is still served.
    expect((await downloadCompanyLetterheadFile(harness.as(master), DEFAULT_COMPANY_ID))?.bytes).toEqual(EJE_PNG);

    // A document is never withheld for want of its letterhead: no image, the text header.
    expect(await loadCompanyLetterhead(harness.as(master), WD_HEARN_JHB_COMPANY_ID)).toBeUndefined();
    expect(await loadCompanyLetterhead(harness.as(master), DEFAULT_COMPANY_ID)).toBe(EJE_MASTER_LETTERHEAD);
  });

  it('an EJE job card issued now carries the EJE master letterhead, and its correction addendum too', async () => {
    const issued = await issuedEjeJob(harness);
    const card = await loadFinalDocumentFile(harness.as(master), issued.jobNumber);
    carriesMaster(card.bytes);
    expect(embedsImageData(card.bytes, eje)).toBe(false);
    expect(embedsImageData(card.bytes, wd)).toBe(false);
    expect(pdfPlainText(card.bytes)).toContain(issued.jobNumber);

    const correction = await raiseJobCorrection(harness.as(master), issued, {
      reason: 'The labour hours were captured against the wrong rate.',
      narrative: 'Three hours should have been normal time.',
      areas: ['labour', 'charges'],
      acknowledgementRequired: true,
    });
    const addendum = await loadCorrectionDocument(harness.as(master), issued, correction.id);
    expect(addendum).not.toBeNull();
    carriesMaster(addendum!.file.bytes);
    expect(pdfPlainText(addendum!.file.bytes)).toContain('CORRECTION TO JOB CARD');
  });

  it('a WD Hearn job’s documents carry WD Hearn’s letterhead, never EJE’s', async () => {
    const job = await wdJob(harness);
    const view = (await loadJobView(harness.repos, job.jobNumber))!;
    const storageKey = `jobcards/final/${job.jobNumber}.pdf`;
    await storeFinalDocument(
      harness.as(master),
      job,
      { storageKey, fileName: `${job.jobNumber}.pdf`, generatedAt: '2026-11-15T08:00:00.000Z' as Job['createdAt'] },
      {
        job: view.job,
        customer: view.customer,
        site: view.site,
        contact: view.contact,
        machine: view.machine,
        settings: view.settings,
        company: view.company,
        checklistTemplate: view.checklistTemplate,
        users: view.users,
      },
    );
    const stored = (await harness.services.storage.getDocument(storageKey))!;
    expect(embedsImageData(stored.bytes, wd)).toBe(true);
    expect(embedsImageData(stored.bytes, eje)).toBe(false);
    expect(imageObjectCount(stored.bytes)).toBe(1);
  });

  it('history rendered for a job issued before letterheads keeps its text header', async () => {
    // EJE-1044 was issued before this demonstration began; its file is drawn as it was issued.
    const card = await loadFinalDocumentFile(harness.as(master), 'EJE-1044');
    expect(imageObjectCount(card.bytes)).toBe(0);
    expect(pdfPlainText(card.bytes)).toContain('EJE Industrial Electronics');
  });

  it('a technician cannot upload or remove one', async () => {
    await expect(
      uploadCompanyLetterhead(harness.as(technician), DEFAULT_COMPANY_ID, { fileName: 'x.png', bytes: EJE_PNG }),
    ).rejects.toThrow('Only the office');
    await expect(removeCompanyLetterhead(harness.as(technician), DEFAULT_COMPANY_ID)).rejects.toThrow('Only the office');
  });
});

describe('the delivery note produced now', () => {
  it('is on the job company’s letterhead', async () => {
    const harness = buildHarness();
    await uploadCompanyLetterhead(harness.as(master), DEFAULT_COMPANY_ID, { fileName: 'eje.png', bytes: EJE_PNG });
    const eje = await preparedLetterhead(EJE_PNG);
    const context = harness.as(master);
    const [customer] = await harness.repos.customers.list();
    const sites = await harness.repos.customers.listSites(customer!.id);
    const contacts = await harness.repos.customers.listContacts(customer!.id);
    let job = await createJob(context, {
      customerId: customer!.id,
      siteId: sites[0]!.id,
      contactId: contacts[0]!.id,
      machineId: null,
      jobType: 'parts',
      priority: 'normal',
      scheduledDate: '2026-09-20',
      scheduledEndDate: null,
      orderNumber: 'PO-1',
      referenceNumber: 'REF-1',
      deliveryNote: 'DN-1',
      faultDescription: 'Spares.',
      primaryTechnicianId: null,
      courierCollection: false,
      additionalTechnicianIds: [],
    });
    job = await addPart(context, job, { partNumber: 'ENC-1', description: 'Encoder', quantity: 1, unitPrice: 100_000 });
    job = await setCollectionMethod(context, job, { courier: true, waybillNumber: 'DAW-1' });
    const note = await generateDeliveryNote(context, job);
    const bytes = new Uint8Array(Buffer.from(note.base64, 'base64'));
    // LETTERHEAD-2: an EJE job's, so the master letterhead — the uploaded EJE image is not printed.
    carriesMaster(bytes);
    expect(embedsImageData(bytes, eje)).toBe(false);
    expect(pdfPlainText(bytes)).toContain('DELIVERY NOTE');
    expect(pdfPlainText(bytes)).toContain(job.jobNumber);
  });
});
