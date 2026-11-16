/**
 * WHICH JOB-CARD LAYOUT A DOCUMENT IS SHOWN IN. JOB-CARD-2 (the owner, 16 November 2026).
 *
 * The job card was redesigned: a Date column in the labour, travel and parts table, the contact
 * details grouped, Job Details to the right, the write-up's headings and two columns, the customer's
 * acceptance under the totals on the right, and the photographs on a page of their own.
 *
 * An ISSUED document is never re-rendered, so a job card issued before the redesign keeps its stored
 * PDF — and the screen beside it must show that same layout. So an issue drawn in the new layout
 * records this renderer number on its stored file and on the job's record (a marker, as
 * MASTER_LETTERHEAD_RENDERER was: nothing is migrated, RENDERER_VERSION — the backfill's comparison —
 * is unchanged). 6 is above every number recorded before it (job card 1–5).
 */
export const JOB_CARD_LAYOUT_RENDERER = 6;

/** Whether a job's document is shown in the current layout: nothing issued yet, or issued in it. */
export const showsCurrentJobCardLayout = (finalDocument: { readonly renderer: number | null } | null): boolean =>
  finalDocument === null || finalDocument.renderer === JOB_CARD_LAYOUT_RENDERER;
