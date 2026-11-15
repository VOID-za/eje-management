import { describe, expect, it } from 'vitest';
import {
  asCompanyId,
  assertCompanySaveAllowed,
  CompanyRuleError,
  companiesFromSettings,
  DEFAULT_COMPANY_ID,
  formatJobNumber,
  jobNumberPrefixProblem,
  jobNumberStartProblem,
  nextSequenceAfterStart,
  prefixConflictProblem,
  prefixesConflict,
  WD_HEARN_JHB_COMPANY_ID,
  type Company,
  type IsoDateTime,
  type SystemSettings,
} from '@/domain';

/**
 * PER-COMPANY JOB NUMBERING, AS RULES. MULTI-CO-1.
 *
 * The owner's requirements, each asserted rather than described: separate
 * prefixes that can never be confused, numbers padded to four digits without
 * touching a longer number, and a start that sets the initial value and never
 * silently resets an active sequence.
 */

describe('the job number prefix', () => {
  it.each(['EJE-', 'WDJ-', 'A-', 'WD1-', 'ABCDEFGH-'])('accepts %s', (prefix) => {
    expect(jobNumberPrefixProblem(prefix)).toBeNull();
  });

  it.each([
    ['', 'empty'],
    ['EJE', 'no closing hyphen'],
    ['eje-', 'lower case'],
    ['EJE1', 'ends in a digit, so its numbers would not read'],
    ['ABCDEFGHI-', 'nine characters'],
    ['EJ E-', 'a space'],
    ['E-J-', 'a hyphen inside'],
    ['-', 'nothing before the hyphen'],
  ])('refuses %j (%s)', (prefix) => {
    expect(jobNumberPrefixProblem(prefix)).toMatch(/one to eight capital letters or digits/u);
  });
});

describe('two prefixes conflict when equal or one begins the other', () => {
  it('equal', () => expect(prefixesConflict('EJE-', 'EJE-')).toBe(true));
  it('one the beginning of the other, either way round', () => {
    expect(prefixesConflict('WD', 'WDJ-')).toBe(true);
    expect(prefixesConflict('WDJ-', 'WD')).toBe(true);
  });
  it('distinct', () => {
    expect(prefixesConflict('EJE-', 'WDJ-')).toBe(false);
    expect(prefixesConflict('WD-', 'WDJ-')).toBe(false);
  });

  it('names the company whose prefix it would be confused with, and ignores the company itself', () => {
    const companies = [
      { id: DEFAULT_COMPANY_ID, name: 'EJE Industrial Electronics', jobNumberPrefix: 'EJE-' },
      { id: WD_HEARN_JHB_COMPANY_ID, name: 'WD Hearn JHB', jobNumberPrefix: 'WDJ-' },
    ];
    expect(prefixConflictProblem(WD_HEARN_JHB_COMPANY_ID, 'EJE-', companies)).toBe(
      'EJE- cannot be used: EJE Industrial Electronics numbers its jobs EJE-, and the two would be confused.',
    );
    expect(prefixConflictProblem(WD_HEARN_JHB_COMPANY_ID, 'WDJ-', companies)).toBeNull();
    expect(prefixConflictProblem(WD_HEARN_JHB_COMPANY_ID, 'WDH-', companies)).toBeNull();
  });
});

describe('formatting a job number', () => {
  it('pads to four digits', () => {
    expect(formatJobNumber('WDJ-', 1)).toBe('WDJ-0001');
    expect(formatJobNumber('EJE-', 42)).toBe('EJE-0042');
  });
  it('leaves a four-digit number exactly as EJE has always written it', () => {
    expect(formatJobNumber('EJE-', 2120)).toBe('EJE-2120');
  });
  it('never truncates a longer one', () => {
    expect(formatJobNumber('EJE-', 12345)).toBe('EJE-12345');
  });
});

describe('the job number start', () => {
  const fresh = { jobNumberStart: 1, nextJobSequence: 1, jobNumbersIssued: false };
  const active = { jobNumberStart: 1, nextJobSequence: 8, jobNumbersIssued: true };

  it('sets the initial value freely before any number is issued — down as well as up', () => {
    expect(jobNumberStartProblem(fresh, 500)).toBeNull();
    expect(nextSequenceAfterStart(fresh, 500)).toBe(500);
    const raised = { jobNumberStart: 500, nextJobSequence: 500, jobNumbersIssued: false };
    expect(jobNumberStartProblem(raised, 100)).toBeNull();
    expect(nextSequenceAfterStart(raised, 100)).toBe(100);
  });

  it('once numbers are issued, moves only forward — to the next number or beyond', () => {
    expect(jobNumberStartProblem(active, 8)).toBeNull();
    expect(jobNumberStartProblem(active, 1000)).toBeNull();
    expect(nextSequenceAfterStart(active, 1000)).toBe(1000);
  });

  it('never to a number at or below one already issued', () => {
    expect(jobNumberStartProblem(active, 7)).toBe(
      'Job numbers up to 7 have already been issued, so the numbering can only move forward: to 8 or higher.',
    );
    expect(jobNumberStartProblem(active, 2)).not.toBeNull();
  });

  it('leaves an active sequence alone when the start is unchanged', () => {
    expect(jobNumberStartProblem(active, 1)).toBeNull();
    expect(nextSequenceAfterStart(active, 1)).toBe(8);
  });

  it.each([0, -1, 1.5, Number.NaN, 2_147_483_648])('refuses %s', (value) => {
    expect(jobNumberStartProblem(fresh, value)).toBe('The job number start is a whole number from 1.');
  });
});

describe('a company save', () => {
  const settings: SystemSettings = {
    companyName: 'EJE Industrial Electronics',
    companyRegistration: '',
    companyVatNumber: '',
    companyPhone: '',
    companyEmail: '',
    companyAddress: '',
    labourRates: { normal: 1, overtime: 2, double: 3 },
    calloutRate: 4,
    testBenchFee: 5,
    kilometreRate: 6,
    vatPercentage: 15,
    jobNumberPrefix: 'EJE-',
    nextJobSequence: 2121,
    quietHoursStart: '18:00',
    quietHoursEnd: '07:00',
  };
  const [eje, wdHearn] = companiesFromSettings(settings, '2026-11-15T08:00:00.000Z' as IsoDateTime) as [
    Company,
    Company,
  ];
  const all = [eje, wdHearn];
  const refusal = (company: Company, existing: Company | null): string | undefined => {
    try {
      assertCompanySaveAllowed(company, existing, all);
      return undefined;
    } catch (error) {
      expect(error).toBeInstanceOf(CompanyRuleError);
      return (error as CompanyRuleError).code;
    }
  };

  it('WD Hearn JHB starts with nothing invented and EJE’s rates as its starting point', () => {
    expect(wdHearn).toMatchObject({ name: 'WD Hearn JHB', jobNumberPrefix: 'WDJ-', jobNumberStart: 1, registration: '', letterhead: null });
    expect(wdHearn.rates).toEqual(eje.rates);
  });

  it('accepts a save that changes only details', () => {
    expect(refusal({ ...wdHearn, phone: '+27 11 000 0000' }, wdHearn)).toBeUndefined();
  });

  it('refuses each broken rule with its own code', () => {
    expect(refusal({ ...wdHearn, name: '  ' }, wdHearn)).toBe('company_name_required');
    expect(refusal({ ...wdHearn, jobNumberPrefix: 'wdj-' }, wdHearn)).toBe('job_number_prefix_invalid');
    expect(refusal({ ...wdHearn, jobNumberPrefix: 'EJE-' }, wdHearn)).toBe('job_number_prefix_conflict');
    expect(refusal({ ...wdHearn, isDefault: true }, wdHearn)).toBe('default_company_fixed');
    const active = { ...wdHearn, nextJobSequence: 5, jobNumbersIssued: true };
    expect(refusal({ ...active, jobNumberStart: 3 }, active)).toBe('job_number_start_invalid');
  });

  it('allows a new company only with a prefix of its own', () => {
    const third: Company = { ...wdHearn, id: asCompanyId('third'), code: 'THR', name: 'Third', jobNumberPrefix: 'THR-' };
    expect(refusal(third, null)).toBeUndefined();
    expect(refusal({ ...third, jobNumberPrefix: 'WDJ-' }, null)).toBe('job_number_prefix_conflict');
  });
});
