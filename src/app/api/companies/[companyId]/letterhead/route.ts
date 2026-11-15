import { asCompanyId } from '@/domain';
import { downloadCompanyLetterheadFile } from '@/application/company-letterhead';
import { downloadRoute } from '@/server/api/handler';
import { notFound } from '@/server/api/errors';

/**
 * `GET /api/companies/:companyId/letterhead` — the company's letterhead image.
 * LETTERHEAD-1.
 *
 * For the browser's own renders: the job card preview and PDF button draw the
 * document in the page, so they need the image the server would print, read
 * by the company's id and never by a storage key. Anyone signed in may read
 * it — a technician previews the job cards they work on, and a letterhead is
 * printed on every document a customer is handed. 404 when the company has
 * none; 422 `document_damaged` (as every other stored document) when its
 * stored bytes are damaged. Never cached by an intermediary; the screen asks
 * for it by checksum (`?v=`), so a replaced letterhead is never served from a
 * stale copy.
 */
export const GET = downloadRoute('companies.letterhead', async (context) => {
  const file = await downloadCompanyLetterheadFile(context, asCompanyId(context.params.companyId ?? ''));
  if (file === null) throw notFound('That company has no letterhead.');
  return {
    fileName: file.contentType === 'image/png' ? 'letterhead.png' : 'letterhead.jpg',
    contentType: file.contentType,
    headers: { 'x-letterhead-sha256': file.sha256 },
    body: file.bytes,
  };
});
