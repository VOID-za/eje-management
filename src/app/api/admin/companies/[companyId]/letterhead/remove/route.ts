import { z } from 'zod';
import { writeRoute } from '@/server/api/handler';
import { removeCompanyLetterhead } from '@/application/company-letterhead';

/**
 * `POST /api/admin/companies/:companyId/letterhead/remove` — new documents of
 * this company go back to the text header. LETTERHEAD-1. `settings.rates`,
 * audited; documents already issued keep the letterhead they were printed on.
 */
export const POST = writeRoute({
  operation: 'companies.letterhead.remove',
  schema: z.object({}).strict(),
  handler: (context) => removeCompanyLetterhead(context.operation, context.params.companyId ?? ''),
});
