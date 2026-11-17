import { describe, expect, it } from 'vitest';
import { errorResponse, toApiError } from './errors';

/**
 * CHK-RACE-1 / CUST-ACCT-1 (17 November 2026). The production build bundles an error class into more
 * than one chunk, so the copy a route throws is not the class this module imports and `instanceof` is
 * false. Unit tests share one module graph and never saw it: two checklist answers that raced answered
 * 500 on production instead of 409. Each case below is a look-alike — the shape a second copy has.
 */
class ConcurrencyError extends Error {
  constructor(readonly entity: string, readonly id: string, readonly expectedVersion: number) {
    super(`${entity} ${id} was changed by someone else while you were working on it. Reload it and try again.`);
    this.name = 'ConcurrencyError';
  }
}
class WorkflowError extends Error {
  constructor(message: string, readonly violations: readonly { code: string; message: string }[]) {
    super(message);
    this.name = 'WorkflowError';
  }
}

describe('errors the build bundled twice', () => {
  it('a lost race is a 409 "reload", never a 500', () => {
    const answer = toApiError(new ConcurrencyError('Job', 'EJE-2131', 94));
    expect(answer.code).toBe('version_conflict');
    expect(errorResponse(answer).status).toBe(409);
  });

  it('a domain refusal is still a 422 with its own words', () => {
    const answer = toApiError(new WorkflowError('Refused.', [{ code: 'parts_releaser_required', message: 'Choose who is releasing the parts.' }]));
    expect(answer.code).toBe('workflow_refused');
    expect(answer.violations[0]!.code).toBe('parts_releaser_required');
  });

  it('an error that merely shares the name is not taken for one', () => {
    const impostor = new Error('nope');
    impostor.name = 'ConcurrencyError';
    expect(toApiError(impostor).code).toBe('internal_error');
  });
});

describe('a taken account number reaching the database', () => {
  it('is a 409 with a sentence, never the driver’s text', () => {
    const driver = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint_name: 'customers_account_number_key',
    });
    const wrapped = Object.assign(new Error('Failed query: insert into "customers" …'), { cause: driver });
    const answer = toApiError(wrapped);
    expect(answer.code).toBe('conflict');
    expect(answer.violations[0]!.code).toBe('duplicate_account_number');
    expect(answer.message).not.toContain('insert');
    // Any other unique violation stays an unexpected failure.
    const other = Object.assign(new Error('x'), { cause: { code: '23505', constraint_name: 'jobs_job_number_key' } });
    expect(toApiError(other).code).toBe('internal_error');
  });
});
