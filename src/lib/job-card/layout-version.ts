/**
 * WHICH JOB-CARD LAYOUT A DOCUMENT IS SHOWN IN.
 *
 * JOB-CARD-2 (the owner, 16 November 2026) redesigned the job card: a Date column in the labour,
 * travel and parts table, the contact details grouped, Job Details to the right, the write-up's
 * headings and two columns, the customer's acceptance under the totals on the right, and the
 * photographs on a page of their own. Documents issued in it record renderer 6.
 *
 * JOB-CARD-3 (the owner, 17 November 2026) corrected it: the EJE letterhead across the page's full
 * width with the document's name and number in its top-right corner; the machine shown by its name
 * and number only; and on a Parts Collection Note the Date column filled with the day the note was
 * raised and "Released by" — who handed the parts over — in place of the technician. Documents issued
 * in it record renderer 7.
 *
 * JOB-CARD-4 (the owner, 21 November 2026) aligned that header and nothing else: the P.O. Box block's
 * last line ("1465") on the Email line's baseline, and the document's number smaller, on the company
 * name's line, against the right edge (its label stays above it). Documents issued in it record 8.
 *
 * An ISSUED document is never re-rendered, so a job card issued in an earlier layout keeps its
 * stored PDF — and the screen beside it must show that same layout. Each renderer number is a marker
 * (nothing is migrated; RENDERER_VERSION — the backfill's comparison — is unchanged), above every
 * number recorded before it (job card 1–5, then 6).
 */
export const JOB_CARD_2_RENDERER = 6;
export const JOB_CARD_3_RENDERER = 7;
export const JOB_CARD_LAYOUT_RENDERER = 8;

/**
 * The editions of the current job-card renderer: 6 is JOB-CARD-2 exactly as issued on 17 November
 * 2026 (v1.15.0); 7 is JOB-CARD-3 exactly as issued from 18 November 2026 (v1.16.0); 8 is today's.
 * Everything older is the frozen V5 renderer.
 */
export type JobCardEdition = 6 | 7 | 8;

export type JobCardLayout = 'v5' | JobCardEdition;

/** The layout a job's document is shown in: nothing issued yet → today's; else the one it was issued in. */
export const jobCardLayoutOf = (finalDocument: { readonly renderer: number | null } | null): JobCardLayout => {
  if (finalDocument === null || finalDocument.renderer === JOB_CARD_LAYOUT_RENDERER) return JOB_CARD_LAYOUT_RENDERER;
  if (finalDocument.renderer === JOB_CARD_3_RENDERER) return JOB_CARD_3_RENDERER;
  if (finalDocument.renderer === JOB_CARD_2_RENDERER) return JOB_CARD_2_RENDERER;
  return 'v5';
};

/** Whether a job's document is shown by the current renderer (either of its editions), not the frozen V5. */
export const showsCurrentJobCardLayout = (finalDocument: { readonly renderer: number | null } | null): boolean =>
  jobCardLayoutOf(finalDocument) !== 'v5';

/** The current renderer's edition for a job's document (today's for anything not issued as 6 or 7). */
export const jobCardEditionOf = (finalDocument: { readonly renderer: number | null } | null): JobCardEdition => {
  const layout = jobCardLayoutOf(finalDocument);
  return layout === 'v5' ? JOB_CARD_LAYOUT_RENDERER : layout;
};

/** JOB-CARD-3's corrections (full-width header, machine name and number, the collection note's Date and releaser): 7 on. */
export const hasJobCard3Layout = (edition: JobCardEdition): boolean => edition >= JOB_CARD_3_RENDERER;

/** JOB-CARD-4's header alignment ("1465" on the Email line; the number inline with the company name): 8 on. */
export const hasAlignedHeader = (edition: JobCardEdition): boolean => edition >= JOB_CARD_LAYOUT_RENDERER;
