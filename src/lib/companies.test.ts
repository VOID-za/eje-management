import { describe, expect, it } from 'vitest';
import type { CompanyAdminView } from '@/application/company-operations';
import {
  COMPANY_CHOICES,
  NEW_CUSTOMER_COMPANY_IDS,
  companyFormFrom,
  companyFormProblems,
  companyLabel,
  companyUpdateFrom,
  customerCompaniesProblem,
  customerStaysForCompany,
  customersForCompany,
  fieldForRefusal,
  nextJobNumberOf,
  toggleCompany,
} from './companies';

const company = (overrides: Readonly<Record<string, unknown>> = {}): CompanyAdminView =>
  ({
    id: 'wd-hearn-jhb',
    code: 'WDJ',
    name: 'WD Hearn JHB',
    registration: '',
    vatNumber: '',
    physicalAddress: '',
    postalAddress: '',
    phone: '',
    fax: '',
    email: '',
    notificationSenderName: '',
    notificationReplyTo: '',
    letterhead: null,
    jobNumberPrefix: 'WDJ-',
    jobNumberStart: 1,
    nextJobSequence: 1,
    jobNumbersIssued: false,
    rates: {
      labourRates: { normal: 95_000, overtime: 142_500, double: 190_000 },
      calloutRate: 65_000,
      testBenchFee: 50_000,
      kilometreRate: 850,
      vatPercentage: 15,
    },
    isDefault: false,
    createdAt: '2026-11-15T00:00:00.000Z',
    updatedAt: '2026-11-15T00:00:00.000Z',
    ...overrides,
  }) as CompanyAdminView;

const eje = company({ id: 'eje', code: 'EJE', name: 'EJE', jobNumberPrefix: 'EJE-', isDefault: true, jobNumberStart: 1000, nextJobSequence: 2121, jobNumbersIssued: true });
const wd = company();

describe('the companies as the screens offer them (MULTI-CO-1)', () => {
  it('lists EJE first and preselects WD Hearn JHB on a new customer', () => {
    expect(COMPANY_CHOICES.map((choice) => choice.label)).toEqual(['EJE', 'WD Hearn JHB']);
    expect(NEW_CUSTOMER_COMPANY_IDS).toEqual(['wd-hearn-jhb']);
  });

  it('offers only the customers linked to a company; a customer of both is in both', () => {
    const rows = [
      { id: 'a', companyIds: ['eje'] },
      { id: 'b', companyIds: ['wd-hearn-jhb'] },
      { id: 'c', companyIds: ['eje', 'wd-hearn-jhb'] },
    ];
    expect(customersForCompany(rows, 'eje').map((row) => row.id)).toEqual(['a', 'c']);
    expect(customersForCompany(rows, 'wd-hearn-jhb').map((row) => row.id)).toEqual(['b', 'c']);
    expect(customerStaysForCompany(rows[2], 'wd-hearn-jhb')).toBe(true);
    expect(customerStaysForCompany(rows[0], 'wd-hearn-jhb')).toBe(false);
    expect(customerStaysForCompany(undefined, 'eje')).toBe(false);
  });

  it('keeps the chosen companies in order and refuses none', () => {
    expect(toggleCompany(['wd-hearn-jhb'], 'eje', true)).toEqual(['eje', 'wd-hearn-jhb']);
    expect(toggleCompany(['eje', 'wd-hearn-jhb'], 'eje', false)).toEqual(['wd-hearn-jhb']);
    expect(customerCompaniesProblem([])).toMatch(/at least one company/u);
    expect(customerCompaniesProblem(['eje'])).toBeNull();
  });

  it('labels a job’s company, and a row from before companies as EJE', () => {
    expect(companyLabel('wd-hearn-jhb')).toBe('WD Hearn JHB');
    expect(companyLabel('eje')).toBe('EJE');
    expect(companyLabel(undefined)).toBe('EJE');
  });

  it('shows the next job number padded as the server issues it', () => {
    expect(nextJobNumberOf(wd)).toBe('WDJ-0001');
    expect(nextJobNumberOf(eje)).toBe('EJE-2121');
  });
});

describe('the Company details form', () => {
  it('accepts the company as stored', () => {
    expect(companyFormProblems(companyFormFrom(wd), wd, [eje, wd])).toEqual({});
  });

  it('refuses an overlapping prefix, a badly shaped one and a rewinding start', () => {
    const form = companyFormFrom(wd);
    expect(companyFormProblems({ ...form, jobNumberPrefix: 'EJE-' }, wd, [eje, wd]).jobNumberPrefix).toMatch(/EJE numbers its jobs EJE-/u);
    expect(companyFormProblems({ ...form, jobNumberPrefix: 'wd' }, wd, [eje, wd]).jobNumberPrefix).toMatch(/capital letters/u);
    expect(companyFormProblems(companyFormFrom(eje), eje, [eje, wd])).toEqual({});
    expect(companyFormProblems({ ...companyFormFrom(eje), jobNumberStart: '1500' }, eje, [eje, wd]).jobNumberStart).toMatch(/only move forward/u);
    expect(companyFormProblems({ ...companyFormFrom(eje), jobNumberStart: '3000' }, eje, [eje, wd]).jobNumberStart).toBeUndefined();
    expect(companyFormProblems({ ...form, jobNumberStart: '0' }, wd, [eje, wd]).jobNumberStart).toMatch(/whole number/u);
  });

  it('refuses bad email addresses and rates', () => {
    const form = companyFormFrom(wd);
    const problems = companyFormProblems({ ...form, email: 'nope', replyTo: 'x@', normal: '-1', vat: '120', name: ' ' }, wd, [eje, wd]);
    expect(Object.keys(problems).sort()).toEqual(['email', 'name', 'normal', 'replyTo', 'vat']);
  });

  it('sends the details without the rates, or the rates alone', () => {
    const form = { ...companyFormFrom(wd), name: ' WD Hearn JHB ', normal: '1000.50' };
    const details = companyUpdateFrom(form, { details: true, rates: false });
    expect(details.rates).toBeUndefined();
    expect(details.details?.name).toBe('WD Hearn JHB');
    expect(details.numbering).toEqual({ jobNumberPrefix: 'WDJ-', jobNumberStart: 1 });
    const rates = companyUpdateFrom(form, { details: false, rates: true });
    expect(rates.details).toBeUndefined();
    expect(rates.rates?.labourRates.normal).toBe(100_050);
  });

  it('places a server refusal beside its field', () => {
    expect(fieldForRefusal('job_number_prefix_conflict')).toBe('jobNumberPrefix');
    expect(fieldForRefusal('job_number_start_invalid')).toBe('jobNumberStart');
    expect(fieldForRefusal('invalid_reply_to')).toBe('replyTo');
    expect(fieldForRefusal('invalid_rates')).toBeNull();
  });
});
