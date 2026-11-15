import type { Company, CompanyId } from '../types/company';

/**
 * PER-COMPANY JOB NUMBERING, AS RULES. MULTI-CO-1.
 *
 * Pure, so the PostgreSQL repository, the demonstration store and (later) the
 * company screen all ask the same questions and get the same sentences. The
 * database enforces the prefix shape and the prefix conflict again
 * (`0058_multi_company.sql`), because a rule only the application knows is a
 * rule a script can step around.
 */

/**
 * THE PREFIX RULE: one to eight capital letters or digits, then a hyphen.
 * `EJE-`, `WDJ-`, `WD1-`.
 *
 *  - The closing hyphen is what keeps the number a number: the repository reads
 *    the trailing digits of a job number as its sequence, so a prefix ending in
 *    a digit (`WD1` + `0001`) would read as sequence 10001.
 *  - Capitals only, because a job number is looked up without regard to case
 *    (`findByJobNumber`), so `wdj-` and `WDJ-` would be the same number to a
 *    person and different to a comparison.
 *  - Eight characters is short enough to print beside the number on a tablet
 *    and long enough for any abbreviation the office has asked for.
 */
export const JOB_NUMBER_PREFIX_PATTERN = /^[A-Z0-9]{1,8}-$/u;

/** The digits a job number carries at least: EJE-0001. A longer number keeps all its digits. */
export const JOB_NUMBER_MIN_DIGITS = 4;

/** The largest sequence PostgreSQL's `integer` column can hold. */
export const MAX_JOB_SEQUENCE = 2_147_483_647;

/** Null when the prefix is acceptable; otherwise what is wrong with it, as a sentence. */
export const jobNumberPrefixProblem = (prefix: string): string | null =>
  JOB_NUMBER_PREFIX_PATTERN.test(prefix)
    ? null
    : 'A job number prefix is one to eight capital letters or digits followed by a hyphen, such as EJE- or WDJ-.';

/**
 * Whether two prefixes could ever produce numbers that look alike: equal, or
 * one the beginning of the other. Under the shape rule a hyphen only ever
 * closes a prefix, so for two well-formed prefixes this is equality — the
 * prefix test is kept because it is the rule the owner stated, and it still
 * holds for a malformed value a caller has not yet been refused. Compared
 * exactly, because the shape rule already makes both upper case.
 */
export const prefixesConflict = (left: string, right: string): boolean =>
  left.startsWith(right) || right.startsWith(left);

/** Null when no OTHER company's prefix conflicts with this one. */
export const prefixConflictProblem = (
  companyId: CompanyId,
  prefix: string,
  companies: readonly Pick<Company, 'id' | 'name' | 'jobNumberPrefix'>[],
): string | null => {
  const clash = companies.find(
    (other) => other.id !== companyId && prefixesConflict(prefix, other.jobNumberPrefix),
  );
  return clash === undefined
    ? null
    : `${prefix} cannot be used: ${clash.name} numbers its jobs ${clash.jobNumberPrefix}, and the two would be confused.`;
};

/** The display number: the prefix and the sequence, padded to four digits. EJE-0001, EJE-2120, WDJ-12345. */
export const formatJobNumber = (prefix: string, sequence: number): string =>
  `${prefix}${String(sequence).padStart(JOB_NUMBER_MIN_DIGITS, '0')}`;

/** What the start rule needs to know about a company's numbering as it stands. */
export interface JobNumberingState {
  readonly jobNumberStart: number;
  /** The number the next job would carry. */
  readonly nextJobSequence: number;
  /** Whether any number has been handed out. */
  readonly jobNumbersIssued: boolean;
}

/**
 * THE START RULE. Null when `requested` may become the company's start.
 *
 *  - Unchanged is always fine.
 *  - Before any number is issued, the start IS the initial sequence and may be
 *    set to any whole number from 1.
 *  - Once numbers have been issued the start may only move FORWARD, to the next
 *    number or beyond, which moves the sequence with it. Anything lower would
 *    either do nothing (silently — the start would claim a number the sequence
 *    is already past) or hand out numbers that exist.
 */
export const jobNumberStartProblem = (
  state: JobNumberingState,
  requested: number,
): string | null => {
  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_JOB_SEQUENCE) {
    return 'The job number start is a whole number from 1.';
  }
  if (requested === state.jobNumberStart) return null;
  if (!state.jobNumbersIssued) return null;
  if (requested < state.nextJobSequence) {
    return `Job numbers up to ${state.nextJobSequence - 1} have already been issued, so the numbering can only move forward: to ${state.nextJobSequence} or higher.`;
  }
  return null;
};

/**
 * What the next sequence becomes when the start is saved as `requested`
 * (already checked by `jobNumberStartProblem`). Unchanged start: unchanged.
 */
export const nextSequenceAfterStart = (state: JobNumberingState, requested: number): number => {
  if (requested === state.jobNumberStart) return state.nextJobSequence;
  return state.jobNumbersIssued ? Math.max(requested, state.nextJobSequence) : requested;
};

/**
 * A company rule broken by a save, thrown by both repositories so neither can
 * be used to store what the other refuses. `code` is stable for the API.
 */
export class CompanyRuleError extends Error {
  constructor(
    readonly code:
      | 'unknown_company'
      | 'company_name_required'
      | 'job_number_prefix_invalid'
      | 'job_number_prefix_conflict'
      | 'job_number_start_invalid'
      | 'default_company_fixed',
    message: string,
  ) {
    super(message);
    this.name = 'CompanyRuleError';
  }
}

/**
 * Every rule a company save must meet, in the order a person would fix them.
 * Throws the first broken one. `existing` is the company as stored (null for a
 * new one); `all` is every company as stored.
 */
export const assertCompanySaveAllowed = (
  company: Company,
  existing: Company | null,
  all: readonly Company[],
): void => {
  if (company.name.trim().length === 0) {
    throw new CompanyRuleError('company_name_required', 'A company needs a name.');
  }
  const prefixProblem = jobNumberPrefixProblem(company.jobNumberPrefix);
  if (prefixProblem !== null) throw new CompanyRuleError('job_number_prefix_invalid', prefixProblem);
  const conflict = prefixConflictProblem(company.id, company.jobNumberPrefix, all);
  if (conflict !== null) throw new CompanyRuleError('job_number_prefix_conflict', conflict);
  if ((existing?.isDefault ?? false) !== company.isDefault) {
    throw new CompanyRuleError('default_company_fixed', 'Which company is the default is fixed: it is EJE.');
  }
  const state: JobNumberingState = existing ?? {
    jobNumberStart: company.jobNumberStart,
    nextJobSequence: company.jobNumberStart,
    jobNumbersIssued: false,
  };
  const startProblem = jobNumberStartProblem(state, company.jobNumberStart);
  if (startProblem !== null) throw new CompanyRuleError('job_number_start_invalid', startProblem);
};
