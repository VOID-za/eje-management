import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import {
  asCompanyId,
  asUserId,
  assertCompanySaveAllowed,
  CompanyRuleError,
  DEFAULT_COMPANY_ID,
  nextSequenceAfterStart,
  type Company,
  type CompanyId,
  type IsoDateTime,
} from '@/domain';
import type { CompanyRepository } from '@/data/repositories';
import type { DatabaseExecutor } from '@/db/client';
import * as schema from '@/db/schema';
import { vatBasisPointsFromPercent, vatPercentFromBasisPoints } from './job-mapper';
import { VersionLedger, requireWritten } from './versions';

type CompanyRow = typeof schema.companies.$inferSelect;

/** Where a company's numbering stands, read from wherever it is kept. */
interface Numbering {
  readonly nextJobSequence: number;
  readonly jobNumbersIssued: boolean;
}

/**
 * The companies, in PostgreSQL. MULTI-CO-1, migration 0058.
 *
 * NUMBERING IS READ, NEVER WRITTEN BACK. EJE's next number is the state of
 * `eje_job_number_seq` — the sequence the release before companies also draws
 * from — and any other company's is its `next_job_sequence`, advanced only by
 * `allocate_company_job_number()`. A save moves either only through the start
 * rule, and only forward once a number has been issued
 * (`jobNumberStartProblem`).
 *
 * SAVING EJE WRITES THE SETTINGS ROW TOO. The release before companies reads
 * EJE's details and rates from `system_settings`, so they are mirrored there;
 * the database mirrors the other way (`system_settings_mirror_to_eje`), and
 * finding nothing different it does nothing.
 */
export class PostgresCompanyRepository implements CompanyRepository {
  private readonly versions = new VersionLedger();

  constructor(private readonly db: DatabaseExecutor) {}

  async list(): Promise<readonly Company[]> {
    const rows = await this.rows();
    this.versions.rememberAll(rows);
    return Promise.all(rows.map(async (row) => this.toDomain(row, await this.numberingOf(row))));
  }

  async findById(id: CompanyId): Promise<Company | null> {
    const row = await this.row(id);
    if (row === null) return null;
    this.versions.remember(row.id, row.version);
    return this.toDomain(row, await this.numberingOf(row));
  }

  async save(company: Company): Promise<Company> {
    /*
     * The row LOCKED for the rest of the transaction: an allocation for this
     * company waits behind the save, so the numbering the start rule is
     * checked against cannot move underneath it.
     */
    const lockedRows = await this.db
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.id, company.id))
      .for('update');
    const locked = lockedRows[0] ?? null;
    const existing = locked === null ? null : this.toDomain(locked, await this.numberingOf(locked));
    // Read WITHOUT remembering versions: the version this caller is held to is
    // the one it read before deciding to save, not the one stored now.
    const all = await Promise.all(
      (await this.rows()).map(async (row) => this.toDomain(row, await this.numberingOf(row))),
    );

    assertCompanySaveAllowed(company, existing, all);
    await this.refuseIssuedPrefix(company);

    const values = {
      code: company.code.trim(),
      name: company.name.trim(),
      registration: company.registration,
      vatNumber: company.vatNumber,
      physicalAddress: company.physicalAddress,
      postalAddress: company.postalAddress,
      phone: company.phone,
      fax: company.fax,
      email: company.email,
      notificationSenderName: company.notificationSenderName,
      notificationReplyTo: company.notificationReplyTo,
      letterheadStorageKey: company.letterhead?.storageKey ?? null,
      letterheadContentType: company.letterhead?.contentType ?? null,
      letterheadSha256: company.letterhead?.sha256 ?? null,
      letterheadUploadedAt: company.letterhead?.uploadedAt ?? null,
      letterheadUploadedBy: company.letterhead?.uploadedBy ?? null,
      jobNumberPrefix: company.jobNumberPrefix,
      jobNumberStart: company.jobNumberStart,
      labourNormalCents: company.rates.labourRates.normal,
      labourOvertimeCents: company.rates.labourRates.overtime,
      labourDoubleCents: company.rates.labourRates.double,
      calloutRateCents: company.rates.calloutRate,
      testBenchFeeCents: company.rates.testBenchFee,
      kilometreRateCents: company.rates.kilometreRate,
      vatPercentBasisPoints: vatBasisPointsFromPercent(company.rates.vatPercentage),
    } as const;

    const isEje = company.id === DEFAULT_COMPANY_ID;

    if (locked === null || existing === null) {
      // A new company counts from its start; EJE always exists (migration 0058).
      const inserted = await this.db
        .insert(schema.companies)
        .values({
          id: company.id,
          ...values,
          nextJobSequence: company.jobNumberStart,
          isDefault: false,
        })
        .returning();
      this.versions.rememberAll(inserted);
    } else {
      const next = nextSequenceAfterStart(existing, company.jobNumberStart);
      if (isEje && company.jobNumberStart !== existing.jobNumberStart) {
        await this.moveEjeSequence(company.jobNumberStart, existing.jobNumbersIssued);
      }
      const expected = this.versions.expected(company.id, locked.version);
      const updated = await this.db
        .update(schema.companies)
        .set({
          ...values,
          ...(isEje ? {} : { nextJobSequence: next }),
          updatedAt: sql`now()`,
          version: expected + 1,
        })
        .where(and(eq(schema.companies.id, company.id), eq(schema.companies.version, expected)))
        .returning({ id: schema.companies.id, version: schema.companies.version });
      const written = requireWritten(updated, 'Company', company.name, expected);
      this.versions.remember(written.id, written.version);
    }

    if (isEje) await this.mirrorToSettings(company);

    const saved = await this.findById(company.id);
    if (saved === null) throw new Error(`${company.name} vanished during save.`);
    return saved;
  }

  async allocateJobNumber(
    companyId: CompanyId,
  ): Promise<{ readonly jobNumber: string; readonly sequence: number }> {
    // Asked first, so an unknown company is a sentence rather than an aborted transaction.
    if ((await this.row(companyId)) === null) {
      throw new CompanyRuleError('unknown_company', `There is no company "${companyId}".`);
    }
    const result = await this.db.execute<{ seq: number; job_number: string }>(
      sql`select * from allocate_company_job_number(${companyId})`,
    );
    const row = [...result][0];
    if (row === undefined) {
      throw new Error('allocate_company_job_number() returned nothing; migration 0058 may not have run.');
    }
    return { jobNumber: row.job_number, sequence: Number(row.seq) };
  }

  /* ---------------------------------------------------------------------- */

  private async rows(): Promise<readonly CompanyRow[]> {
    return this.db
      .select()
      .from(schema.companies)
      .orderBy(desc(schema.companies.isDefault), asc(schema.companies.name));
  }

  private async row(id: CompanyId): Promise<CompanyRow | null> {
    const rows = await this.db
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * A prefix another company's EXISTING job numbers already begin with is
   * refused: those numbers keep their company whatever its prefix is now. The
   * database refuses the same (`companies_prefix_distinct`); asked here first
   * so the refusal is a sentence.
   */
  private async refuseIssuedPrefix(company: Company): Promise<void> {
    const prefix = company.jobNumberPrefix;
    const clash = await this.db
      .select({ jobNumber: schema.jobs.jobNumber })
      .from(schema.jobs)
      .where(
        and(
          ne(schema.jobs.companyId, company.id),
          sql`upper(left(${schema.jobs.jobNumber}, ${prefix.length})) = ${prefix}`,
        ),
      )
      .limit(1);
    if (clash[0] !== undefined) {
      throw new CompanyRuleError(
        'job_number_prefix_conflict',
        `${prefix} cannot be used: ${clash[0].jobNumber} already belongs to another company.`,
      );
    }
  }

  /**
   * EJE's start, applied to its sequence. Forward only once numbers are issued
   * (`advance_job_number_sequence`, migration 0001); before then it IS the
   * initial value and is set outright.
   */
  private async moveEjeSequence(start: number, issued: boolean): Promise<void> {
    await this.db.execute(
      issued
        ? sql`select advance_job_number_sequence(${start})`
        : sql`select setval('eje_job_number_seq', ${start}, false)`,
    );
  }

  /** EJE's details and rates, written where the release before companies reads them. */
  private async mirrorToSettings(company: Company): Promise<void> {
    await this.db
      .update(schema.systemSettings)
      .set({
        companyName: company.name.trim(),
        companyRegistration: company.registration,
        companyVatNumber: company.vatNumber,
        companyPhone: company.phone,
        companyEmail: company.email,
        companyAddress: company.physicalAddress,
        jobNumberPrefix: company.jobNumberPrefix,
        labourNormalCents: company.rates.labourRates.normal,
        labourOvertimeCents: company.rates.labourRates.overtime,
        labourDoubleCents: company.rates.labourRates.double,
        calloutRateCents: company.rates.calloutRate,
        testBenchFeeCents: company.rates.testBenchFee,
        kilometreRateCents: company.rates.kilometreRate,
        vatPercentBasisPoints: vatBasisPointsFromPercent(company.rates.vatPercentage),
        updatedAt: sql`now()`,
        version: sql`${schema.systemSettings.version} + 1`,
      })
      .where(eq(schema.systemSettings.id, 1));
  }

  /**
   * Where the numbering stands. EJE: the sequence (`is_called` false means
   * `last_value` IS the next number) and whether any EJE job exists. Any other
   * company: its own counter and the last number it handed out.
   */
  private async numberingOf(row: CompanyRow): Promise<Numbering> {
    const jobs = await this.db
      .select({ seq: schema.jobs.jobNumberSeq })
      .from(schema.jobs)
      .where(eq(schema.jobs.companyId, row.id))
      .orderBy(desc(schema.jobs.jobNumberSeq))
      .limit(1);
    const highestStored = jobs[0]?.seq ?? null;

    if (row.id === DEFAULT_COMPANY_ID) {
      const result = await this.db.execute<{ last_value: string; is_called: boolean }>(
        sql`select last_value, is_called from eje_job_number_seq`,
      );
      const sequence = [...result][0];
      if (sequence === undefined) throw new Error('eje_job_number_seq is missing; migration 0001 has not run.');
      const next = Number(sequence.last_value) + (sequence.is_called ? 1 : 0);
      return {
        nextJobSequence: Math.max(next, (highestStored ?? 0) + 1),
        jobNumbersIssued: sequence.is_called || highestStored !== null,
      };
    }

    const next = row.nextJobSequence ?? row.jobNumberStart;
    return {
      nextJobSequence: Math.max(next, (highestStored ?? 0) + 1),
      jobNumbersIssued: row.lastIssuedJobSequence !== null || highestStored !== null,
    };
  }

  private toDomain(row: CompanyRow, numbering: Numbering): Company {
    return {
      id: asCompanyId(row.id),
      code: row.code,
      name: row.name,
      registration: row.registration,
      vatNumber: row.vatNumber,
      physicalAddress: row.physicalAddress,
      postalAddress: row.postalAddress,
      phone: row.phone,
      fax: row.fax,
      email: row.email,
      notificationSenderName: row.notificationSenderName,
      notificationReplyTo: row.notificationReplyTo,
      letterhead:
        row.letterheadStorageKey === null ||
        row.letterheadContentType === null ||
        row.letterheadSha256 === null ||
        row.letterheadUploadedAt === null
          ? null
          : {
              storageKey: row.letterheadStorageKey,
              contentType: row.letterheadContentType,
              sha256: row.letterheadSha256,
              uploadedAt: row.letterheadUploadedAt as IsoDateTime,
              uploadedBy: row.letterheadUploadedBy === null ? null : asUserId(row.letterheadUploadedBy),
            },
      jobNumberPrefix: row.jobNumberPrefix,
      jobNumberStart: row.jobNumberStart,
      nextJobSequence: numbering.nextJobSequence,
      jobNumbersIssued: numbering.jobNumbersIssued,
      rates: {
        labourRates: {
          normal: row.labourNormalCents,
          overtime: row.labourOvertimeCents,
          double: row.labourDoubleCents,
        },
        calloutRate: row.calloutRateCents,
        testBenchFee: row.testBenchFeeCents,
        kilometreRate: row.kilometreRateCents,
        vatPercentage: vatPercentFromBasisPoints(row.vatPercentBasisPoints),
      },
      isDefault: row.isDefault,
      createdAt: row.createdAt as IsoDateTime,
      updatedAt: row.updatedAt as IsoDateTime,
    };
  }
}
