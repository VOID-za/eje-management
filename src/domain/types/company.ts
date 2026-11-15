import type { Cents, IsoDateTime, UserId } from './common';
import type { LabourRateConfig } from './settings';

/**
 * THE COMPANIES THE SYSTEM SERVES. MULTI-CO-1 (15 November 2026).
 *
 * The owner's requirement: two companies, "EJE" — everything that existed
 * before, and the default — and "WD Hearn JHB". Every job belongs to exactly
 * one, fixed when it is raised; a customer belongs to one or both, and its
 * sites, contacts and machines are shared within the customer.
 *
 * The ids are STABLE TEXT rather than generated, because code and data both
 * name them: `jobs.company_id` defaults to `'eje'` so the release before this
 * one can still insert jobs, and EJE's numbering is the one sequence both
 * releases share. A company is administered, never invented: nothing here
 * carries WD Hearn's registration, VAT number or addresses, because nobody has
 * given them to us.
 */
declare const companyBrand: unique symbol;
export type CompanyId = string & { readonly [companyBrand]: 'CompanyId' };

export const asCompanyId = (value: string): CompanyId => value as CompanyId;

/** EJE: every job and customer from before companies existed, and the default. */
export const DEFAULT_COMPANY_ID: CompanyId = asCompanyId('eje');
/** WD Hearn JHB, created by migration 0058 with its details left for the office. */
export const WD_HEARN_JHB_COMPANY_ID: CompanyId = asCompanyId('wd-hearn-jhb');

/**
 * The uploaded letterhead image, as stored. Nothing about it is generated: it
 * is the file the office uploaded, its checksum, and who uploaded it when.
 */
export interface CompanyLetterhead {
  readonly storageKey: string;
  readonly contentType: string;
  /** Lower-case hex SHA-256 of the stored bytes. */
  readonly sha256: string;
  readonly uploadedAt: IsoDateTime;
  readonly uploadedBy: UserId | null;
}

/**
 * The rates a company charges out at — the same structure as Administration's
 * rates on `SystemSettings`, one set per company. Stored only, in Stage A:
 * pricing still reads the settings row, which is EJE's. A signed job card's
 * pricing snapshot is never re-read from here.
 */
export interface CompanyRates {
  readonly labourRates: LabourRateConfig;
  readonly calloutRate: Cents;
  readonly testBenchFee: Cents;
  readonly kilometreRate: Cents;
  /** VAT as a percentage, e.g. 15 for 15% (stored as basis points). */
  readonly vatPercentage: number;
}

export interface Company {
  readonly id: CompanyId;
  /** A short code for lists and filters: EJE, WDJ. Unique. */
  readonly code: string;
  readonly name: string;
  readonly registration: string;
  readonly vatNumber: string;
  readonly physicalAddress: string;
  readonly postalAddress: string;
  readonly phone: string;
  readonly fax: string;
  readonly email: string;
  /** The display name notifications for this company's jobs are sent as. Empty: not configured. */
  readonly notificationSenderName: string;
  /** Where a reply to such a notification goes. Empty: not configured. */
  readonly notificationReplyTo: string;
  /** Null until the office uploads one. */
  readonly letterhead: CompanyLetterhead | null;
  /** See `jobNumberPrefixProblem`. */
  readonly jobNumberPrefix: string;
  /**
   * The number this company's numbering starts at. Sets the INITIAL value; once
   * numbers have been issued it may only move forward — see
   * `jobNumberStartProblem`. For EJE, which was numbering long before companies
   * existed, it is where EJE's sequence stood when migration 0058 ran.
   */
  readonly jobNumberStart: number;
  /**
   * The number the next job will carry. REPORTED, never written back: a save
   * cannot move the allocator except through `jobNumberStart`.
   */
  readonly nextJobSequence: number;
  /** Whether any number has been handed out — what makes the start fixed. */
  readonly jobNumbersIssued: boolean;
  readonly rates: CompanyRates;
  /** Exactly one company is the default (EJE). Not editable. */
  readonly isDefault: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}
