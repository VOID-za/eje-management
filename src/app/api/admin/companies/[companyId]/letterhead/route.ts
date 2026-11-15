import { uploadRoute } from '@/server/api/handler';
import { MAX_LETTERHEAD_BYTES, uploadCompanyLetterhead } from '@/application/company-letterhead';

/**
 * `POST /api/admin/companies/:companyId/letterhead` — upload or replace the
 * company's official letterhead. LETTERHEAD-1.
 *
 * The same people as the company's details (`settings.rates`), enforced by
 * `uploadCompanyLetterhead`, which also decides what the file IS from its
 * bytes — a PNG or a JPEG the documents can embed, at most 2 MB — and audits
 * it. The body is bounded at that size before it is read. Removing one is
 * `…/letterhead/remove`.
 */
export const POST = uploadRoute({
  operation: 'companies.letterhead.upload',
  maxBytes: MAX_LETTERHEAD_BYTES,
  handler: async (context) =>
    uploadCompanyLetterhead(context.operation, context.params.companyId ?? '', {
      fileName: context.file.name,
      bytes: new Uint8Array(await context.file.arrayBuffer()),
    }),
});
