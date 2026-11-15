import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase, type Database } from '@/db/client';
import {
  asCustomerId,
  CompanyRuleError,
  DEFAULT_COMPANY_ID,
  WD_HEARN_JHB_COMPANY_ID,
} from '@/domain';
import { PostgresCompanyRepository } from './company-repository';
import { PostgresCustomerRepository } from './customer-repository';
import { PostgresJobRepository } from './job-repository';
import { openTestDatabase, testDatabaseUrl, truncateAll } from './test-database';
import { IDS, jobFixture, seedBaseline } from './test-fixtures';
import { withTransaction } from './transaction';

/**
 * TWO COMPANIES ON POSTGRESQL. MULTI-CO-1, migration 0058.
 *
 * What a demonstration-store test cannot hold: that the migration records
 * every existing job and customer as EJE's, that the database itself refuses a
 * job changing company and two companies' numbers looking alike, that the
 * sequence is unique per company while the number stays unique overall, that
 * concurrent allocation never hands out the same WD Hearn number — and that
 * `allocate_job_number()`, which the release before companies calls, still
 * draws from the very sequence EJE's new allocation does, so the two can never
 * collide.
 *
 * Run with `npm run db:test`. Skipped where there is no `TEST_DATABASE_URL`.
 */
const url = testDatabaseUrl();
const describeDb = url === null ? describe.skip : describe;

const MIGRATIONS = join(process.cwd(), 'src/db/migrations');

/** A migrations folder holding exactly the migrations up to `lastTag` (as `upgrade-0030.db.test.ts`). */
const folderThrough = (lastTag: string): string => {
  const out = mkdtempSync(join(tmpdir(), 'eje-migrations-'));
  mkdirSync(join(out, 'meta'));
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  const cut = journal.entries.findIndex((entry) => entry.tag === lastTag);
  if (cut < 0) throw new Error(`${lastTag} is not in the journal`);
  const entries = journal.entries.slice(0, cut + 1);
  writeFileSync(join(out, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }, null, 2));
  for (const entry of entries) copyFileSync(join(MIGRATIONS, `${entry.tag}.sql`), join(out, `${entry.tag}.sql`));
  return out;
};

/** Every message in the chain: the driver wraps PostgreSQL's in "Failed query: …". */
const refusalOf = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
  } catch (error) {
    let current: unknown = error;
    const said: string[] = [];
    for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
      said.push(current.message);
      current = (current as { cause?: unknown }).cause;
    }
    return said.join(' | ');
  }
  throw new Error('that statement was expected to be refused, and was not');
};

/** A job inserted the way the release before companies inserts one: no company named. */
const insertWithoutCompany = (db: Database, id: string, jobNumber: string, seq: number) =>
  db.execute(sql`
    insert into jobs (id, job_number, job_number_seq, customer_id, site_id, contact_id, machine_id, job_type_code, priority, status)
    values (${id}, ${jobNumber}, ${seq}, ${IDS.customer}, ${IDS.site}, ${IDS.contact}, ${IDS.machine}, 'breakdown', 'urgent', 'open')
  `);

describeDb('migration 0058 over a database already holding EJE’s jobs and customers', () => {
  let db: Database;
  let through0057: string;

  beforeAll(async () => {
    db = createDatabase({ connectionString: url ?? '', maxConnections: 2 });
    await db.execute(sql`drop schema if exists public cascade`);
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`create schema public`);
    through0057 = folderThrough('0057_user_timesheet_required');
    await migrate(db, { migrationsFolder: through0057 });
    await seedBaseline(db);
    // The live settings say more than the test baseline does.
    await db.execute(sql`update system_settings set company_phone = '+27 11 555 0100', test_bench_fee_cents = 45000 where id = 1`);
    await db.execute(sql`select setval('eje_job_number_seq', 2120, true)`);
    await insertWithoutCompany(db, '00000000-0000-4000-8000-000000058001', 'EJE-2120', 2120);
    await migrate(db, { migrationsFolder: MIGRATIONS });
  }, 120_000);

  afterAll(async () => {
    rmSync(through0057, { recursive: true, force: true });
    await db?.$client.end({ timeout: 5 });
  });

  it('records every existing job as EJE’s, and every existing customer as EJE’s customer', async () => {
    const jobs = await db.execute<{ company_id: string }>(sql`select company_id from jobs`);
    expect(jobs.map((row) => row.company_id)).toEqual(['eje']);
    const links = await db.execute<{ customer_id: string; company_id: string }>(
      sql`select customer_id, company_id from customer_companies order by customer_id`,
    );
    expect(links.map((row) => [row.customer_id, row.company_id])).toEqual([
      [IDS.customer, 'eje'],
      [IDS.otherCustomer, 'eje'],
    ]);
  });

  it('creates EJE from the settings row, and WD Hearn JHB with nothing invented and EJE’s rates to start from', async () => {
    const [eje, wdHearn] = await db.execute<Record<string, unknown>>(sql`select * from companies order by is_default desc`);
    expect(eje).toMatchObject({
      id: 'eje', name: 'EJE Industrial Electronics', phone: '+27 11 555 0100', job_number_prefix: 'EJE-',
      job_number_start: 2121, next_job_sequence: null, is_default: true,
    });
    expect(wdHearn).toMatchObject({
      id: 'wd-hearn-jhb', name: 'WD Hearn JHB', job_number_prefix: 'WDJ-', job_number_start: 1, next_job_sequence: 1,
      registration: '', vat_number: '', physical_address: '', postal_address: '', phone: '', fax: '', email: '',
      letterhead_storage_key: null, is_default: false,
    });
    for (const rate of ['labour_normal_cents', 'labour_overtime_cents', 'labour_double_cents', 'callout_rate_cents',
      'test_bench_fee_cents', 'kilometre_rate_cents', 'vat_percent_basis_points']) {
      expect(String(wdHearn?.[rate]), rate).toBe(String(eje?.[rate]));
    }
  });

  it('keeps EJE numbering where it was: the next EJE job is EJE-2121, from either function', async () => {
    const [legacy] = await db.execute<{ job_number: string }>(sql`select job_number from allocate_job_number()`);
    const [current] = await db.execute<{ job_number: string }>(sql`select job_number from allocate_company_job_number('eje')`);
    expect([legacy?.job_number, current?.job_number]).toEqual(['EJE-2121', 'EJE-2122']);
  });
});

describeDb('two companies on PostgreSQL', () => {
  let db: Database;

  beforeAll(async () => {
    db = await openTestDatabase(url ?? '');
  }, 120_000);

  afterAll(async () => {
    await db.$client.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await truncateAll(db);
    await seedBaseline(db);
  });

  describe('numbering', () => {
    it('numbers WD Hearn JHB from WDJ-0001, independently of EJE', async () => {
      const companies = new PostgresCompanyRepository(db);
      const first = await companies.allocateJobNumber(WD_HEARN_JHB_COMPANY_ID);
      const eje = await companies.allocateJobNumber(DEFAULT_COMPANY_ID);
      const second = await companies.allocateJobNumber(WD_HEARN_JHB_COMPANY_ID);
      expect([first.jobNumber, second.jobNumber, eje.jobNumber]).toEqual(['WDJ-0001', 'WDJ-0002', 'EJE-1068']);
    });

    it('hands N concurrent WD Hearn allocations N distinct, consecutive numbers', async () => {
      // A pool of its own, so the allocations really do run at the same time.
      const pool = createDatabase({ connectionString: url ?? '', maxConnections: 6 });
      try {
        const allocated = await Promise.all(
          Array.from({ length: 12 }, () =>
            withTransaction(pool, (tx) => new PostgresCompanyRepository(tx).allocateJobNumber(WD_HEARN_JHB_COMPANY_ID)),
          ),
        );
        expect(allocated.map((entry) => entry.sequence).sort((a, b) => a - b)).toEqual(
          Array.from({ length: 12 }, (_, index) => index + 1),
        );
        expect(new Set(allocated.map((entry) => entry.jobNumber)).size).toBe(12);
      } finally {
        await pool.$client.end({ timeout: 5 });
      }
    });

    it('leaves no gap when the transaction that allocated rolls back', async () => {
      await expect(
        withTransaction(db, async (tx) => {
          await new PostgresCompanyRepository(tx).allocateJobNumber(WD_HEARN_JHB_COMPANY_ID);
          throw new Error('the job was refused after its number was allocated');
        }),
      ).rejects.toThrow('refused');
      expect((await new PostgresCompanyRepository(db).allocateJobNumber(WD_HEARN_JHB_COMPANY_ID)).jobNumber).toBe('WDJ-0001');
    });

    it('still serves allocate_job_number(), the release before companies, from EJE’s own sequence', async () => {
      const [legacy] = await db.execute<{ job_number: string; seq: number }>(sql`select * from allocate_job_number()`);
      const current = await new PostgresCompanyRepository(db).allocateJobNumber(DEFAULT_COMPANY_ID);
      expect(legacy?.job_number).toBe('EJE-1068');
      expect(current.jobNumber).toBe('EJE-1069');
    });

    it('refuses a company nobody knows', async () => {
      await expect(new PostgresCompanyRepository(db).allocateJobNumber('nobody' as typeof DEFAULT_COMPANY_ID)).rejects.toBeInstanceOf(
        CompanyRuleError,
      );
      expect(await refusalOf(db.execute(sql`select * from allocate_company_job_number('nobody')`))).toContain(
        'there is no company nobody',
      );
    });
  });

  describe('a job’s company', () => {
    it('is EJE when the inserting code names none (the release before companies)', async () => {
      await insertWithoutCompany(db, '00000000-0000-4000-8000-000000058002', 'EJE-1068', 1068);
      const [row] = await db.execute<{ company_id: string }>(sql`select company_id from jobs`);
      expect(row?.company_id).toBe('eje');
    });

    it('is written by the repository, and never changes — refused by the repository and by the database', async () => {
      const jobs = new PostgresJobRepository(db);
      const allocated = await new PostgresCompanyRepository(db).allocateJobNumber(WD_HEARN_JHB_COMPANY_ID);
      const job = await jobs.save(jobFixture(allocated.jobNumber, { companyId: WD_HEARN_JHB_COMPANY_ID }));
      expect(job.companyId).toBe(WD_HEARN_JHB_COMPANY_ID);

      await expect(jobs.save({ ...job, companyId: DEFAULT_COMPANY_ID })).rejects.toThrow(
        "a job's company is fixed when it is raised",
      );
      expect(
        await refusalOf(db.execute(sql`update jobs set company_id = 'eje' where id = ${job.id}`)),
      ).toContain('cannot be moved to eje');
      // Every other field still saves.
      const edited = await jobs.save({ ...job, faultDescription: 'Spindle drive alarm 751.' });
      expect([edited.companyId, edited.faultDescription]).toEqual([WD_HEARN_JHB_COMPANY_ID, 'Spindle drive alarm 751.']);
    });

    it('makes the sequence unique per company, and the job number unique overall', async () => {
      const jobs = new PostgresJobRepository(db);
      await jobs.save(jobFixture('EJE-0001'));
      // The same NUMBER under another company — refused, though its sequence is free there.
      expect(
        await refusalOf(jobs.save(jobFixture('EJE-0001', { companyId: WD_HEARN_JHB_COMPANY_ID }))),
      ).toContain('jobs_job_number_key');
      // The same SEQUENCE in another company — accepted: EJE-0001 and WDJ-0001 are both 1.
      await jobs.save(jobFixture('WDJ-0001', { companyId: WD_HEARN_JHB_COMPANY_ID }));
      // The same sequence within a company — refused, even under another number.
      expect(
        await refusalOf(jobs.save(jobFixture('WDJ-00001', { companyId: WD_HEARN_JHB_COMPANY_ID }))),
      ).toContain('jobs_company_job_number_seq_key');
    });
  });

  describe('the companies themselves', () => {
    it('refuses, in the database, a prefix another company’s numbers could be confused with', async () => {
      expect(
        await refusalOf(db.execute(sql`update companies set job_number_prefix = 'EJE-' where id = 'wd-hearn-jhb'`)),
      ).toContain('conflicts with another company');
      await new PostgresJobRepository(db).save(jobFixture('EJE-1068'));
      expect(
        await refusalOf(db.execute(sql`update companies set job_number_prefix = 'WDJ-' where id = 'eje'`)),
      ).toContain('conflicts with another company');
      expect(
        await refusalOf(db.execute(sql`update companies set job_number_prefix = 'wdj' where id = 'wd-hearn-jhb'`)),
      ).toContain('companies_job_number_prefix_shape');
    });

    it('refuses, in the repository, a prefix an existing job of another company carries', async () => {
      await new PostgresJobRepository(db).save(jobFixture('ABC-0001'));
      const companies = new PostgresCompanyRepository(db);
      const wdHearn = (await companies.findById(WD_HEARN_JHB_COMPANY_ID))!;
      await expect(companies.save({ ...wdHearn, jobNumberPrefix: 'ABC-' })).rejects.toThrow(
        'ABC- cannot be used: ABC-0001 already belongs to another company.',
      );
    });

    it('sets the start freely before a number is issued, and only forward after', async () => {
      const companies = new PostgresCompanyRepository(db);
      const wdHearn = (await companies.findById(WD_HEARN_JHB_COMPANY_ID))!;
      expect((await companies.save({ ...wdHearn, jobNumberStart: 500 })).nextJobSequence).toBe(500);
      expect((await companies.allocateJobNumber(WD_HEARN_JHB_COMPANY_ID)).jobNumber).toBe('WDJ-0500');

      const active = (await companies.findById(WD_HEARN_JHB_COMPANY_ID))!;
      expect(active.jobNumbersIssued).toBe(true);
      await expect(companies.save({ ...active, jobNumberStart: 400 })).rejects.toThrow(
        'Job numbers up to 500 have already been issued',
      );
      const moved = await companies.save({ ...active, jobNumberStart: 600 });
      expect(moved.nextJobSequence).toBe(600);
      expect((await companies.allocateJobNumber(WD_HEARN_JHB_COMPANY_ID)).jobNumber).toBe('WDJ-0600');
    });

    it('keeps EJE and the settings row in step, in both directions', async () => {
      // The release before companies edits the settings row: the EJE company follows.
      await db.execute(sql`update system_settings set company_phone = '+27 11 555 0199' where id = 1`);
      const companies = new PostgresCompanyRepository(db);
      const eje = (await companies.findById(DEFAULT_COMPANY_ID))!;
      expect(eje.phone).toBe('+27 11 555 0199');

      // This release edits the EJE company: the settings row follows.
      await companies.save({ ...eje, name: 'EJE Industrial Electronics (Pty) Ltd', fax: '+27 11 555 0101' });
      const [settings] = await db.execute<{ company_name: string }>(sql`select company_name from system_settings`);
      expect(settings?.company_name).toBe('EJE Industrial Electronics (Pty) Ltd');
      expect((await companies.findById(DEFAULT_COMPANY_ID))?.fax).toBe('+27 11 555 0101');
    });
  });

  describe('a customer’s companies', () => {
    it('links a customer inserted without a company to EJE, and saves exactly the companies the record names', async () => {
      const customers = new PostgresCustomerRepository(db);
      const abc = (await customers.findById(asCustomerId(IDS.customer)))!;
      expect(abc.companyIds).toEqual([DEFAULT_COMPANY_ID]);

      const both = await customers.save({ ...abc, companyIds: [DEFAULT_COMPANY_ID, WD_HEARN_JHB_COMPANY_ID] });
      expect([...both.companyIds].sort()).toEqual(['eje', 'wd-hearn-jhb']);

      const fresh = await customers.save({
        ...abc,
        id: asCustomerId('00000000-0000-4000-8000-000000058010'),
        name: 'WD Hearn only',
        accountNumber: 'WDH-001',
        notes: [],
        companyIds: [WD_HEARN_JHB_COMPANY_ID],
      });
      // The EJE link the insert trigger wrote is gone in the same save.
      expect(fresh.companyIds).toEqual([WD_HEARN_JHB_COMPANY_ID]);

      await expect(customers.save({ ...abc, companyIds: [] })).rejects.toThrow('at least one company');
    });
  });
});
