import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  acceptJob,
  addLabour,
  addMedia,
  addPart,
  answerChecklistItem,
  captureSignature,
  completeChecklist,
  issueJobCard,
  saveCompletionReport,
  startChecklist,
  startCompletion,
  startSignature,
} from './job-operations';
import { loadFinalDocumentFile } from './final-document';
import { loadDocumentPhotos } from './document-photos';
import { loadJobView } from './job-view';
import { documentTitleFor } from './customer-email';
import { buildHarness, seedUser, type Harness } from './test-harness';
import { renderJobCardPdf } from '@/components/jobs/job-card-pdf';
import { buildJobCardModel } from '@/lib/job-card/model';
import { documentIdentityFor } from '@/lib/job-card/document-identity';
import {
  INSTALLATION_DELIVERY_NOTE_TITLE,
  presentsAsInstallationDeliveryNote,
} from '@/lib/job-card/installation-note';
import { inspectPdf, pdfPageTexts as rawPageTexts, pdfPlainText as rawPlainText } from '@/lib/pdf/inspect';
import { SimulatedPdfService } from '@/services/simulated/pdf';
import type { Clock } from '@/services/ports';
import {
  asChecklistTemplateId,
  getJobTypeDefinition,
  type ChecklistTemplate,
  type Job,
  type JobTypeCode,
} from '@/domain';

/**
 * AN INSTALLATION PRODUCES A DELIVERY NOTE, NOT THE PRICED JOB CARD.
 * INSTALL-DN-1 (the owner, 7–8 November 2026).
 *
 * Driven through the real operations — accept, checklist, photographs, a part,
 * labour, the write-up, the signature, the issue — and asserted on the PDF
 * bytes themselves: the preview a technician shows, the copy that is issued
 * and stored, and the download. Every value on it is the job's own; nothing on
 * it is money. An Installation issued as a job card BEFORE this release keeps
 * the bytes it was issued with, and every other job type keeps its prices.
 */
const technician = seedUser('user-tech-sipho');
const secondTechnician = seedUser('user-tech-deon');
const clock: Clock = { now: () => '2026-11-08T08:00:00.000Z' };
const JPEG = new Uint8Array(
  readFileSync(new URL('../lib/pdf/__fixtures__/quadrants.jpg', import.meta.url)),
);

/** Money as `formatCurrency` prints it ("R 1 250,00"), wherever it might leak. */
const CURRENCY = /R[\s ]?\d[\d\s ]*,\d{2}\b/u;
/** Words that only a priced document carries. Whole words: "Rate" is not in "Generated". */
const FINANCIAL_WORDS = [
  /\bVAT\b/u,
  /\bSubtotal\b/iu,
  /\bTotal\b/iu,
  /\bRate\b/iu,
  /\bAmount\b/iu,
  /\bDiscount\b/iu,
  /\bCall-out\b/iu,
  /Test bench fee/iu,
  /Priced at the rates/iu,
  /\bUnit price\b/iu,
];

const expectNoMoney = (text: string): void => {
  expect(text).not.toMatch(CURRENCY);
  for (const word of FINANCIAL_WORDS) expect(text).not.toMatch(word);
};

const TEMPLATE_ID = asChecklistTemplateId('chk-install-dn-test');
const template = (): ChecklistTemplate => ({
  id: TEMPLATE_ID,
  name: 'Installation hand-over checklist',
  description: 'Two questions, so the document can be read back.',
  jobTypeCode: 'installation',
  version: '1.0-DN',
  status: 'current',
  sourceDocument: 'TEST CONTENT',
  updatedAt: '2026-11-01T08:00:00.000Z',
  sections: [
    {
      id: 'dn-section',
      title: 'Commissioning',
      description: '',
      items: [
        {
          id: 'dn-guarding',
          text: 'Light curtain and guarding fitted',
          helpText: '',
          responseType: 'pass_fail_na',
          required: true,
          photoRequired: false,
          unit: null,
          expectedRange: null,
        },
        {
          id: 'dn-supply',
          text: 'Supply voltage measured at the isolator',
          helpText: '',
          responseType: 'measurement',
          required: true,
          photoRequired: false,
          unit: 'V',
          expectedRange: { min: 380, max: 420 },
        },
      ],
    },
  ],
});

/** EJE-1048, made an Installation of Sipho's (with Deon), worked and signed. */
const signedInstallation = async (
  harness: Harness,
  photoCount = 1,
  jobType: JobTypeCode = 'installation',
): Promise<Job> => {
  await harness.repos.checklistTemplates.save({ ...template(), jobTypeCode: jobType });
  const found = (await harness.repos.jobs.findByJobNumber('EJE-1048'))!;
  const context = harness.as(technician);
  let job = await harness.repos.jobs.save({
    ...found,
    jobType,
    additionalTechnicianIds: [secondTechnician.id],
    faultDescription: 'Install and commission the new press brake in bay 3.',
  });
  job = await acceptJob(context, job);
  if (getJobTypeDefinition(jobType).checklistRequired) {
    const chosen = { ...template(), jobTypeCode: jobType };
    job = await startChecklist(context, job, chosen);
    job = await answerChecklistItem(context, job, 'dn-guarding', { choice: 'pass' });
    job = await answerChecklistItem(context, job, 'dn-supply', { measurement: 401 });
    job = await completeChecklist(context, job, chosen);
  }
  for (let index = 0; index < photoCount; index += 1) {
    job = await addMedia(context, job, {
      kind: 'photo',
      fileName: `installed-${index + 1}.jpg`,
      caption: `Installed view ${index + 1}`,
      contentType: 'image/jpeg',
      bytes: JPEG,
    });
  }
  job = await addPart(context, job, {
    partNumber: 'LC-500-RX',
    description: 'Light curtain receiver',
    quantity: 2,
    unitPrice: 125_000,
  });
  job = await addLabour(context, job, {
    date: '2026-11-07',
    rateType: 'overtime',
    hours: 6.5,
    description: 'Positioned, levelled and commissioned the press brake',
  });
  job = await saveCompletionReport(context, job, {
    ...job.completionReport,
    workPerformed: 'Anchored the machine, connected the supply and commissioned it.',
  });
  job = await startCompletion(context, job);
  job = await startSignature(context, job);
  return captureSignature(context, job, {
    customerName: 'Pieter',
    customerSurname: 'Nel',
    strokeData: 'M0.100,0.600 L0.300,0.200 L0.500,0.700 L0.800,0.300',
  });
};

const issue = async (harness: Harness, job: Job): Promise<{ job: Job; bytes: Uint8Array }> => {
  const issued = await issueJobCard(harness.as(technician), job, 'pieter.nel@abc-engineering-demo.co.za', 'Pieter Nel');
  const file = await loadFinalDocumentFile(harness.as(technician), job.jobNumber);
  return { job: issued.job, bytes: file.bytes };
};

const preview = async (harness: Harness, job: Job) => {
  const view = (await loadJobView(harness.repos, job.jobNumber))!;
  const images = await loadDocumentPhotos(harness.services.storage, view.job);
  return renderJobCardPdf(view, new SimulatedPdfService(clock), clock, images);
};

/** Every image drawn: its box on the page (the matrix maps the unit square to it). */
const drawnImages = (bytes: Uint8Array) =>
  [...Buffer.from(bytes).toString('latin1').matchAll(/q (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) cm \/Im\d+ Do Q/g)].map(
    (match) => {
      const [a, b, c, d, e, f] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
      return { x: e, y: f, width: Math.abs(a) + Math.abs(c), height: Math.abs(b) + Math.abs(d) };
    },
  );
const imageObjectCount = (bytes: Uint8Array): number =>
  [...Buffer.from(bytes).toString('latin1').matchAll(/\/Subtype \/Image /g)].length;
/** WinAnsi's em dash (0x97), read back as the character it is. */
const emDash = (text: string): string => text.replace(/\u0097/gu, '—');
const pdfPlainText = (bytes: Uint8Array): string => emDash(rawPlainText(bytes));
const pdfPageTexts = (bytes: Uint8Array): string[] => rawPageTexts(bytes).map(emDash);
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('an Installation is issued as its Delivery Note', () => {
  let harness: Harness;
  beforeEach(() => {
    harness = buildHarness();
  });

  it('issues and serves the Delivery Note under its own name — still an Installation job', async () => {
    const { job, bytes } = await issue(harness, await signedInstallation(harness));
    expect(job.jobType).toBe('installation');
    expect(job.finalDocument?.fileName).toBe('EJE-1048-Final-Installation-Delivery-Note.pdf');
    expect(presentsAsInstallationDeliveryNote(job)).toBe(true);
    const text = pdfPlainText(bytes);
    expect(text).toContain('DELIVERY NOTE — INSTALLATION');
    expect(text).not.toContain('JOB CARD');
    expect(text).toContain('EJE-1048-Final-Installation-Delivery-Note.pdf');
    // The email names it the same way.
    expect(documentTitleFor(job)).toBe('Signed Delivery Note');
  });

  it('carries the customer, site, machine, order, reference and both technicians', async () => {
    const signed = await signedInstallation(harness);
    const view = (await loadJobView(harness.repos, signed.jobNumber))!;
    const { bytes } = await issue(harness, signed);
    const text = pdfPlainText(bytes);
    for (const value of [
      view.customer.name,
      view.site.name,
      view.site.addressLine1,
      view.machine!.serialNumber,
      signed.orderNumber,
      signed.referenceNumber,
      'Installation date',
      'Technicians',
      `${technician.firstName} ${technician.lastName}`,
      `${secondTechnician.firstName} ${secondTechnician.lastName}`,
    ]) {
      expect(text).toContain(value);
    }
  });

  it('describes what was installed and the labour — hours and work, never a rate', async () => {
    const { bytes } = await issue(harness, await signedInstallation(harness));
    const text = pdfPlainText(bytes);
    for (const value of [
      'Install and commission the new press brake in bay 3.',
      'ITEMS DELIVERED AND INSTALLED',
      'LC-500-RX — Light curtain receiver',
      'LABOUR AND COMPLETION',
      'Positioned, levelled and commissioned the press brake',
      '6.50 hrs',
      'Hours recorded',
      'Anchored the machine, connected the supply and commissioned it.',
      'Work completed',
    ]) {
      expect(text).toContain(value);
    }
    // "Overtime" is how the hour is charged — a pricing word, not the customer's business.
    expect(text).not.toContain('Overtime');
  });

  it('shows NO price, rate, amount, subtotal, VAT or total anywhere — preview and issued copy alike', async () => {
    const signed = await signedInstallation(harness);
    const previewed = await preview(harness, signed);
    const { bytes } = await issue(harness, signed);
    for (const pdf of [previewed.bytes, bytes]) {
      for (const page of pdfPageTexts(pdf)) expectNoMoney(page);
    }
    // The figures are still on the JOB, for the office and the invoice.
    const saved = (await harness.repos.jobs.findByJobNumber('EJE-1048'))!;
    expect(saved.parts[0]!.unitPrice).toBe(125_000);
    expect(saved.pricingSnapshot).not.toBeNull();
  });

  it('carries the installation checklist, its answers, its status and who completed it, in the same document', async () => {
    const { bytes } = await issue(harness, await signedInstallation(harness));
    const text = pdfPlainText(bytes);
    for (const value of [
      'INSTALLATION HAND-OVER CHECKLIST',
      'Light curtain and guarding fitted',
      'PASS',
      'Supply voltage measured at the isolator',
      '401 V',
      '2 of 2 items answered',
      'Installation checklist',
      'Completed',
      'Checklist by',
    ]) {
      expect(text).toContain(value);
    }
  });

  it('embeds the photographs, two across, and the customer signature', async () => {
    const { bytes } = await issue(harness, await signedInstallation(harness));
    expect(imageObjectCount(bytes)).toBe(1);
    const [box] = drawnImages(bytes);
    // Half the content width (515pt), not the job card's third.
    expect(box!.width).toBeGreaterThan(240);
    const text = pdfPlainText(bytes);
    expect(text).toContain('Installed view 1');
    expect(text).not.toContain('Photograph not shown');
    expect(text).toContain('CUSTOMER ACCEPTANCE');
    expect(text).toContain('Pieter Nel');
    expect(text).toContain('Customer signature');
    // The captured geometry is drawn, not a typeset name.
    const raw = Buffer.from(bytes).toString('latin1');
    expect(raw).toMatch(/[\d.]+ [\d.]+ m/u);
    expect(raw).toMatch(/[\d.]+ [\d.]+ l/u);
    expect(raw).toContain('0 0 0 RG');
  });

  it('with many photographs, adds pages rather than shrinking them — nothing off the page', async () => {
    const one = (await issue(harness, await signedInstallation(harness, 1))).bytes;
    const other = buildHarness();
    const many = (await issue(other, await signedInstallation(other, 12))).bytes;
    expect(imageObjectCount(many)).toBe(12);
    expect(pdfPageTexts(many).length).toBeGreaterThan(pdfPageTexts(one).length);
    const boxes = drawnImages(many);
    expect(boxes).toHaveLength(12);
    for (const box of boxes) {
      expect(box.width).toBeGreaterThan(240);
      // Above the footer band (margin 40 + footer 44) and on the page, clear of its top edge.
      expect(box.y).toBeGreaterThanOrEqual(84);
      expect(box.y + box.height).toBeLessThanOrEqual(842 - 30);
    }
  });

  it('previews as the same Delivery Note it will be issued as', async () => {
    const signed = await signedInstallation(harness);
    const previewed = await preview(harness, signed);
    expect(previewed.fileName).toBe('EJE-1048-Installation-Delivery-Note.pdf');
    const text = pdfPlainText(previewed.bytes);
    expect(text).toContain('DELIVERY NOTE — INSTALLATION');
    expect(text).toContain('Light curtain and guarding fitted');
    const view = (await loadJobView(harness.repos, signed.jobNumber))!;
    const model = buildJobCardModel({ ...view, generatedAt: clock.now() });
    expect(model.documentTitle).toBe(INSTALLATION_DELIVERY_NOTE_TITLE);
    expect(model.charges).toBeNull();
    expect(model.company.registrationLine).not.toContain('VAT');
  });

  it('lays out with nothing drawn over anything else, with one photograph or twelve', async () => {
    const one = (await issue(harness, await signedInstallation(harness, 1))).bytes;
    const other = buildHarness();
    const many = (await issue(other, await signedInstallation(other, 12))).bytes;
    expect(inspectPdf(one).problems).toEqual([]);
    expect(inspectPdf(many).problems).toEqual([]);
  });

  it('a download returns the issued bytes, unchanged, every time', async () => {
    const { bytes } = await issue(harness, await signedInstallation(harness));
    const again = await loadFinalDocumentFile(harness.as(technician), 'EJE-1048');
    expect(sha256(again.bytes)).toBe(sha256(bytes));
  });
});

describe('an Installation issued BEFORE this release keeps its stored job card', () => {
  it('returns the stored bytes byte-for-byte, and names it a job card still', async () => {
    const harness = buildHarness();
    const seeded = (await harness.repos.jobs.findByJobNumber('EJE-1039'))!;
    expect(seeded.jobType).toBe('installation');
    expect(seeded.finalDocument?.fileName).toBe('EJE-1039-Final-Job-Card.pdf');
    expect(presentsAsInstallationDeliveryNote(seeded)).toBe(false);

    // What was issued then: a job card with its prices, stored as issued.
    const view = (await loadJobView(harness.repos, 'EJE-1039'))!;
    const issued = await new SimulatedPdfService(clock).render(view, 'final', seeded.finalDocument!.generatedAt);
    await harness.services.storage.putDocument({
      storageKey: seeded.finalDocument!.storageKey,
      fileName: seeded.finalDocument!.fileName,
      contentType: 'application/pdf',
      bytes: issued.bytes,
      renderer: 3,
      backfilled: false,
    });

    const served = await loadFinalDocumentFile(harness.as(seedUser('user-master-elmarie')), 'EJE-1039');
    expect(sha256(served.bytes)).toBe(sha256(issued.bytes));
    expect(served.fileName).toBe('EJE-1039-Final-Job-Card.pdf');
    const text = pdfPlainText(served.bytes);
    expect(text).toContain('JOB CARD');
    expect(text).not.toContain('DELIVERY NOTE — INSTALLATION');
    expect(documentTitleFor(seeded)).toBe('Signed Job Card');
  });

  it('a seeded one with no bytes yet is backfilled as the job card it was, and then never changes', async () => {
    const harness = buildHarness();
    const master = harness.as(seedUser('user-master-elmarie'));
    const first = await loadFinalDocumentFile(master, 'EJE-1039');
    const text = pdfPlainText(first.bytes);
    expect(text).toContain('JOB CARD');
    expect(text).toMatch(/\bTotal\b/u);
    const second = await loadFinalDocumentFile(master, 'EJE-1039');
    expect(sha256(second.bytes)).toBe(sha256(first.bytes));
  });
});

describe('every other job type keeps its priced job card', () => {
  it.each(['breakdown', 'service'] as const)('a %s is issued as a Job Card, with its prices', async (jobType) => {
    const harness = buildHarness();
    const { job, bytes } = await issue(harness, await signedInstallation(harness, 1, jobType));
    expect(job.finalDocument?.fileName).toBe('EJE-1048-Final-Job-Card.pdf');
    const text = pdfPlainText(bytes);
    expect(text).toContain('JOB CARD');
    expect(text).not.toContain('DELIVERY NOTE — INSTALLATION');
    expect(text).toMatch(CURRENCY);
    expect(text).toMatch(/\bTotal\b/u);
    expect(text).toMatch(/VAT @/u);
    expect(text).toContain('Rate');
    expect(documentTitleFor(job)).toBe('Signed Job Card');
  });

  it('their canonical model has no installation block, so their signing identity is unchanged', async () => {
    const harness = buildHarness();
    const view = (await loadJobView(harness.repos, 'EJE-1048'))!;
    const model = buildJobCardModel({ ...view, generatedAt: clock.now() });
    expect('installation' in model).toBe(false);
    expect(model.documentTitle).toBe('Job Card');
    expect(await documentIdentityFor(view)).toMatch(/^jcm1:/u);
  });
});
