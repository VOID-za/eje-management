import { z } from 'zod';
import { TIMESHEET_CORRECTION_REASON_LIMIT } from '@/domain';
import { WorkflowError } from '@/application/errors';
import { writeRoute } from '@/server/api/handler';

/**
 * DECIDING A CORRECTION OF A SENT TIMESHEET (TS-16) — REFUSED. FORM-LIFECYCLE-2 (the owner, 11 November 2026): "Once
 * the submission succeeds … no correction requests … No Office editing. No Master editing. No Senior Tech editing.
 * This is final." Asking for one was refused by TS-FINAL-1; deciding one — which would make it the version in force of
 * a submitted timesheet — is refused here, for everybody. A correction decided before stays in the record as it was.
 */
export const POST = writeRoute({
  operation: 'timesheets.correction.decide',
  schema: z
    .object({
      decision: z.enum(['accept', 'reject']),
      note: z.string().max(TIMESHEET_CORRECTION_REASON_LIMIT + 100).optional(),
    })
    .strict(),
  handler: async () => {
    throw new WorkflowError('A submitted timesheet is final.', [
      { code: 'timesheet_submitted_final', message: 'Nothing in a submitted timesheet is changed — not by a correction, and not by anybody.' },
    ]);
  },
});
