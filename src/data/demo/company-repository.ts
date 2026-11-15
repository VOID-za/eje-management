import {
  assertCompanySaveAllowed,
  CompanyRuleError,
  DEFAULT_COMPANY_ID,
  formatJobNumber,
  nextSequenceAfterStart,
  settingsMirroring,
  withSettingsMirrored,
  type Company,
  type CompanyId,
} from '@/domain';
import type { CompanyRepository } from '../repositories';
import type { DemoContext } from './repositories';
import type { DemoCompanyRecord, DemoDatabase } from './store';

/**
 * The companies, in the demonstration snapshot. MULTI-CO-1.
 *
 * The same contract as PostgreSQL's (`PostgresCompanyRepository`): the same
 * rules refuse the same saves, EJE's details are mirrored into the settings
 * record, and each company numbers from its own counter. EJE's counter is
 * `settings.nextJobSequence` — the one this store always had — so the admin and
 * new-job screens keep showing the right next number.
 *
 * Allocation is one `commit`, which in this single-threaded store is as
 * atomic as an allocation can be: nothing runs between the read and the write.
 */
export class DemoCompanyRepository implements CompanyRepository {
  constructor(private readonly context: DemoContext) {}

  list(): Promise<readonly Company[]> {
    const snapshot = this.context.read();
    return Promise.resolve(snapshot.companies.map((record) => toDomain(record, snapshot)));
  }

  findById(id: CompanyId): Promise<Company | null> {
    const snapshot = this.context.read();
    const record = snapshot.companies.find((candidate) => candidate.id === id);
    return Promise.resolve(record === undefined ? null : toDomain(record, snapshot));
  }

  async save(company: Company): Promise<Company> {
    const snapshot = this.context.read();
    const all = snapshot.companies.map((record) => toDomain(record, snapshot));
    const existing = all.find((candidate) => candidate.id === company.id) ?? null;

    assertCompanySaveAllowed(company, existing, all);
    const clash = snapshot.jobs.find(
      (job) =>
        job.companyId !== company.id &&
        job.jobNumber.slice(0, company.jobNumberPrefix.length).toUpperCase() === company.jobNumberPrefix,
    );
    if (clash !== undefined) {
      throw new CompanyRuleError(
        'job_number_prefix_conflict',
        `${company.jobNumberPrefix} cannot be used: ${clash.jobNumber} already belongs to another company.`,
      );
    }

    const next =
      existing === null ? company.jobNumberStart : nextSequenceAfterStart(existing, company.jobNumberStart);
    const stored = snapshot.companies.find((candidate) => candidate.id === company.id);
    const record: DemoCompanyRecord = {
      ...company,
      name: company.name.trim(),
      code: company.code.trim(),
      isDefault: existing?.isDefault ?? false,
      nextJobSequence: next,
      jobNumbersIssued: false,
      lastIssuedJobSequence: stored?.lastIssuedJobSequence ?? null,
      updatedAt: new Date().toISOString() as Company['updatedAt'],
    };

    this.context.commit((draft) => {
      draft.companies =
        stored === undefined
          ? [...draft.companies, record]
          : draft.companies.map((candidate) => (candidate.id === company.id ? record : candidate));
      if (company.id === DEFAULT_COMPANY_ID) {
        // EJE's counter is the settings record's, and so are its legacy details.
        draft.settings = { ...settingsMirroring(draft.settings, record), nextJobSequence: next };
      }
    });

    const saved = await this.findById(company.id);
    if (saved === null) throw new Error(`${company.name} vanished during save.`);
    return saved;
  }

  allocateJobNumber(
    companyId: CompanyId,
  ): Promise<{ readonly jobNumber: string; readonly sequence: number }> {
    const snapshot = this.context.read();
    const record = snapshot.companies.find((candidate) => candidate.id === companyId);
    if (record === undefined) {
      return Promise.reject(new CompanyRuleError('unknown_company', `There is no company "${companyId}".`));
    }
    const company = toDomain(record, snapshot);
    const sequence = company.nextJobSequence;
    this.context.commit((draft) => {
      if (companyId === DEFAULT_COMPANY_ID) {
        draft.settings = { ...draft.settings, nextJobSequence: sequence + 1 };
      } else {
        draft.companies = draft.companies.map((candidate) =>
          candidate.id === companyId
            ? { ...candidate, nextJobSequence: sequence + 1, lastIssuedJobSequence: sequence }
            : candidate,
        );
      }
    });
    return Promise.resolve({ jobNumber: formatJobNumber(company.jobNumberPrefix, sequence), sequence });
  }
}

/**
 * The record as the domain sees it: EJE's details and counter from the settings
 * record (which the settings screen writes), and whether numbers have been
 * issued from the jobs and the counter.
 */
const toDomain = (record: DemoCompanyRecord, snapshot: DemoDatabase): Company => {
  const { lastIssuedJobSequence, ...company } = record;
  const hasJobs = snapshot.jobs.some((job) => job.companyId === record.id);
  if (record.id === DEFAULT_COMPANY_ID) {
    return {
      ...withSettingsMirrored(company, snapshot.settings),
      nextJobSequence: snapshot.settings.nextJobSequence,
      jobNumbersIssued: hasJobs || snapshot.settings.nextJobSequence !== record.jobNumberStart,
    };
  }
  return { ...company, jobNumbersIssued: hasJobs || lastIssuedJobSequence !== null };
};
