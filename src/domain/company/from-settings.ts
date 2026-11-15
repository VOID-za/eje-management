import type { IsoDateTime } from '../types/common';
import {
  DEFAULT_COMPANY_ID,
  WD_HEARN_JHB_COMPANY_ID,
  type Company,
  type CompanyRates,
} from '../types/company';
import type { SystemSettings } from '../types/settings';

/**
 * THE TWO COMPANIES, AS MIGRATION 0058 CREATES THEM, for a store that has no
 * migration of its own to run — the demonstration snapshot. MULTI-CO-1.
 *
 * EJE is what the settings row already says about EJE. WD Hearn JHB is its name,
 * its prefix and a start of 1, and NOTHING ELSE: its registration, VAT number,
 * addresses, telephone, fax, email and letterhead are left empty for the office
 * to capture. Its rates are a COPY of EJE's current rates — an editable
 * starting point the office must confirm, not WD Hearn's agreed rates.
 */
export const ratesFromSettings = (settings: SystemSettings): CompanyRates => ({
  labourRates: { ...settings.labourRates },
  calloutRate: settings.calloutRate,
  testBenchFee: settings.testBenchFee,
  kilometreRate: settings.kilometreRate,
  vatPercentage: settings.vatPercentage,
});

/** What the legacy settings row says about EJE, laid over the EJE company. */
export const withSettingsMirrored = (company: Company, settings: SystemSettings): Company => ({
  ...company,
  name: settings.companyName,
  registration: settings.companyRegistration,
  vatNumber: settings.companyVatNumber,
  physicalAddress: settings.companyAddress,
  phone: settings.companyPhone,
  email: settings.companyEmail,
  jobNumberPrefix: settings.jobNumberPrefix,
  rates: ratesFromSettings(settings),
});

/** The EJE company's details and rates, written back into the legacy settings row. */
export const settingsMirroring = (settings: SystemSettings, company: Company): SystemSettings => ({
  ...settings,
  companyName: company.name,
  companyRegistration: company.registration,
  companyVatNumber: company.vatNumber,
  companyAddress: company.physicalAddress,
  companyPhone: company.phone,
  companyEmail: company.email,
  jobNumberPrefix: company.jobNumberPrefix,
  labourRates: { ...company.rates.labourRates },
  calloutRate: company.rates.calloutRate,
  testBenchFee: company.rates.testBenchFee,
  kilometreRate: company.rates.kilometreRate,
  vatPercentage: company.rates.vatPercentage,
});

export const companiesFromSettings = (
  settings: SystemSettings,
  now: IsoDateTime,
): readonly Company[] => {
  const eje: Company = {
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
    notificationSenderName: '',
    notificationReplyTo: '',
    letterhead: null,
    jobNumberPrefix: settings.jobNumberPrefix,
    // Where EJE's numbering stands now: it was numbering long before companies.
    jobNumberStart: settings.nextJobSequence,
    nextJobSequence: settings.nextJobSequence,
    jobNumbersIssued: false,
    rates: ratesFromSettings(settings),
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
  const wdHearn: Company = {
    id: WD_HEARN_JHB_COMPANY_ID,
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
    // A copy of EJE's rates: an editable starting point the office must confirm.
    rates: ratesFromSettings(settings),
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  };
  return [eje, wdHearn];
};
