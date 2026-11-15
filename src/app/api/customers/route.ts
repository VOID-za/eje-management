import { readRoute, writeRoute } from '@/server/api/handler';
import { createCustomerSchema, runCreateCustomer } from '@/server/api/commands/registers';
import { customersView } from '@/server/api/views';

/** MULTI-CO-1: `?company=wd-hearn-jhb` lists only that company's customers. */
export const GET = readRoute('customers.list', (context) =>
  customersView(
    { repos: context.repos, services: context.services, actor: context.actor.user },
    context.request.nextUrl.searchParams.get('company'),
  ),
);

export const POST = writeRoute({
  operation: 'customers.create',
  schema: createCustomerSchema,
  handler: (context) =>
    runCreateCustomer(
      {
        repos: context.repos,
        services: context.services,
        actor: context.actor.user,
        operation: context.operation,
      },
      context.input,
    ),
});
