import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { asUserId, DEFAULT_COMPANY_ID, WD_HEARN_JHB_COMPANY_ID, type CompanyLetterhead, type IsoDateTime } from '@/domain';
import { PostgresCompanyRepository } from './company-repository';
import { openTestDatabase, testDatabaseUrl, truncateAll } from './test-database';
import { IDS, seedBaseline } from './test-fixtures';

/**
 * A COMPANY'S LETTERHEAD ON POSTGRESQL. LETTERHEAD-1, the columns migration
 * 0058 left for it (`companies.letterhead_*`).
 *
 * Through the repository: set, read back exactly, kept by a save of the other
 * details, and cleared — and at the database, `companies_letterhead_complete`
 * refuses half a letterhead (a key without its type or checksum, a checksum
 * that is not one).
 *
 * Run with `npm run db:test`. Skipped where there is no `TEST_DATABASE_URL`.
 */
const url = testDatabaseUrl();
const describeDb = url === null ? describe.skip : describe;

const LETTERHEAD: CompanyLetterhead = {
  storageKey: 'uploads/letterheads/wd-hearn.png',
  contentType: 'image/png',
  sha256: 'a'.repeat(64),
  uploadedAt: '2026-11-15T08:00:00.000Z' as IsoDateTime,
  uploadedBy: asUserId(IDS.master),
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

describeDb('a company’s letterhead on PostgreSQL', () => {
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

  it('is set, read back exactly, kept by a details save, and cleared — one company only', async () => {
    const companies = new PostgresCompanyRepository(db);
    const wd = (await companies.findById(WD_HEARN_JHB_COMPANY_ID))!;
    expect(wd.letterhead).toBeNull();
    await companies.save({ ...wd, letterhead: LETTERHEAD });

    const reread = new PostgresCompanyRepository(db);
    const stored = (await reread.findById(WD_HEARN_JHB_COMPANY_ID))!;
    expect(stored.letterhead).toEqual(LETTERHEAD);
    expect((await reread.findById(DEFAULT_COMPANY_ID))!.letterhead).toBeNull();

    // Saving the company's other details does not touch its letterhead.
    await reread.save({ ...stored, phone: '011 000 0000' });
    const afterDetails = (await new PostgresCompanyRepository(db).findById(WD_HEARN_JHB_COMPANY_ID))!;
    expect(afterDetails.phone).toBe('011 000 0000');
    expect(afterDetails.letterhead).toEqual(LETTERHEAD);

    const clearing = new PostgresCompanyRepository(db);
    const current = (await clearing.findById(WD_HEARN_JHB_COMPANY_ID))!;
    await clearing.save({ ...current, letterhead: null });
    expect((await new PostgresCompanyRepository(db).findById(WD_HEARN_JHB_COMPANY_ID))!.letterhead).toBeNull();
    const [row] = await db.execute<{ key: string | null; sha: string | null }>(
      sql`select letterhead_storage_key as key, letterhead_sha256 as sha from companies where id = ${WD_HEARN_JHB_COMPANY_ID}`,
    );
    expect(row).toEqual({ key: null, sha: null });
  });

  it('EJE’s letterhead survives the settings mirror', async () => {
    const companies = new PostgresCompanyRepository(db);
    const eje = (await companies.findById(DEFAULT_COMPANY_ID))!;
    await companies.save({ ...eje, letterhead: { ...LETTERHEAD, storageKey: 'uploads/letterheads/eje.png' } });
    // The release before companies writes EJE's details through the settings row; the mirror leaves the letterhead.
    await db.execute(sql`update system_settings set company_phone = '011 999 9999'`);
    const stored = (await new PostgresCompanyRepository(db).findById(DEFAULT_COMPANY_ID))!;
    expect(stored.letterhead?.storageKey).toBe('uploads/letterheads/eje.png');
  });

  it('refuses half a letterhead at the database', async () => {
    const missingChecksum = await refusalOf(
      db.execute(sql`
        update companies set letterhead_storage_key = 'x', letterhead_content_type = 'image/png', letterhead_uploaded_at = now()
        where id = ${WD_HEARN_JHB_COMPANY_ID}
      `),
    );
    expect(missingChecksum).toContain('companies_letterhead_complete');

    const notAChecksum = await refusalOf(
      db.execute(sql`
        update companies set letterhead_storage_key = 'x', letterhead_content_type = 'image/png',
          letterhead_sha256 = 'NOT-A-HASH', letterhead_uploaded_at = now()
        where id = ${WD_HEARN_JHB_COMPANY_ID}
      `),
    );
    expect(notAChecksum).toContain('companies_letterhead_complete');
  });
});
