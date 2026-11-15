import { beforeEach, describe, expect, it } from 'vitest';
import { calculateJobTotals, partsLockedAfterCompletion, type Job } from '@/domain';
import { businessToday } from '@/lib/business-time';
import { pdfPlainText } from '@/lib/pdf/inspect';
import { SimulatedPdfService } from '@/services/simulated/pdf';
import { renderJobCardPdf } from '@/components/jobs/job-card-pdf';
import {
  acceptJob,
  addLabour,
  addPart,
  captureSignature,
  removeLineItem,
  saveCompletionReport,
  startCompletion,
  startSignature,
  updatePart,
} from './job-operations';
import { createJob } from './job-creation';
import { loadJobView } from './job-view';
import { buildHarness, seedUser, type Harness } from './test-harness';

/**
 * BD-PARTS-1 (the owner, 15 November 2026): a Breakdown's parts add, change and remove in the completion
 * wizard without cancelling completion — saved, read back, costed and printed — and lock at the customer
 * signature, exactly as Test & Repair's do (TR-PARTS-2). Service and Installation keep TR-01.
 *
 * Every assertion goes through the application operations the routes call, and the job is re-read from
 * the repository rather than trusted from the value an operation returned.
 */

const sipho = seedUser('user-tech-sipho');
const master = seedUser('user-master-elmarie');
const riaan = seedUser('user-tech-riaan');

let harness: Harness;
beforeEach(() => {
  harness = buildHarness();
});

const today = businessToday();
const locked = { violations: [{ code: 'parts_locked_after_completion' }] };

/** A Breakdown, accepted and worked by Sipho, with one part before completion, in `completion`. */
const breakdownInCompletion = async (): Promise<Job> => {
  const [customer] = await harness.repos.customers.list();
  const sites = await harness.repos.customers.listSites(customer!.id);
  const contacts = await harness.repos.customers.listContacts(customer!.id);
  const machines = await harness.repos.machines.list();
  let job = await createJob(harness.as(master), {
    customerId: customer!.id, siteId: sites[0]!.id, contactId: contacts[0]!.id,
    machineId: machines.find((machine) => machine.siteId === sites[0]!.id)?.id ?? null,
    jobType: 'breakdown', priority: 'normal', scheduledDate: null, scheduledEndDate: null, additionalTechnicianIds: [],
    orderNumber: 'PO-BD-1', referenceNumber: '', deliveryNote: '', faultDescription: 'Spindle drive alarm 9', primaryTechnicianId: sipho.id,
    courierCollection: false, dateReceived: null, quoteNumber: '',
  });
  const tech = harness.as(sipho);
  job = await acceptJob(tech, job);
  job = await addLabour(tech, job, { date: today, rateType: 'normal', hours: 2, description: '' });
  job = await addPart(tech, job, { partNumber: 'BRG-6205', description: 'Bearing 6205', quantity: 1, unitPrice: 9_500 });
  job = await saveCompletionReport(tech, job, { ...job.completionReport, workPerformed: 'Replaced the bearing and the drive fuse.' });
  job = await startCompletion(tech, job);
  expect(job.status).toBe('completion');
  return job;
};

const reread = async (job: Job): Promise<Job> => (await harness.repos.jobs.findById(job.id))!;
const partList = (job: Job) => job.parts.map((part) => [part.partNumber, part.quantity, part.unitPrice]);
const partEvents = async (job: Job) =>
  (await harness.repos.activity.list()).filter((event) => event.jobId === job.id && ['part_added', 'line_item_removed'].includes(event.type));

describe('BD-PARTS-1 — the rule', () => {
  it('a Breakdown and a Test & Repair keep parts open in completion and lock at the signature; Service and Installation lock in completion; a Parts job never by status', () => {
    for (const jobType of ['breakdown', 'test_and_repair'] as const) {
      expect(partsLockedAfterCompletion({ jobType, status: 'in_progress' })).toBe(false);
      expect(partsLockedAfterCompletion({ jobType, status: 'completion' })).toBe(false);
      expect(partsLockedAfterCompletion({ jobType, status: 'customer_signature' })).toBe(true);
    }
    for (const jobType of ['service', 'installation'] as const) {
      expect(partsLockedAfterCompletion({ jobType, status: 'in_progress' })).toBe(false);
      expect(partsLockedAfterCompletion({ jobType, status: 'completion' })).toBe(true);
      expect(partsLockedAfterCompletion({ jobType, status: 'customer_signature' })).toBe(true);
    }
    expect(partsLockedAfterCompletion({ jobType: 'parts', status: 'completion' })).toBe(false);
  });
});

describe('BD-PARTS-1 — a Breakdown in completion', () => {
  it('adds one part without cancelling completion; it is saved and read back', async () => {
    let job = await breakdownInCompletion();
    job = await addPart(harness.as(sipho), job, { partNumber: 'FUSE-10A', description: 'Fuse 10A', quantity: 2, unitPrice: 1_200 });
    expect(job.status).toBe('completion');
    const stored = await reread(job);
    expect(stored.status).toBe('completion');
    expect(partList(stored)).toEqual([['BRG-6205', 1, 9_500], ['FUSE-10A', 2, 1_200]]);
  });

  it('adds several, changes a quantity and removes one; the stored job, its costing and its PDF carry exactly the final list', async () => {
    const tech = harness.as(sipho);
    let job = await breakdownInCompletion();
    job = await addPart(tech, job, { partNumber: 'FUSE-10A', description: 'Fuse 10A', quantity: 2, unitPrice: 1_200 });
    job = await addPart(tech, job, { partNumber: 'RLY-24V', description: 'Relay 24V', quantity: 1, unitPrice: 4_300 });
    job = await addPart(tech, job, { partNumber: 'CBL-3M', description: 'Encoder cable 3m', quantity: 1, unitPrice: 22_000 });
    const relay = job.parts.find((part) => part.partNumber === 'RLY-24V')!;
    job = await updatePart(tech, job, relay.id, { partNumber: 'RLY-24V', description: 'Relay 24V', quantity: 3, unitPrice: 4_300 });
    job = await removeLineItem(tech, job, 'part', job.parts.find((part) => part.partNumber === 'CBL-3M')!.id);

    // Refreshed and reopened: what the repository holds, and the view the job page loads.
    const stored = await reread(job);
    expect(stored.status).toBe('completion');
    expect(partList(stored)).toEqual([['BRG-6205', 1, 9_500], ['FUSE-10A', 2, 1_200], ['RLY-24V', 3, 4_300]]);
    const view = (await loadJobView(harness.repos, job.jobNumber))!;
    expect(view.job.parts.map((part) => part.partNumber)).toEqual(['BRG-6205', 'FUSE-10A', 'RLY-24V']);

    // Costing: the parts total is exactly the final lines (1×9 500 + 2×1 200 + 3×4 300 cents).
    const totals = calculateJobTotals(stored, await harness.repos.settings.get());
    expect(totals.partsTotal).toBe(9_500 + 2 * 1_200 + 3 * 4_300);

    // The job card PDF the customer will sign: the final parts, not the removed one.
    const clock = { now: () => '2026-11-15T10:00:00.000Z' };
    const text = pdfPlainText((await renderJobCardPdf(view, new SimulatedPdfService(clock), clock, new Map())).bytes);
    for (const shown of ['BRG-6205', 'FUSE-10A', 'RLY-24V']) expect(text).toContain(shown);
    expect(text).not.toContain('CBL-3M');

    // Audited: three adds and one amendment (part_added, "Part amended"), one removal — each by Sipho.
    const events = await partEvents(job);
    expect(events.filter((event) => event.type === 'part_added' && event.summary.startsWith('Part captured')).map((event) => event.summary))
      .toEqual(expect.arrayContaining(['Part captured: FUSE-10A', 'Part captured: RLY-24V', 'Part captured: CBL-3M']));
    expect(events.some((event) => event.summary === 'Part amended: RLY-24V' && /x1, now x3/u.test(event.detail))).toBe(true);
    expect(events.filter((event) => event.type === 'line_item_removed')).toHaveLength(1);
    for (const event of events) expect(event.actorId).toBe(sipho.id);
  });

  it('the office may still capture administratively in completion, under the same rule', async () => {
    let job = await breakdownInCompletion();
    job = await addPart(harness.as(master), job, { partNumber: 'OFFICE-1', description: 'Office add', quantity: 1, unitPrice: 100 });
    job = await removeLineItem(harness.as(master), job, 'part', job.parts.find((part) => part.partNumber === 'OFFICE-1')!.id);
    expect(partList(await reread(job))).toEqual([['BRG-6205', 1, 9_500]]);
  });

  it('a technician who is not on the job is still refused (the rule opened parts, not the job)', async () => {
    const job = await breakdownInCompletion();
    await expect(addPart(harness.as(riaan), job, { partNumber: 'X', description: 'not mine', quantity: 1, unitPrice: 1 }))
      .rejects.toMatchObject({ violations: [{ code: 'not_on_job' }] });
    expect(partList(await reread(job))).toEqual([['BRG-6205', 1, 9_500]]);
  });

  it('locks once the customer is shown the job card: add, change and remove are refused, and nothing changes', async () => {
    const tech = harness.as(sipho);
    let job = await breakdownInCompletion();
    job = await addPart(tech, job, { partNumber: 'FUSE-10A', description: 'Fuse 10A', quantity: 2, unitPrice: 1_200 });
    job = await startSignature(tech, job);
    expect(job.status).toBe('customer_signature');
    await expect(addPart(tech, job, { partNumber: 'LATE', description: 'late', quantity: 1, unitPrice: 1 })).rejects.toMatchObject(locked);
    await expect(updatePart(tech, job, job.parts[0]!.id, { partNumber: 'BRG-6205', description: 'Bearing 6205', quantity: 5, unitPrice: 9_500 })).rejects.toMatchObject(locked);
    await expect(removeLineItem(tech, job, 'part', job.parts[0]!.id)).rejects.toMatchObject(locked);
    // The office cannot get round it either.
    await expect(addPart(harness.as(master), job, { partNumber: 'LATE', description: 'late', quantity: 1, unitPrice: 1 })).rejects.toMatchObject(locked);
    expect(partList(await reread(job))).toEqual([['BRG-6205', 1, 9_500], ['FUSE-10A', 2, 1_200]]);
  });

  it('after the signature the signed record is final: every part change is refused', async () => {
    const tech = harness.as(sipho);
    let job = await breakdownInCompletion();
    job = await startSignature(tech, job);
    job = await captureSignature(tech, job, { customerName: 'Pieter', customerSurname: 'Nel', strokeData: 'M0.1,0.5 L0.9,0.5' });
    expect(job.signature).not.toBeNull();
    for (const attempt of [
      () => addPart(tech, job, { partNumber: 'LATE', description: 'late', quantity: 1, unitPrice: 1 }),
      () => updatePart(tech, job, job.parts[0]!.id, { partNumber: 'BRG-6205', description: 'Bearing 6205', quantity: 9, unitPrice: 1 }),
      () => removeLineItem(tech, job, 'part', job.parts[0]!.id),
      () => addPart(harness.as(master), job, { partNumber: 'LATE', description: 'late', quantity: 1, unitPrice: 1 }),
    ]) {
      // The signed-record rule answers first, for everybody: the job card is final.
      await expect(attempt()).rejects.toMatchObject({ violations: [{ code: 'job_finalized' }] });
    }
    expect(partList(await reread(job))).toEqual([['BRG-6205', 1, 9_500]]);
  });

  it('a stale copy cannot bring back a part that was removed: an update of a removed line is refused', async () => {
    const tech = harness.as(sipho);
    let job = await breakdownInCompletion();
    job = await addPart(tech, job, { partNumber: 'FUSE-10A', description: 'Fuse 10A', quantity: 2, unitPrice: 1_200 });
    const fuse = job.parts.find((part) => part.partNumber === 'FUSE-10A')!;
    job = await removeLineItem(tech, job, 'part', fuse.id);
    // The routes re-read the job before every change; the operation is given what the server now holds.
    const current = await reread(job);
    await expect(updatePart(tech, current, fuse.id, { partNumber: 'FUSE-10A', description: 'Fuse 10A', quantity: 9, unitPrice: 1_200 }))
      .rejects.toThrow('That part line no longer exists on this job.');
    expect(partList(await reread(job))).toEqual([['BRG-6205', 1, 9_500]]);
  });
});

/*
 * Service and Installation keep TR-01 through the REAL operations in `reviewer-decisions.test.ts`
 * ("TR-01 extended", its else branch: add, change, remove and the office all refused in completion and at the
 * signature); the pure rule for every type is asserted at the top of this file.
 */
