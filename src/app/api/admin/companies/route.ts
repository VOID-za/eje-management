import { readRoute } from '@/server/api/handler';
import { listCompanies } from '@/application/company-operations';

/**
 * The companies the system serves (MULTI-CO-1): EJE and WD Hearn JHB, with
 * their details, notification sender, numbering and rates. The office's —
 * refused server-side for a role without `settings.rates`.
 */
export const GET = readRoute('companies.list', (context) =>
  listCompanies({ repos: context.repos, services: context.services, actor: context.actor.user }),
);
