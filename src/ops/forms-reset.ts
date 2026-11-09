import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { decryptFile, encryptFile, keyFingerprint, readBackupKey } from '@/db/backup/crypto';
import { loadEnvFiles } from '@/db/seed/env';
import { readStorageConfiguration } from '@/services/production/file-storage';

/**
 * THE ATTENDANCE AND TIMESHEET RESET. FORMS-RESET-1 (the owner, 9 November 2026).
 *
 * The owner asked for a clean slate for a new testing cycle: ZERO attendance and
 * ZERO timesheet form records of any kind, for every person and every date —
 * drafts, open lines, completed, withdrawn, submitted, corrections — while
 * users, jobs, customers, machines and everything else stay exactly as they are.
 *
 * WHY THIS IS A TOOL AND NOT A MIGRATION. A migration runs on every database that
 * passes through it, including a backup restored next year; this runs once, on
 * purpose, by an operator, and writes its own encrypted archive first.
 *
 * ONE TRANSACTION, IN THIS ORDER, OR NOTHING:
 *   1. Lock every form table (ACCESS EXCLUSIVE): no form can be written while
 *      it is archived and cleared, so the archive is exactly what was deleted.
 *   2. Read every row of every form table, plus the records that only exist
 *      because of a form (the office's "timesheet submitted / correction"
 *      notifications, the cached responses of form requests), plus — as a copy
 *      only — the form audit events, which stay in the audit trail untouched.
 *   3. Copy the stored form PDFs, write a manifest, tar, encrypt with the backup
 *      key (AES-256-GCM, `src/db/backup/crypto.ts`), then DECRYPT IT AGAIN and
 *      check every table's row count and every file's checksum against the
 *      manifest. No plaintext is left on disk.
 *   4. Disable the form tables' own guard triggers (the write-once rules that
 *      exist precisely so the application can never delete these rows), delete
 *      children first, re-enable exactly the triggers that were enabled.
 *   5. Prove it: every form table empty, the triggers as they were, and every
 *      OTHER table's fingerprint identical to before (foreign keys stay enforced
 *      throughout — nothing outside the form tables references them, and a
 *      restrict would refuse the delete rather than orphan anything).
 *   `--dry-run` does all of it and rolls back. Only after the commit are the
 *   stored form PDFs removed (they are in the archive).
 *
 * REFUSED, NOT GUESSED: a Finance package exists (it is a payroll record built
 * from submissions — deleting it is the owner's decision, not this tool's); the
 * expected counts given by the operator differ from what is there; the archive
 * does not verify.
 */

/** Children first: each table is deleted before any table it references. */
export const FORM_TABLES = [
  'payroll_form_correction_drafts',
  'payroll_form_completions',
  'monthly_submissions',
  'payroll_submissions',
  'timesheet_submitted_lines',
  'timesheet_corrections',
  'timesheet_periods',
  'timesheet_months',
  'timesheet_entries',
  'timesheet_line_drafts',
  'timesheet_line_removals',
  'timesheet_working_comments',
  'timesheet_comments',
  'payroll_document_names',
  'attendance',
] as const;

export type FormTable = (typeof FORM_TABLES)[number];

/** Rows of shared tables that exist only because of a form. Archived and deleted. */
export const ASSOCIATED = {
  notifications: `type in ('timesheet_submitted', 'timesheet_correction_requested', 'timesheet_correction_decided')`,
  api_idempotency: `operation ~ '^(attendance|timesheets|payroll)\\.'`,
} as const;

/** Copied into the archive as evidence; NEVER deleted — the audit trail is append-only. */
export const AUDIT_COPY = `type ~ '^(attendance|timesheet|payroll|monthly)_'`;

/** The only storage prefixes this tool reads or removes. */
export const FORM_STORAGE_PREFIXES = ['payroll-completions', 'payroll-submissions'] as const;

/** Tables that must be empty before the reset: a Finance package is not this tool's to delete. */
const MUST_BE_EMPTY = ['finance_packages'] as const;

export type Counts = Record<string, number>;

export interface ResetOptions {
  readonly archiveRoot: string;
  readonly storageRoot: string;
  readonly key: Buffer;
  readonly dryRun: boolean;
  /** The counts the operator inventoried beforehand; any difference refuses. */
  readonly expect?: Counts;
  readonly now?: Date;
  readonly log?: (line: string) => void;
}

export interface ResetResult {
  readonly dryRun: boolean;
  readonly archive: string;
  readonly archiveSha256: string;
  readonly archiveBytes: number;
  readonly keyFingerprint: string;
  readonly before: Counts;
  readonly after: Counts;
  readonly auditCopied: number;
  readonly files: readonly string[];
  readonly filesRemoved: number;
  readonly othersUnchanged: number;
}

export class ResetRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResetRefused';
  }
}

const ident = (name: string): string => `"${name.replaceAll('"', '""')}"`;

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

const stamp = (now: Date): string => now.toISOString().replace(/\.\d{3}Z$/u, 'Z').replaceAll(':', '-');

type Querier = Sql | TransactionSql;

/** How many rows each form table and each associated subset holds now. */
export const countForms = async (sql: Querier): Promise<Counts> => {
  const counts: Counts = {};
  for (const table of [...FORM_TABLES, ...MUST_BE_EMPTY]) {
    const [row] = await sql.unsafe<{ count: string }[]>(`select count(*)::text as count from ${ident(table)}`);
    counts[table] = Number(row?.count ?? 0);
  }
  for (const [table, where] of Object.entries(ASSOCIATED)) {
    const [row] = await sql.unsafe<{ count: string }[]>(`select count(*)::text as count from ${ident(table)} where ${where}`);
    counts[`${table} (form)`] = Number(row?.count ?? 0);
  }
  return counts;
};

/**
 * Every public table this tool does not clear, fingerprinted row by row (for the
 * two shared tables, the rows it keeps). The same snapshot is read before and
 * after the deletes; any difference means the reset reached something it must not.
 */
export const fingerprintOthers = async (sql: Querier): Promise<Record<string, string>> => {
  const tables = await sql<{ name: string }[]>`
    select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' order by 1`;
  const prints: Record<string, string> = {};
  for (const { name } of tables) {
    if ((FORM_TABLES as readonly string[]).includes(name)) continue;
    const where = (ASSOCIATED as Record<string, string>)[name];
    const [row] = await sql.unsafe<{ rows: string; print: string }[]>(
      `select count(*)::text as rows, md5(coalesce(string_agg(md5(t::text), ',' order by md5(t::text)), '')) as print
       from ${ident(name)} t ${where === undefined ? '' : `where not (${where})`}`,
    );
    prints[name] = `${row?.rows}:${row?.print}`;
  }
  return prints;
};

/** Every stored file under the form prefixes: what the rows name, and anything left beside them. */
export const formStorageFiles = (storageRoot: string): string[] => {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(relative(storageRoot, path).split(sep).join('/'));
      else throw new ResetRefused(`${path} is neither a file nor a directory; it is left for an operator.`);
    }
  };
  for (const prefix of FORM_STORAGE_PREFIXES) {
    const root = join(storageRoot, prefix);
    if (existsSync(root)) walk(root);
  }
  return files.sort();
};

const storageKeysNamed = async (sql: Querier): Promise<string[]> => {
  const rows = await sql<{ key: string }[]>`
    select document->>'storageKey' as key from payroll_form_completions
    union select d->>'storageKey' from payroll_submissions, jsonb_array_elements(documents) d`;
  return rows.map((row) => row.key).filter((key): key is string => typeof key === 'string' && key.length > 0);
};

const run = (command: string, args: readonly string[]): void => {
  const result = spawnSync(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    throw new ResetRefused(`${command} ${args[0]} failed: ${String(result.stderr ?? '').trim() || `exit ${result.status}`}`);
  }
};

interface Manifest {
  readonly kind: 'eje-forms-reset-archive';
  readonly createdAt: string;
  readonly database: string;
  readonly migrations: number;
  readonly counts: Counts;
  readonly auditCopied: number;
  readonly files: Record<string, string>;
}

/**
 * Reads, archives, deletes and proves, in one transaction. Throws (and rolls
 * back) on any refusal; the archive of a refused run is removed with it.
 */
export const resetForms = async (sql: Sql, options: ResetOptions): Promise<ResetResult> => {
  const log = options.log ?? (() => undefined);
  const now = options.now ?? new Date();
  const name = `forms-reset-archive-${stamp(now)}`;
  const archiveDir = join(resolve(options.archiveRoot), name);
  const work = join(archiveDir, 'plain');
  if (existsSync(archiveDir)) throw new ResetRefused(`${archiveDir} already exists.`);
  mkdirSync(work, { recursive: true, mode: 0o700 });
  const archive = join(archiveDir, `${name}.tar.enc`);
  const fingerprint = keyFingerprint(options.key);
  let committed = false;

  try {
    const result = await sql.begin('isolation level repeatable read', async (tx) => {
      // Fail rather than queue behind the application for long: a busy form is retried, not waited on.
      await tx`set local lock_timeout = '15s'`;
      await tx.unsafe(`lock table ${[...FORM_TABLES, ...MUST_BE_EMPTY].map(ident).join(', ')} in access exclusive mode`);

      const before = await countForms(tx);
      for (const table of MUST_BE_EMPTY) {
        if ((before[table] ?? 0) > 0) {
          throw new ResetRefused(`${table} holds ${before[table]} row(s). A Finance package is a payroll record; deleting it is the owner's decision. Nothing was changed.`);
        }
      }
      if (options.expect !== undefined) {
        const differs = Object.keys({ ...options.expect, ...before }).filter((key) => (options.expect?.[key] ?? 0) !== (before[key] ?? 0));
        if (differs.length > 0) {
          throw new ResetRefused(`The forms changed since they were inventoried (${differs.map((key) => `${key}: expected ${options.expect?.[key] ?? 0}, found ${before[key] ?? 0}`).join('; ')}). Nothing was changed.`);
        }
      }
      const othersBefore = await fingerprintOthers(tx);
      const [identity] = await tx<{ database: string; migrations: number }[]>`
        select current_database() as database, (select count(*)::int from drizzle.__drizzle_migrations) as migrations`;

      // 2. Every row, exactly as stored.
      mkdirSync(join(work, 'tables'), { mode: 0o700 });
      const dump = async (file: string, query: string): Promise<number> => {
        const rows = await tx.unsafe<{ row: string }[]>(query);
        writeFileSync(join(work, 'tables', file), rows.map((row) => `${row.row}\n`).join(''), { mode: 0o600 });
        return rows.length;
      };
      const archived: Counts = {};
      for (const table of FORM_TABLES) {
        archived[table] = await dump(`${table}.jsonl`, `select row_to_json(t)::text as row from ${ident(table)} t order by t::text`);
      }
      for (const [table, where] of Object.entries(ASSOCIATED)) {
        archived[`${table} (form)`] = await dump(`${table}.form.jsonl`, `select row_to_json(t)::text as row from ${ident(table)} t where ${where} order by t::text`);
      }
      const auditCopied = await dump('audit_events.form-copy.jsonl', `select row_to_json(t)::text as row from audit_events t where ${AUDIT_COPY} order by occurred_at, id`);

      // 3. The stored PDFs: every key a row names must be there; anything else under the prefixes goes too.
      const files = formStorageFiles(options.storageRoot);
      for (const key of await storageKeysNamed(tx)) {
        if (!files.includes(`${key}.bin`)) throw new ResetRefused(`The stored form ${key} is missing; the archive would be incomplete. Nothing was changed.`);
      }
      const fileSums: Record<string, string> = {};
      for (const file of files) {
        const target = join(work, 'storage', file);
        mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
        copyFileSync(join(options.storageRoot, file), target);
        fileSums[`storage/${file}`] = sha256(target);
      }
      const manifest: Manifest = { kind: 'eje-forms-reset-archive', createdAt: now.toISOString(), database: identity!.database, migrations: identity!.migrations, counts: archived, auditCopied, files: fileSums };
      writeFileSync(join(work, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

      const tarball = join(archiveDir, 'plain.tar');
      run('tar', ['-cf', tarball, '-C', work, '.']);
      const encrypted = await encryptFile(tarball, archive, options.key);
      rmSync(tarball, { force: true });
      rmSync(work, { recursive: true, force: true });
      log(`archive  ${archive} (${encrypted.bytes} bytes, key ${fingerprint})`);

      // The archive is proved readable BEFORE anything is deleted.
      await verifyArchive(archive, options.key, manifest);
      log('archive  decrypted again: every table count and every file checksum match');

      // 4. Delete. The guards are the database's own refusal of exactly this; they come back as they were.
      const triggers = async () =>
        tx<{ name: string; enabled: string }[]>`
          select tgrelid::regclass::text || '.' || tgname as name, tgenabled::text as enabled from pg_trigger
          where not tgisinternal and tgrelid::regclass::text in ${tx(FORM_TABLES as unknown as string[])} order by 1`;
      const triggersBefore = await triggers();
      for (const table of FORM_TABLES) await tx.unsafe(`alter table ${ident(table)} disable trigger user`);
      // The two self-references first, so no row waits on another row of its own table.
      await tx`update payroll_form_completions set corrects_id = null where corrects_id is not null`;
      await tx`update payroll_submissions set superseded_at = null, superseded_by = null, superseded_by_submission = null where superseded_by_submission is not null`;
      for (const table of FORM_TABLES) await tx.unsafe(`delete from ${ident(table)}`);
      for (const [table, where] of Object.entries(ASSOCIATED)) await tx.unsafe(`delete from ${ident(table)} where ${where}`);
      for (const table of FORM_TABLES) await tx.unsafe(`alter table ${ident(table)} enable trigger user`);
      for (const trigger of triggersBefore.filter((row) => row.enabled === 'D')) {
        const [table, name] = trigger.name.split('.');
        await tx.unsafe(`alter table ${ident(table!)} disable trigger ${ident(name!)}`);
      }

      // 5. Prove it.
      const after = await countForms(tx);
      const left = Object.entries(after).filter(([, count]) => count !== 0);
      if (left.length > 0) throw new ResetRefused(`Rows remain after the delete: ${left.map(([table, count]) => `${table} ${count}`).join(', ')}.`);
      if (JSON.stringify(await triggers()) !== JSON.stringify(triggersBefore)) throw new ResetRefused('The guard triggers did not come back exactly as they were.');
      const othersAfter = await fingerprintOthers(tx);
      const changed = Object.keys(othersBefore).filter((table) => othersBefore[table] !== othersAfter[table]);
      if (changed.length > 0) throw new ResetRefused(`Tables outside the forms changed: ${changed.join(', ')}.`);
      log(`verified ${Object.keys(othersBefore).length} other tables identical; every form table empty`);

      // The reset is itself on the audit trail — appended, as every event is; nothing earlier is touched.
      const removed = Object.entries(before).filter(([, count]) => count > 0).map(([table, count]) => `${table} ${count}`).join(', ');
      await tx`
        insert into audit_events (id, occurred_at, actor_name, type, summary, detail, entity_type, metadata)
        values (${randomUUID()}, ${now.toISOString()}, 'Operator (FORMS-RESET-1)', 'forms_reset',
          'Attendance and timesheet forms reset for a new testing cycle (the owner, 9 November 2026)',
          ${`Every attendance and timesheet form record removed and archived encrypted (${name}): ${removed}. Users, jobs, customers, machines and the audit trail kept.`},
          'forms_reset', ${tx.json({ archive: name, archiveSha256: encrypted.sha256, keyFingerprint: fingerprint, counts: before, files: files.length })})`;

      const outcome = { before, after, auditCopied, files, othersUnchanged: Object.keys(othersBefore).length };
      if (options.dryRun) throw new DryRunDone(outcome);
      return outcome;
    }).catch((cause: unknown) => {
      if (cause instanceof DryRunDone) return cause.outcome;
      throw cause;
    });
    committed = !options.dryRun;

    // After the commit only: the stored PDFs, which the archive holds.
    let filesRemoved = 0;
    if (committed) {
      for (const file of result.files) {
        rmSync(join(options.storageRoot, file));
        filesRemoved += 1;
      }
      for (const prefix of FORM_STORAGE_PREFIXES) {
        const root = join(options.storageRoot, prefix);
        if (existsSync(root) && formStorageFiles(options.storageRoot).length === 0) rmSync(root, { recursive: true });
      }
      if (formStorageFiles(options.storageRoot).length > 0) throw new ResetRefused('Stored form files remain after the reset; the database is cleared and the archive holds them.');
    }
    const report: ResetResult = {
      dryRun: options.dryRun,
      archive,
      archiveSha256: sha256(archive),
      archiveBytes: statSync(archive).size,
      keyFingerprint: fingerprint,
      before: result.before,
      after: committed ? await countForms(sql) : result.after,
      auditCopied: result.auditCopied,
      files: result.files,
      filesRemoved,
      othersUnchanged: result.othersUnchanged,
    };
    writeFileSync(join(archiveDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    if (options.dryRun) rmSync(archiveDir, { recursive: true, force: true });
    return report;
  } catch (cause) {
    // Refused or failed before the commit: the database is as it was, so this run's archive goes.
    if (!committed) rmSync(archiveDir, { recursive: true, force: true });
    throw cause;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};

class DryRunDone extends Error {
  constructor(readonly outcome: { before: Counts; after: Counts; auditCopied: number; files: string[]; othersUnchanged: number }) {
    super('dry run');
  }
}

/** Decrypts the archive to a scratch directory beside it and checks it against the manifest; leaves no plaintext. */
export const verifyArchive = async (archive: string, key: Buffer, expected?: Manifest): Promise<Manifest> => {
  const scratch = join(dirname(archive), 'verify');
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true, mode: 0o700 });
  try {
    const tarball = join(scratch, 'plain.tar');
    await decryptFile(archive, tarball, key);
    mkdirSync(join(scratch, 'x'), { mode: 0o700 });
    run('tar', ['-xf', tarball, '-C', join(scratch, 'x')]);
    const manifest = JSON.parse(readFileSync(join(scratch, 'x', 'manifest.json'), 'utf8')) as Manifest;
    if (expected !== undefined && JSON.stringify(manifest) !== JSON.stringify(expected)) throw new ResetRefused('The archive manifest is not the one written.');
    for (const [table, count] of Object.entries(manifest.counts)) {
      const file = table.endsWith(' (form)') ? `${table.replace(' (form)', '')}.form.jsonl` : `${table}.jsonl`;
      const lines = readFileSync(join(scratch, 'x', 'tables', file), 'utf8').split('\n').filter((line) => line.length > 0);
      if (lines.length !== count) throw new ResetRefused(`The archive holds ${lines.length} rows of ${table}, not ${count}.`);
      for (const line of lines) JSON.parse(line);
    }
    for (const [file, sum] of Object.entries(manifest.files)) {
      if (sha256(join(scratch, 'x', file)) !== sum) throw new ResetRefused(`The archived ${file} does not match its checksum.`);
    }
    return manifest;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

const argument = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? null : (process.argv[index + 1] ?? null);
};

const main = async (): Promise<void> => {
  loadEnvFiles();
  const url = (process.env.DATABASE_URL ?? '').trim();
  if (url.length === 0) throw new ResetRefused('DATABASE_URL is not set.');
  const sql = postgres(url, { max: 1, connect_timeout: 10, onnotice: () => undefined });
  try {
    if (process.argv.includes('--inventory')) {
      process.stdout.write(`${JSON.stringify(await countForms(sql), null, 2)}\n`);
      return;
    }
    const verify = argument('verify');
    if (verify !== null) {
      const manifest = await verifyArchive(resolve(verify), readBackupKey(process.env));
      process.stdout.write(`verified ${verify}: ${JSON.stringify(manifest.counts)}; ${Object.keys(manifest.files).length} files\n`);
      return;
    }
    const archiveRoot = argument('archive-root') ?? process.env.EJE_BACKUP_DIR ?? '';
    if (archiveRoot.trim().length === 0) throw new ResetRefused('--archive-root (or EJE_BACKUP_DIR) is required.');
    const expectFile = argument('expect');
    const execute = process.argv.includes('--execute');
    if (execute && expectFile === null) throw new ResetRefused('--execute needs --expect <counts.json> from --inventory: the operator states what is being deleted.');
    const report = await resetForms(sql, {
      archiveRoot,
      storageRoot: readStorageConfiguration(process.env).root,
      key: readBackupKey(process.env),
      dryRun: !execute,
      expect: expectFile === null ? undefined : (JSON.parse(readFileSync(expectFile, 'utf8')) as Counts),
      log: (line) => process.stdout.write(`${line}\n`),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(report.dryRun ? 'DRY RUN: everything above was rolled back; nothing changed.\n' : 'RESET COMMITTED.\n');
  } finally {
    await sql.end({ timeout: 5 });
  }
};

if (process.argv[1] !== undefined && /forms-reset\.ts$/u.test(process.argv[1])) {
  void main().catch((cause: unknown) => {
    process.stderr.write(`forms-reset REFUSED: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exitCode = 1;
  });
}
