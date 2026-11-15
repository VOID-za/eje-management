import {
  asCompanyId,
  can,
  isCompanyRuleError,
  type Company,
  type CompanyRates,
} from '@/domain';
import type { OperationContext } from './context';
import { audit, changesBetween } from './audit';
import { WorkflowError } from './errors';

/**
 * ADMINISTERING THE COMPANIES. MULTI-CO-1 (stage B, the server half).
 *
 * EJE and WD Hearn JHB each have their own details (the letterhead's lines),
 * notification sender, job numbering and charge-out rates. They are the same
 * kind of commercial terms the settings screen has always held, so they are
 * held to the same rule: the office edits them — `settings.rates`, a Senior
 * Tech or the Office, exactly as `updateSettings` — and a technician does not.
 *
 * WHAT A SAVE CAN AND CANNOT DO, all enforced by the repository's
 * `assertCompanySaveAllowed` (so a script calling the repository directly is
 * held to it too) and turned into a sentence here:
 *  - the prefix keeps its shape, and never overlaps another company's prefix
 *    or another company's existing job numbers;
 *  - the start number only sets the INITIAL value; once numbers are issued it
 *    may only move forward, so an active sequence is never silently reset;
 *  - which company is the default (EJE) and its short code are fixed;
 *  - the letterhead is not set here (it is uploaded: `company-letterhead.ts`).
 *
 * NOTHING ALREADY PRICED MOVES. A rate change prices new and unfrozen job
 * cards of THIS company only; a signed or issued job card keeps its snapshot.
 *
 * SAVING EJE IS SAVING THE SETTINGS' COMPANY DETAILS AND RATES TOO: the
 * repository mirrors EJE into the legacy settings row, which the release
 * before companies (and payroll paperwork) still reads.
 *
 * EVERY CHANGE IS AUDITED: who (the actor), which company, and each field
 * from → to — as `settings_updated`, the office-only event the settings have
 * always written, so a technician's feed never shows it.
 */

export const assertAdministers = (context: OperationContext): void => {
  if (!can(context.actor.role, 'settings.rates')) {
    throw new WorkflowError('Only the office can change a company’s details, numbering or rates.', [
      {
        code: 'not_permitted',
        message: 'A company’s details, job numbering and charge-out rates are set by a Senior Tech or the Office.',
      },
    ]);
  }
};

/** A company as the administration screen is handed it: never the letterhead's storage key. */
export type CompanyAdminView = Omit<Company, 'letterhead'> & {
  readonly letterhead: Omit<NonNullable<Company['letterhead']>, 'storageKey'> | null;
};

export const adminViewOf = (company: Company): CompanyAdminView => {
  const { letterhead, ...rest } = company;
  if (letterhead === null) return { ...rest, letterhead: null };
  const { storageKey: _storageKey, ...visible } = letterhead;
  return { ...rest, letterhead: visible };
};

export const listCompanies = async (context: OperationContext): Promise<readonly CompanyAdminView[]> => {
  assertAdministers(context);
  return (await context.repos.companies.list()).map(adminViewOf);
};

/** What one save may change. Every part optional: what is left out stays as it is. */
export interface CompanyUpdate {
  readonly details?: {
    readonly name?: string;
    readonly registration?: string;
    readonly vatNumber?: string;
    readonly physicalAddress?: string;
    readonly postalAddress?: string;
    readonly phone?: string;
    readonly fax?: string;
    readonly email?: string;
  };
  readonly notifications?: {
    readonly senderName?: string;
    readonly replyTo?: string;
  };
  readonly numbering?: {
    readonly jobNumberPrefix?: string;
    readonly jobNumberStart?: number;
  };
  readonly rates?: CompanyRates;
}

const isEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);

const MAX_CENTS = 100_000_000;
const ratesProblem = (rates: CompanyRates): string | null => {
  const money = [
    rates.labourRates.normal,
    rates.labourRates.overtime,
    rates.labourRates.double,
    rates.calloutRate,
    rates.testBenchFee,
    rates.kilometreRate,
  ];
  if (money.some((value) => !Number.isInteger(value) || value < 0 || value > MAX_CENTS)) {
    return 'Every rate must be an amount of zero or more.';
  }
  if (!Number.isFinite(rates.vatPercentage) || rates.vatPercentage < 0 || rates.vatPercentage > 100) {
    return 'VAT must be a percentage between 0 and 100.';
  }
  return null;
};

const refuse = (message: string, code: string, detail: string): WorkflowError =>
  new WorkflowError(message, [{ code, message: detail }]);

/** The flat record an audit compares, field by field. */
const audited = (company: Company): Readonly<Record<string, string | number>> => ({
  name: company.name,
  registration: company.registration,
  vatNumber: company.vatNumber,
  physicalAddress: company.physicalAddress,
  postalAddress: company.postalAddress,
  phone: company.phone,
  fax: company.fax,
  email: company.email,
  notificationSenderName: company.notificationSenderName,
  notificationReplyTo: company.notificationReplyTo,
  jobNumberPrefix: company.jobNumberPrefix,
  jobNumberStart: company.jobNumberStart,
  labourNormal: company.rates.labourRates.normal,
  labourOvertime: company.rates.labourRates.overtime,
  labourDouble: company.rates.labourRates.double,
  callout: company.rates.calloutRate,
  testBench: company.rates.testBenchFee,
  kilometre: company.rates.kilometreRate,
  vatPercentage: company.rates.vatPercentage,
});

export const updateCompany = async (
  context: OperationContext,
  companyId: string,
  update: CompanyUpdate,
): Promise<CompanyAdminView> => {
  assertAdministers(context);
  const existing = await context.repos.companies.findById(asCompanyId(companyId));
  if (existing === null) {
    throw refuse('That company is not one the system serves.', 'unknown_company', 'Reload the list of companies.');
  }

  const details = update.details ?? {};
  const notifications = update.notifications ?? {};
  const numbering = update.numbering ?? {};
  const trimmed = (value: string | undefined, current: string): string =>
    value === undefined ? current : value.trim();

  const next: Company = {
    ...existing,
    name: trimmed(details.name, existing.name),
    registration: trimmed(details.registration, existing.registration),
    vatNumber: trimmed(details.vatNumber, existing.vatNumber),
    physicalAddress: trimmed(details.physicalAddress, existing.physicalAddress),
    postalAddress: trimmed(details.postalAddress, existing.postalAddress),
    phone: trimmed(details.phone, existing.phone),
    fax: trimmed(details.fax, existing.fax),
    email: trimmed(details.email, existing.email),
    notificationSenderName: trimmed(notifications.senderName, existing.notificationSenderName),
    notificationReplyTo: trimmed(notifications.replyTo, existing.notificationReplyTo),
    jobNumberPrefix: trimmed(numbering.jobNumberPrefix, existing.jobNumberPrefix),
    jobNumberStart: numbering.jobNumberStart ?? existing.jobNumberStart,
    rates:
      update.rates === undefined
        ? existing.rates
        : {
            labourRates: { ...update.rates.labourRates },
            calloutRate: update.rates.calloutRate,
            testBenchFee: update.rates.testBenchFee,
            kilometreRate: update.rates.kilometreRate,
            vatPercentage: update.rates.vatPercentage,
          },
  };

  if (next.email !== '' && !isEmail(next.email)) {
    throw refuse('That is not an email address.', 'invalid_company_email',
      'Give the company’s email address, e.g. office@company.co.za, or leave it empty.');
  }
  if (next.notificationReplyTo !== '' && !isEmail(next.notificationReplyTo)) {
    throw refuse('That is not an email address.', 'invalid_reply_to',
      'Replies to this company’s notifications go to this address; give one, or leave it empty.');
  }
  const ratesIssue = ratesProblem(next.rates);
  if (ratesIssue !== null) throw refuse('Those rates cannot be saved.', 'invalid_rates', ratesIssue);

  let saved: Company;
  try {
    saved = await context.repos.companies.save(next);
  } catch (error) {
    // The repository's rules, in the same words, as a refusal the office can act on.
    if (isCompanyRuleError(error)) {
      throw refuse(`${existing.name} could not be saved.`, error.code, error.message);
    }
    throw error;
  }

  const changes = changesBetween(`company.${existing.id}`, audited(existing), audited(saved));
  await audit(context, {
    jobId: null,
    type: 'settings_updated',
    summary: `${saved.name} company details updated`,
    detail:
      changes.length === 0
        ? `${saved.name} saved with no change.`
        : `Changed for ${saved.name}: ${changes.map((change) => change.field.split('.').at(-1)).join(', ')}. ` +
          `Job cards already signed or issued keep the prices they were frozen at.`,
    changes,
  });
  return adminViewOf(saved);
};
