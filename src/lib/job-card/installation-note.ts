import type { Job } from '@/domain';

/**
 * THE INSTALLATION DELIVERY NOTE. INSTALL-DN-1 (the owner, 7–8 November 2026).
 *
 * An Installation job stays an Installation job — its type, its mandatory
 * checklist, its workflow, assignment, status, audit, pricing on the job and
 * invoicing are all unchanged. Only the DOCUMENT the customer is handed
 * changes: a price-less "Delivery Note — Installation" (what was installed,
 * who did it and for how long, the checklist as completed, the photographs and
 * the customer's sign-off) instead of the priced job card.
 *
 * THIS IS THE ONE PLACE THAT DECIDES. The canonical model
 * (`buildJobCardModel`), the PDF descriptor (`SimulatedPdfService`), the
 * preview button and the customer email's document title all ask it, so the
 * preview, the download, the issued copy, the email attachment and the
 * offline-signature identity cannot disagree.
 *
 * HISTORY IS NOT REWRITTEN. An Installation already issued before this release
 * carries a final-document record whose file name is the job card's
 * (`…-Final-Job-Card.pdf`): it stays a job card — its stored bytes are returned
 * exactly as written, and if a seeded one is ever backfilled it is drawn as the
 * job card it was. Only an Installation not yet issued (no final document), or
 * one issued as an Installation Delivery Note, is drawn as one. The record on
 * the job is the evidence of which document was issued; nothing else is
 * consulted, so no migration is needed.
 */

export const INSTALLATION_DELIVERY_NOTE_TITLE = 'Delivery Note — Installation';

/** The file name the Installation Delivery Note is issued and previewed under. */
export const installationDeliveryNoteFileName = (jobNumber: string, final: boolean): string =>
  `${jobNumber}-${final ? 'Final-' : ''}Installation-Delivery-Note.pdf`;

const ISSUED_AS_DELIVERY_NOTE = /-Installation-Delivery-Note\.pdf$/u;

/** Whether this job's customer-facing document is the Installation Delivery Note. */
export const presentsAsInstallationDeliveryNote = (job: Pick<Job, 'jobType' | 'finalDocument'>): boolean => {
  if (job.jobType !== 'installation') return false;
  // Not issued yet: every Installation document from this release on.
  if (job.finalDocument === null) return true;
  // Issued: whatever was issued. A job card issued before INSTALL-DN-1 stays one.
  return ISSUED_AS_DELIVERY_NOTE.test(job.finalDocument.fileName);
};
