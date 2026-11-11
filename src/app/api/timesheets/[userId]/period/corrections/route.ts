import { z } from 'zod';
import { TIMESHEET_CORRECTION_MAX_LINES, TIMESHEET_CORRECTION_REASON_LIMIT, TIMESHEET_PERIOD_COMMENT_LIMIT } from '@/domain';
import { WorkflowError } from '@/application/errors';
import { writeRoute } from '@/server/api/handler';
import { timesheetLineSchema } from '@/server/api/timesheet-line';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Expected a date as YYYY-MM-DD');

/**
 * ASKING TO CORRECT A SENT TIMESHEET (TS-16) — REFUSED. TS-FINAL-1 (the owner, 11 November 2026): "A submitted
 * timesheet can't be edited. If it's submitted, it's done for. No more changes allowed after submission." Nobody may
 * ask for one any more, whoever they are; the screen that offered it is gone. A correction already asked for before
 * this is still decided on its own route, and every decided one stays in the record as it was. Changing a completed
 * form BEFORE it is submitted (withdraw, then correct) is unaffected.
 */
export const POST = writeRoute({
  operation: 'timesheets.correction.request',
  schema: z
    .object({
      from: day,
      to: day,
      periodId: z.string().min(1).max(100).optional(),
      reason: z.string().max(TIMESHEET_CORRECTION_REASON_LIMIT + 100),
      comment: z.string().max(TIMESHEET_PERIOD_COMMENT_LIMIT + 100),
      lines: z.array(timesheetLineSchema).max(TIMESHEET_CORRECTION_MAX_LINES),
    })
    .strict(),
  handler: async () => {
    throw new WorkflowError('A submitted timesheet is final.', [
      {
        code: 'timesheet_submitted_final',
        message: 'Once a timesheet is submitted it is not changed. A completed form can still be withdrawn and corrected before it is submitted.',
      },
    ]);
  },
});
