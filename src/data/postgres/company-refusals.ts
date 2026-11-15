import type { RuleViolation } from '@/domain';

/**
 * THE DATABASE'S OWN COMPANY REFUSALS, IN THE APPLICATION'S WORDS. MULTI-CO-1.
 *
 * Migration 0058 refuses, in the database, a job whose company is not one of
 * its customer's companies (`jobs_customer_has_company`) and taking a company
 * off a customer that has work for it (`customer_companies_in_use`). The
 * application asks both questions first and answers them with a sentence;
 * these triggers are what is left when two people race past that check. They
 * raise `restrict_violation` naming their rule as the constraint, and this
 * reads that back as the SAME refusal, with the same stable code the
 * application uses, so the API answers 422 rather than 500.
 *
 * Nothing from the driver's message reaches the client: the sentence below is
 * fixed text.
 */
const RESTRICT_VIOLATION = '23001';

const REFUSALS: Readonly<Record<string, { readonly message: string; readonly violation: RuleViolation }>> = {
  jobs_customer_has_company: {
    message: 'The customer is not a customer of that company.',
    violation: {
      code: 'customer_not_of_company',
      message:
        'Somebody took the company off this customer at the same moment. Raise the job for a company the customer is a customer of, or add the company to the customer first.',
    },
  },
  customer_companies_in_use: {
    message: 'That company cannot be taken off the customer.',
    violation: {
      code: 'customer_company_in_use',
      message:
        'The customer has jobs raised for that company, and a job’s company never changes. The company stays on the customer while it has work there.',
    },
  },
};

/** The PostgreSQL error in the chain — the driver's own, or the one the query builder wrapped. */
const postgresErrorIn = (cause: unknown): { readonly code?: unknown; readonly constraint_name?: unknown } | null => {
  let current: unknown = cause;
  for (let depth = 0; depth < 5 && current !== null && typeof current === 'object'; depth += 1) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (candidate.code === RESTRICT_VIOLATION) return candidate;
    current = candidate.cause;
  }
  return null;
};

/** The refusal a company trigger raised, or null for anything else. */
export const companyRefusalOf = (
  cause: unknown,
): { readonly message: string; readonly violation: RuleViolation } | null => {
  const error = postgresErrorIn(cause);
  if (error === null || typeof error.constraint_name !== 'string') return null;
  return REFUSALS[error.constraint_name] ?? null;
};
