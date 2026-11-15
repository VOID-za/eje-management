import { describe, expect, it } from 'vitest';
import { companyRefusalOf } from './company-refusals';
import { errorResponse, toApiError } from '@/server/api/errors';

/**
 * MULTI-CO-1: the database's company triggers (0058) answered as the
 * application's own refusals — 422 with a stable code — never a 500 and never
 * the driver's text. The triggers themselves are `multi-company.db.test.ts`.
 */

/** As postgres.js reports one, wrapped the way the query builder wraps it. */
const raised = (constraint: string, code = '23001') => {
  const driver = Object.assign(new Error('job EJE-1 is for company wd-hearn-jhb … select * from jobs'), {
    code,
    constraint_name: constraint,
  });
  return Object.assign(new Error('Failed query: insert into "jobs" …'), { cause: driver });
};

describe('the database’s company refusals', () => {
  it('reads each trigger back as the application’s refusal, by its stable code', () => {
    expect(companyRefusalOf(raised('jobs_customer_has_company'))?.violation.code).toBe('customer_not_of_company');
    expect(companyRefusalOf(raised('customer_companies_in_use'))?.violation.code).toBe('customer_company_in_use');
  });

  it('leaves every other database error alone', () => {
    expect(companyRefusalOf(raised('jobs_job_number_key', '23505'))).toBeNull();
    expect(companyRefusalOf(raised('some_other_rule'))).toBeNull();
    expect(companyRefusalOf(new Error('boom'))).toBeNull();
    expect(companyRefusalOf(null)).toBeNull();
  });

  it('is a 422 at the API, with nothing of the driver’s message', async () => {
    for (const [constraint, code] of [
      ['jobs_customer_has_company', 'customer_not_of_company'],
      ['customer_companies_in_use', 'customer_company_in_use'],
    ] as const) {
      const error = toApiError(raised(constraint));
      expect(error.code).toBe('workflow_refused');
      const response = errorResponse(error);
      expect(response.status).toBe(422);
      const body = JSON.stringify(await response.json());
      expect(body).toContain(code);
      expect(body).not.toMatch(/select|insert|wd-hearn-jhb/u);
    }
    expect(toApiError(raised('jobs_job_number_key', '23505')).code).toBe('internal_error');
  });
});
