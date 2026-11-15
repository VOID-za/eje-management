import {
  DEFAULT_COMPANY_ID,
  type CompanyId,
  type Company,
  type CompanyRates,
} from '../types/company';
import type { SystemSettings } from '../types/settings';

/**
 * WHO A DOCUMENT IS FROM: THE JOB'S COMPANY. MULTI-CO-1 (stage B).
 *
 * Every customer document — the job card, the parts collection note, the
 * Delivery Note, the Installation Delivery Note, a correction addendum — names
 * the company the job was raised for in its letterhead. ONE builder decides
 * what that letterhead says, so the documents cannot disagree with each other.
 *
 * NOTHING IS INVENTED. A detail the office has not captured is left off the
 * line, never printed as a blank label or a placeholder: WD Hearn JHB is
 * created with only its name, so until the office captures the rest its
 * documents say only "WD Hearn JHB". EJE's documents read exactly as they did
 * before companies existed, because EJE's company holds what the settings did
 * and there is no fax or postal address to add.
 */

/** What a document needs to know about a company. Never the letterhead's storage key. */
export type CompanyDetails = Pick<
  Company,
  | 'id'
  | 'code'
  | 'name'
  | 'registration'
  | 'vatNumber'
  | 'physicalAddress'
  | 'postalAddress'
  | 'phone'
  | 'fax'
  | 'email'
>;

export interface CompanyBlock {
  readonly name: string;
  /** Physical, then postal ("Postal: …"); an empty one is left out. */
  readonly addressLines: readonly string[];
  /** The address lines as the one line the letterheads print. */
  readonly address: string;
  /** "Tel … · Fax … · email"; an empty one is left out. */
  readonly contactLine: string;
  /** "Reg. … · VAT …" (or only "Reg. …" without VAT); an empty one is left out. */
  readonly registrationLine: string;
}

export const companyDetailsOf = (company: CompanyDetails): CompanyDetails => ({
  id: company.id,
  code: company.code,
  name: company.name,
  registration: company.registration,
  vatNumber: company.vatNumber,
  physicalAddress: company.physicalAddress,
  postalAddress: company.postalAddress,
  phone: company.phone,
  fax: company.fax,
  email: company.email,
});

/**
 * EJE as the legacy settings row describes it — for a caller (a test, an old
 * fixture) that renders a document from settings alone. The settings row has no
 * fax or postal address, so neither is printed.
 */
export const companyDetailsFromSettings = (settings: SystemSettings): CompanyDetails => ({
  id: DEFAULT_COMPANY_ID,
  code: 'EJE',
  name: settings.companyName,
  registration: settings.companyRegistration,
  vatNumber: settings.companyVatNumber,
  physicalAddress: settings.companyAddress,
  postalAddress: '',
  phone: settings.companyPhone,
  fax: '',
  email: settings.companyEmail,
});

const present = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const joined = (parts: readonly (string | null)[]): string =>
  parts.filter((part): part is string => part !== null).join(' · ');

/**
 * The letterhead block. `vat: false` leaves the VAT number off — the
 * Installation Delivery Note withholds everything financial (INSTALL-DN-1).
 */
export const companyBlockFrom = (
  company: CompanyDetails,
  options: { readonly vat?: boolean } = {},
): CompanyBlock => {
  const physical = present(company.physicalAddress);
  const postal = present(company.postalAddress);
  const addressLines = [
    ...(physical === null ? [] : [physical]),
    ...(postal === null || postal === physical ? [] : [`Postal: ${postal}`]),
  ];
  const phone = present(company.phone);
  const fax = present(company.fax);
  const registration = present(company.registration);
  const vat = options.vat === false ? null : present(company.vatNumber);
  return {
    name: company.name.trim(),
    addressLines,
    address: addressLines.join(' · '),
    contactLine: joined([
      phone === null ? null : `Tel ${phone}`,
      fax === null ? null : `Fax ${fax}`,
      present(company.email),
    ]),
    registrationLine: joined([
      registration === null ? null : `Reg. ${registration}`,
      vat === null ? null : `VAT ${vat}`,
    ]),
  };
};

/**
 * The settings a job is priced and described with: the shared settings, with
 * the JOB'S COMPANY'S identity and rates laid over them. Everything that is
 * not the company's (the finance recipient, the numbering of EJE's legacy
 * row, and so on) is the settings' own.
 */
export const settingsForCompany = (
  settings: SystemSettings,
  company: CompanyDetails & { readonly rates: CompanyRates },
): SystemSettings => ({
  ...settings,
  companyName: company.name,
  companyRegistration: company.registration,
  companyVatNumber: company.vatNumber,
  companyAddress: company.physicalAddress,
  companyPhone: company.phone,
  companyEmail: company.email,
  labourRates: { ...company.rates.labourRates },
  calloutRate: company.rates.calloutRate,
  testBenchFee: company.rates.testBenchFee,
  kilometreRate: company.rates.kilometreRate,
  vatPercentage: company.rates.vatPercentage,
});

/**
 * WHICH LETTERHEAD A COMPANY'S DOCUMENTS CARRY. LETTERHEAD-1.
 *
 * Enough for the browser to fetch the image through its authorised route
 * (`/api/companies/:id/letterhead`) and to know when it has been replaced —
 * never the storage key. Null when none is uploaded: the documents keep the
 * text header above.
 */
export interface LetterheadReference {
  readonly companyId: CompanyId;
  readonly sha256: string;
}

export const letterheadReferenceOf = (company: Pick<Company, 'id' | 'letterhead'> | null): LetterheadReference | null =>
  company === null || company.letterhead === null ? null : { companyId: company.id, sha256: company.letterhead.sha256 };
