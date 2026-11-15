import { defaultCompanyLetterhead } from '@/application/company-letterhead';
import { z } from 'zod';
import { loadAttendanceDocument } from '@/application/attendance-document';
import { onePageOrRefuse } from '@/application/payroll-pdf';
import { downloadRoute, parseWith } from '@/server/api/handler';
import { renderAttendancePdf } from '@/services/simulated/attendance-pdf';

/** The month's attendance PDF — ONE page, named "JC ATTEN OCTOBER.pdf" (PAY-01, PAY-03, PAY-04). Writes nothing. */
export const GET = downloadRoute('payroll.month.attendance.pdf', async (context) => {
  const { version } = parseWith(
    z.object({ version: z.enum(['current', 'submitted']).optional() }).strict(),
    Object.fromEntries(context.request.nextUrl.searchParams),
  );
  const document = await loadAttendanceDocument({ repos: context.repos, services: context.services, actor: context.actor.user }, context.params.userId ?? '', context.params.month ?? '', version ?? 'current');
  // LETTERHEAD-1: EJE's own paperwork, on EJE's uploaded letterhead when it has one.
  const letterhead = await defaultCompanyLetterhead(context);
  const rendered = onePageOrRefuse(() => renderAttendancePdf(document, { generatedAt: context.services.clock.now(), letterhead }));
  return { fileName: rendered.fileName, contentType: 'application/pdf', body: rendered.bytes, headers: { 'X-Page-Count': String(rendered.pageCount) } };
});
