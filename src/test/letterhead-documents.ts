import type { IsoDateTime } from '@/domain';
import { loadJobView } from '@/application/job-view';
import { buildAttendanceRows, type AttendanceDocument } from '@/application/attendance-document';
import type { TimesheetDocument } from '@/application/timesheets';
import type { DeliveryNoteModel } from '@/lib/job-card/delivery-note';
import { buildHarness } from '@/application/test-harness';
import type { CorrectionDocumentSource, FinalDocumentSource } from '@/services/ports';

/**
 * LETTERHEAD-1: one fixed input for every generator, so a test can render each
 * document with and without a letterhead and compare. Test-only.
 *
 * The seed's dates are relative to today, so the caller freezes the clock
 * (`vi.setSystemTime(FROZEN_AT)`) before building these: the same inputs on any
 * day, which is what lets a test pin today's exact bytes.
 */
export const FROZEN_AT = new Date('2026-11-15T08:00:00.000Z');
export const GENERATED_AT = '2026-11-15T08:30:00.000Z' as IsoDateTime;

/** The seeded jobs each job document is drawn from. */
export const JOB_DOCUMENTS = {
  /** A breakdown issued as a job card. */
  jobCard: 'EJE-1044',
  /** A parts collection issued as its collection note. */
  partsCollectionNote: 'EJE-1062',
  /** An Installation not yet issued: drawn as its Installation Delivery Note. */
  installationDeliveryNote: 'EJE-1050',
} as const;

export const jobSource = async (jobNumber: string): Promise<FinalDocumentSource> => {
  const harness = buildHarness();
  const view = await loadJobView(harness.repos, jobNumber);
  if (view === null) throw new Error(`no seeded job ${jobNumber}`);
  return {
    job: view.job,
    customer: view.customer,
    site: view.site,
    contact: view.contact,
    machine: view.machine,
    settings: view.settings,
    company: view.company,
    checklistTemplate: view.checklistTemplate,
    users: view.users,
    photoImages: new Map(),
  };
};

export const correctionSource: CorrectionDocumentSource = {
  company: {
    name: 'EJE Industrial Electronics',
    address: '1 Test Road, Vereeniging',
    contactLine: 'Tel 016 000 0000 · office@example.test',
    registrationLine: 'Reg. 2000/000000/07 · VAT 4000000000',
  },
  jobNumber: 'EJE-1044',
  customerName: 'ABC Engineering (Pty) Ltd',
  machineDescription: 'Amada press brake',
  original: { fileName: 'EJE-1044-Final-Job-Card.pdf', issuedAt: '1 June 2026', signed: true },
  correction: {
    sequence: 1,
    reason: 'The labour line carried the wrong date.',
    narrative: 'The labour was performed on 2 June 2026, not 1 June 2026.',
    areas: ['labour'],
    raisedBy: 'Elmarie Coetzee',
    raisedAt: '3 June 2026',
    acknowledgementRequired: false,
    acknowledged: null,
  },
  simulated: false,
};

export const deliveryNoteModel: DeliveryNoteModel = {
  title: 'Delivery Note',
  company: { name: 'EJE Industrial Electronics', address: '1 Test Road, Vereeniging', contactLine: '016 000 0000 · office@example.test' },
  jobNumber: 'EJE-9001',
  deliverTo: ['Customer (Pty) Ltd', '2 Plant Road'],
  details: [{ label: 'Job number', value: 'EJE-9001' }],
  items: [{ kind: 'Part', partNumber: 'P-1', description: 'Relay', quantity: '1' }],
  totalQuantity: '1',
  priceNote: 'No prices on this copy.',
  signature: null,
  footer: 'EJE Industrial Electronics · Delivery Note',
};

/** A timesheet of `rows` lines: 10 fit one page, 400 run to several. */
export const timesheet = (rows: number): TimesheetDocument => ({
  companyName: 'EJE Industrial Electronics',
  technicianName: 'Test Technician',
  fileName: 'TEST.pdf',
  from: '2026-10-01',
  to: '2026-10-31',
  periodLabel: 'Oct 2026',
  rows: Array.from({ length: rows }, (_, index) => ({
    date: `2026-10-${String((index % 28) + 1).padStart(2, '0')}`,
    weekday: 'Mon',
    customer: 'Customer',
    recorded: true,
    overtimeHours: 1,
    doubleHours: 0,
    calloutAmount: 0,
    calloutShared: false,
    internalKm: 0,
    customerKm: 0,
    historicalNormalHours: 0,
    historicalCallouts: 0,
  })),
  comment: 'A comment.',
  totals: { overtimeHours: rows, doubleHours: 0, calloutAmount: 0, internalKm: 0, customerKm: 0, historicalNormalHours: 0, historicalCallouts: 0 },
  submittedAt: '2026-10-31T15:00:00.000Z',
  submittedByName: 'Test Technician',
  versionLabel: 'Original',
  inForce: true,
  absences: [],
});

export const attendance = (): AttendanceDocument => ({
  companyName: 'EJE Industrial Electronics',
  technicianName: 'Test Technician',
  fileName: 'TEST ATTEN OCTOBER.pdf',
  month: '2026-10',
  monthLabel: 'October 2026',
  ...buildAttendanceRows(
    Array.from({ length: 31 }, (_, index) => ({
      date: `2026-10-${String(index + 1).padStart(2, '0')}`,
      status: index % 7 === 6 ? null : ('present' as const),
      absenceReason: null,
      note: '',
    })),
    '2026-10-31',
  ),
  submittedAt: '2026-10-31T15:00:00.000Z',
  submittedByName: 'Test Technician',
  versionLabel: 'Original',
  inForce: true,
  changedAfterSubmission: [],
});

