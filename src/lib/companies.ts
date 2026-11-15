import {
  DEFAULT_COMPANY_ID,
  WD_HEARN_JHB_COMPANY_ID,
  formatJobNumber,
  jobNumberPrefixProblem,
  jobNumberStartProblem,
  prefixConflictProblem,
  asCompanyId,
  type CompanyRates,
} from '@/domain';
import type { CompanyAdminView, CompanyUpdate } from '@/application/company-operations';

/**
 * THE COMPANIES, AS THE SCREENS OFFER THEM. MULTI-CO-1 (stage C, the UI).
 *
 * Pure, so the rules the screens apply before a request — which customers a
 * company offers, that a customer belongs to at least one company, what the
 * Company details form may send — are tested here rather than in a browser.
 * The SERVER applies every one of them again; these exist so the office is
 * told in the form, not by a refusal.
 */

/**
 * The two companies, in the order every screen lists them: EJE (the default)
 * first. The ids are the stable ones migration 0058 created; the labels are
 * the owner's ("EJE", "WD Hearn JHB"). The customer screens use these rather
 * than the companies endpoint, which is Administration's (`settings.rates`).
 */
export const COMPANY_CHOICES: readonly { readonly id: string; readonly label: string }[] = [
  { id: DEFAULT_COMPANY_ID, label: 'EJE' },
  { id: WD_HEARN_JHB_COMPANY_ID, label: 'WD Hearn JHB' },
];

/** The owner: "WD Hearn assignment checkbox selected by default" on a new customer. */
export const NEW_CUSTOMER_COMPANY_IDS: readonly string[] = [WD_HEARN_JHB_COMPANY_ID];

/**
 * The label a company id is shown as; an id no screen knows is shown as
 * itself. Undefined — a row a device kept from before companies — is EJE's,
 * as every job from then is.
 */
export const companyLabel = (companyId: string | undefined): string =>
  COMPANY_CHOICES.find((choice) => choice.id === (companyId ?? DEFAULT_COMPANY_ID))?.label ?? companyId ?? 'EJE';

/** The customers linked to this company. A customer of both is in both. */
export const customersForCompany = <T extends { readonly companyIds: readonly string[] }>(
  customers: readonly T[],
  companyId: string,
): readonly T[] => customers.filter((customer) => customer.companyIds.includes(companyId));

/** Whether the customer chosen on the form may stay when the company changes to `companyId`. */
export const customerStaysForCompany = (
  customer: { readonly companyIds: readonly string[] } | undefined,
  companyId: string,
): boolean => customer !== undefined && customer.companyIds.includes(companyId);

/** Ticks or clears one company, keeping the list in `COMPANY_CHOICES` order. */
export const toggleCompany = (
  companyIds: readonly string[],
  companyId: string,
  checked: boolean,
): readonly string[] => {
  const next = new Set(companyIds);
  if (checked) next.add(companyId);
  else next.delete(companyId);
  const known = COMPANY_CHOICES.map((choice) => choice.id).filter((id) => next.has(id));
  return [...known, ...[...next].filter((id) => !known.includes(id))];
};

/** Null when the customer is linked to a company; the server's rule (`customer_company_required`). */
export const customerCompaniesProblem = (companyIds: readonly string[]): string | null =>
  companyIds.length === 0 ? 'Choose at least one company: EJE, WD Hearn JHB, or both.' : null;

/** The number a company's next job will carry, as the New Job form and Administration show it. */
export const nextJobNumberOf = (company: Pick<CompanyAdminView, 'jobNumberPrefix' | 'nextJobSequence'>): string =>
  formatJobNumber(company.jobNumberPrefix, company.nextJobSequence);

/* ------------------------------------------------------------------------ */
/* THE CUSTOMERS TAB, REMEMBERED. As FILTER-MEM-1 remembers a date range:     */
/* per person, in this browser only, a convenience and never a record.         */
/* ------------------------------------------------------------------------ */

const tabKey = (userId: string): string => `eje.customers.company.${userId}`;

export const readRememberedCompanyTab = (userId: string): string | null => {
  try {
    if (typeof window === 'undefined') return null;
    const stored = window.localStorage.getItem(tabKey(userId));
    return COMPANY_CHOICES.some((choice) => choice.id === stored) ? stored : null;
  } catch {
    return null;
  }
};

export const rememberCompanyTab = (userId: string, companyId: string): void => {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(tabKey(userId), companyId);
  } catch {
    // Not remembered; the page still shows the tab that was chosen.
  }
};

/* ------------------------------------------------------------------------ */
/* ADMINISTRATION → SYSTEM → COMPANY DETAILS                                  */
/* ------------------------------------------------------------------------ */

/** The form as typed: every value a string, because that is what an input gives. */
export interface CompanyForm {
  readonly name: string;
  readonly registration: string;
  readonly vatNumber: string;
  readonly physicalAddress: string;
  readonly postalAddress: string;
  readonly phone: string;
  readonly fax: string;
  readonly email: string;
  readonly senderName: string;
  readonly replyTo: string;
  readonly jobNumberPrefix: string;
  readonly jobNumberStart: string;
  readonly normal: string;
  readonly overtime: string;
  readonly double: string;
  readonly callout: string;
  readonly testBench: string;
  readonly kilometre: string;
  readonly vat: string;
}

export type CompanyFormField = keyof CompanyForm;
export type CompanyFormProblems = Partial<Record<CompanyFormField, string>>;

const rands = (cents: number): string => (cents / 100).toFixed(2);

export const companyFormFrom = (company: CompanyAdminView): CompanyForm => ({
  name: company.name,
  registration: company.registration,
  vatNumber: company.vatNumber,
  physicalAddress: company.physicalAddress,
  postalAddress: company.postalAddress,
  phone: company.phone,
  fax: company.fax,
  email: company.email,
  senderName: company.notificationSenderName,
  replyTo: company.notificationReplyTo,
  jobNumberPrefix: company.jobNumberPrefix,
  jobNumberStart: String(company.jobNumberStart),
  normal: rands(company.rates.labourRates.normal),
  overtime: rands(company.rates.labourRates.overtime),
  double: rands(company.rates.labourRates.double),
  callout: rands(company.rates.calloutRate),
  testBench: rands(company.rates.testBenchFee),
  kilometre: rands(company.rates.kilometreRate),
  vat: String(company.rates.vatPercentage),
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const AMOUNT = /^\d+(\.\d{1,2})?$/u;
const MONEY_FIELDS = ['normal', 'overtime', 'double', 'callout', 'testBench', 'kilometre'] as const;
export const RATE_FIELDS: readonly CompanyFormField[] = [...MONEY_FIELDS, 'vat'];

const toCents = (value: string): number => Math.round(Number.parseFloat(value.trim()) * 100);

/**
 * What is wrong with the form, field by field, before it is sent. The same
 * rules `updateCompany` and `assertCompanySaveAllowed` apply, in the same words
 * where the domain has them: the prefix's shape (only when it is changed — a
 * prefix the settings held before companies is kept), no overlap with another
 * company's prefix, the start rule, the email addresses and the rates.
 */
export const companyFormProblems = (
  form: CompanyForm,
  company: CompanyAdminView,
  companies: readonly Pick<CompanyAdminView, 'id' | 'name' | 'jobNumberPrefix'>[],
): CompanyFormProblems => {
  const problems: Record<string, string> = {};
  if (form.name.trim().length === 0) problems.name = 'A company needs a name.';
  if (form.email.trim() !== '' && !EMAIL.test(form.email.trim())) {
    problems.email = 'That is not an email address. Give one, e.g. office@company.co.za, or leave it empty.';
  }
  if (form.replyTo.trim() !== '' && !EMAIL.test(form.replyTo.trim())) {
    problems.replyTo = 'That is not an email address. Give one, or leave it empty.';
  }

  const prefix = form.jobNumberPrefix.trim();
  const shape = prefix === company.jobNumberPrefix ? null : jobNumberPrefixProblem(prefix);
  const conflict = shape === null ? prefixConflictProblem(asCompanyId(company.id), prefix, companies.map((other) => ({ ...other, id: asCompanyId(other.id) }))) : null;
  if (shape !== null || conflict !== null) problems.jobNumberPrefix = (shape ?? conflict)!;

  const startText = form.jobNumberStart.trim();
  const start = /^\d+$/u.test(startText) ? Number.parseInt(startText, 10) : Number.NaN;
  const startProblem = jobNumberStartProblem(company, start);
  if (startProblem !== null) problems.jobNumberStart = startProblem;

  for (const field of MONEY_FIELDS) {
    if (!AMOUNT.test(form[field].trim()) || toCents(form[field]) > 100_000_000) {
      problems[field] = 'An amount in rand of zero or more, e.g. 950.00.';
    }
  }
  const vat = Number(form.vat.trim());
  if (form.vat.trim() === '' || !Number.isFinite(vat) || vat < 0 || vat > 100) {
    problems.vat = 'VAT is a percentage between 0 and 100.';
  }
  return problems;
};

export const ratesFromForm = (form: CompanyForm): CompanyRates => ({
  labourRates: { normal: toCents(form.normal), overtime: toCents(form.overtime), double: toCents(form.double) },
  calloutRate: toCents(form.callout),
  testBenchFee: toCents(form.testBench),
  kilometreRate: toCents(form.kilometre),
  vatPercentage: Number(form.vat.trim()),
});

/**
 * The request a save sends: details, notifications and numbering, and the rates
 * only when `withRates` (the Rates & VAT tab and the Company details form both
 * save through here; the details save leaves the rates out unless it edits
 * them). Never the id, code, default flag, next number or letterhead — the
 * route refuses them.
 */
export const companyUpdateFrom = (
  form: CompanyForm,
  parts: { readonly details: boolean; readonly rates: boolean },
): CompanyUpdate => ({
  ...(parts.details
    ? {
        details: {
          name: form.name.trim(),
          registration: form.registration.trim(),
          vatNumber: form.vatNumber.trim(),
          physicalAddress: form.physicalAddress.trim(),
          postalAddress: form.postalAddress.trim(),
          phone: form.phone.trim(),
          fax: form.fax.trim(),
          email: form.email.trim(),
        },
        notifications: { senderName: form.senderName.trim(), replyTo: form.replyTo.trim() },
        numbering: {
          jobNumberPrefix: form.jobNumberPrefix.trim(),
          jobNumberStart: Number.parseInt(form.jobNumberStart.trim(), 10),
        },
      }
    : {}),
  ...(parts.rates ? { rates: ratesFromForm(form) } : {}),
});

/**
 * Which form field a server refusal belongs to, so it is shown beside the
 * field rather than only at the top. Null: a refusal of the save as a whole.
 */
export const fieldForRefusal = (code: string | null): CompanyFormField | null => {
  switch (code) {
    case 'job_number_prefix_invalid':
    case 'job_number_prefix_conflict':
      return 'jobNumberPrefix';
    case 'job_number_start_invalid':
      return 'jobNumberStart';
    case 'invalid_company_email':
      return 'email';
    case 'invalid_reply_to':
      return 'replyTo';
    case 'company_name_required':
      return 'name';
    default:
      return null;
  }
};
