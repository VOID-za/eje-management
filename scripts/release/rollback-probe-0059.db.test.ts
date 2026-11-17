import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@/db/client';
import { testDatabaseUrl } from '@/data/postgres/test-database';
import { IDS, jobFixture } from '@/data/postgres/test-fixtures';
import { PostgresJobRepository } from '@/data/postgres/job-repository';
import { PostgresCustomerRepository } from '@/data/postgres/customer-repository';
import { checkMigrations } from '@/ops/preflight-rules';
import { asCustomerId } from '@/domain';

/**
 * ROLLBACK COMPATIBILITY FOR 0059 — run INSIDE the release production runs today (dcdcb84, v1.15.0),
 * against a database this release migrated to 0059 (copied into that checkout by rollback-compat.sh
 * with LIVE_COMMIT=dcdcb84… and PROBE=this file).
 *
 * If this release is rolled back, dcdcb84's code meets two changes it has never heard of:
 *   - `customers_account_number_key` is PARTIAL (unique only where there is a number): its customer
 *     inserts succeed more often, never less — two customers without an account number are stored,
 *     and a real number is still refused the second time;
 *   - `jobs.parts_released_by` exists: its job repository never names the column, so reading and saving
 *     a job that carries one leaves it exactly as it was.
 * And its own preflight does not refuse a database one migration ahead of what it ships.
 *
 * Skipped unless RELEASE_ROLLBACK_PHASE=probe, so it never runs by accident.
 */
const url = testDatabaseUrl();
const requested = process.env.RELEASE_ROLLBACK_PHASE === 'probe';
if (requested && url === null) {
  throw new Error('RELEASE_ROLLBACK_PHASE=probe needs TEST_DATABASE_URL naming a disposable test database.');
}
const describePhase = requested ? describe : describe.skip;

describePhase('rollback compatibility — the live release (dcdcb84, v1.15.0) against a database at 0059', () => {
  let db: Database;
  beforeAll(() => {
    db = createDatabase({ connectionString: url ?? '', maxConnections: 2 });
  });
  afterAll(async () => {
    await db.$client.end({ timeout: 5 });
  });

  it("the live release's preflight does not refuse the database this release migrated", async () => {
    const journal = JSON.parse(readFileSync(join(process.cwd(), 'src/db/migrations/meta/_journal.json'), 'utf8')) as {
      entries: { tag: string }[];
    };
    const shipped = journal.entries.map((entry) => entry.tag);
    // dcdcb84 ships up to 0058; this release adds 0059.
    expect(shipped).toHaveLength(59);
    expect(shipped.at(-1)).toBe('0058_multi_company');
    const rows = await db.execute<{ n: string }>(sql`select count(*)::text as n from drizzle.__drizzle_migrations`);
    const applied = Number(rows[0]?.n);
    expect(applied).toBe(60);
    expect(checkMigrations(shipped, { applied, schemaPresent: true }).every((check) => check.verdict !== 'fail')).toBe(true);
  });

  it('reads and saves a job that records who released its parts, leaving that record as it is', async () => {
    const jobs = new PostgresJobRepository(db);
    const { jobNumber } = await jobs.allocateJobNumber();
    const saved = await jobs.save(jobFixture(jobNumber));
    await db.execute(sql`update jobs set parts_released_by = ${IDS.coordinator}::uuid where id = ${saved.id}`);
    const read = await jobs.findById(saved.id);
    expect(read?.jobNumber).toBe(jobNumber);
    await jobs.save({ ...read!, referenceNumber: 'Rollback probe 0059' });
    const [row] = await db.execute<{ parts_released_by: string | null; reference_number: string }>(
      sql`select parts_released_by, reference_number from jobs where id = ${saved.id}`,
    );
    expect([row?.parts_released_by, row?.reference_number]).toEqual([IDS.coordinator, 'Rollback probe 0059']);
  });

  it('stores customers without an account number, and still refuses a real number twice', async () => {
    const customers = new PostgresCustomerRepository(db);
    const base = (await customers.findById(asCustomerId(IDS.customer)))!;
    const copy = (id: string, name: string, accountNumber: string) =>
      customers.save({ ...base, id: asCustomerId(id), name, accountNumber, notes: [] });
    await copy('00000000-0000-4000-8000-000000059c01', 'Rollback probe 0059 no number A', '');
    await copy('00000000-0000-4000-8000-000000059c02', 'Rollback probe 0059 no number B', '');
    await copy('00000000-0000-4000-8000-000000059c03', 'Rollback probe 0059 numbered', 'RB-0059-N');
    await expect(copy('00000000-0000-4000-8000-000000059c04', 'Rollback probe 0059 same number', 'RB-0059-N')).rejects.toThrow();
    const [blank] = await db.execute<{ n: string }>(
      sql`select count(*)::text as n from customers where name like 'Rollback probe 0059 no number%' and account_number = ''`,
    );
    expect(blank?.n).toBe('2');
  });
});
