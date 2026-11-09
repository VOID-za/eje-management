# The attendance and timesheet reset — FORMS-RESET-1, 9 November 2026

Asked for by the owner on 9 November 2026 ("EJE — Post-v1.9.0 Improvements, Testing Preparation & Complete
Attendance/Timesheet Reset"), explicitly and in writing: **zero attendance and zero timesheet form records in the live
application, for every person and every date** — past, current and future; drafts and open lines; completed, withdrawn,
submitted; corrections and correction drafts — preserved in a secure encrypted archive outside the operational tables,
with users, roles, permissions, jobs, customers, machines, documents and the audit trail left exactly as they are.

## What is cleared, and why each

Every table that holds an attendance or timesheet form, children first (the order of the delete):

| Table | What it is |
|---|---|
| `payroll_form_correction_drafts` | the correction a withdrawal opens (0055) |
| `payroll_form_completions` | a form completed and locked, awaiting Submit to Office, withdrawn, or submitted (0054) — and its stored PDF |
| `monthly_submissions` | a month sent to the office before PAYROLL-ONE-1 (0040) |
| `payroll_submissions` | the forms submitted together for a period (0052) — and their stored PDFs |
| `timesheet_submitted_lines` | the ledger of submitted timesheet lines (0056); each row names a submitted timesheet below |
| `timesheet_corrections` | a correction of a sent timesheet (0039) |
| `timesheet_periods` | a timesheet, sent or not (0038) |
| `timesheet_months` | the 0037 month table, kept only because 0037 created it |
| `timesheet_entries` | every timesheet line — **including the seven open lines** of `docs/timesheet-open-lines-review-2026-11-08.md` |
| `timesheet_line_drafts` | a line half-typed (0052) |
| `timesheet_line_removals` | the ids of lines their owner removed (0053) |
| `timesheet_working_comments` | the comment on the sheet being filled in (0050) |
| `timesheet_comments` | the 0033 daily comment |
| `payroll_document_names` | a name given to the next PDF (0052) |
| `attendance` | every attendance day (0033) |

And the rows of shared tables that exist only because of a form: the office's **`timesheet_submitted`,
`timesheet_correction_requested` and `timesheet_correction_decided` notifications** (they would list forms that no
longer exist). The stored form PDFs (`payroll-completions/`, `payroll-submissions/` in the document store) are archived
and removed after the commit.

**Kept, deliberately:**
- **The audit trail.** It is append-only and is not rewritten: every form event stays, a copy goes into the archive,
  and the reset itself is appended as one `forms_reset` event (counts and the archive's name and checksum; no secret).
- **The 24-hour cache of request responses** (`api_idempotency`). It is not a form record. Kept, a browser retrying a
  request it sent before the reset is answered from the cache and creates nothing. Deleted, the retry would run again
  and bring an old form back. It expires by itself within 24 hours.
- **Finance packages.** There are none. The tool refuses to run if one exists: it is a payroll record, and deleting it
  is the owner's decision, not the tool's.
- Users and their settings (including Timesheets required), roles, permissions, jobs, customers, machines, documents,
  notifications about anything else, and the standby calendar. They are untouched and proved untouched (below).

Browsers keep changes they have not sent yet. In v1.9.1 those queues use a new storage key, so nothing queued in a
browser before the reset is replayed into the clean slate.

## How — `npm run forms:reset` (`src/ops/forms-reset.ts`)

One transaction, or nothing:
1. Every form table is locked, so no form can be written while it is archived and cleared.
2. Every row of every form table, plus the form notifications, is read as JSON lines. The form audit events are
   copied, and the stored form PDFs too. A manifest records each table's count and each file's SHA-256.
3. These are tarred and encrypted with the backup key (AES-256-GCM, `src/db/backup/crypto.ts`), fsynced, and then
   **decrypted again and checked** against the manifest, all before anything is deleted. The plaintext only ever
   exists in the private temporary directory of the systemd unit that runs it.
4. The form tables' guard triggers are disabled for the delete only. These are the write-once rules that exist so
   the application can never delete these rows. Foreign keys stay enforced. The self-references are cleared and the
   rows deleted children first. The triggers come back exactly as they were.
5. **Proved inside the same transaction:** every form table is empty; the triggers are as before; **every other table's
   fingerprint is identical** to before the delete. A refusal at any step rolls everything back.

Then, after the commit only, the stored form PDFs are removed. They are in the archive.

Modes:
- `--inventory` is read only.
- The default is a **dry run**: the whole procedure, then rolled back.
- `--execute --expect <inventory.json>` runs it for real. It refuses if the forms differ from the counts the operator
  inventoried, if a stored PDF a row names is missing, or if a Finance package exists.
- `--verify <archive>` decrypts and checks an archive.

An executed run never removes the archive it wrote.

Tests: `src/ops/forms-reset.db.test.ts` on PostgreSQL (CI). It fills every form table through the application, then:
- runs a dry run (nothing changes), then the reset;
- checks that every form table is empty and every other table identical;
- checks that the archive decrypts to every row and file, and that the wrong key is refused;
- checks that forms work again from nothing;
- covers the refusals: a count mismatch, a Finance package, a missing PDF, and a delete refused by a foreign key
  (rolled back, triggers restored, archive kept).

## Restoring

The archive is evidence, not a restore path. Its rows are JSON lines keyed by column name, and they can be re-inserted
with `jsonb_populate_record` if the owner ever asks. **The restore path is the full encrypted backup taken immediately
before the reset** (below). It holds the whole database and the document store as they were, and it was
restore-tested before the reset ran.

## The production run — 9 November 2026

**Done on v1.9.1 (`0eaa023`), 20:19:45 UTC. Run by the app's own database role (the tables' owner, not a superuser)
through the release's code, under systemd with the production environment.**

1. **Release, with a fresh backup proved first.** v1.9.1 went through `stage-release.ps1 -ExpectPending none`; the
   database schema was not touched (58 migrations).
   - Backup `/var/backups/eje/eje-eje_production-2026-11-09T20-16-37Z`: both files intact and authentic.
   - Key **MATCH** (`23dba6772da10057`).
   - **RESTORE-TESTED** into a scratch database, which was then dropped: jobs 119, users 7, customers 11, machines 19,
     final documents 64, job media 37, signatures 80, audit events 1 194, 242 documents.
   - Switched 20:16:56 UTC; healthy 20:16:58.
2. **Inventory** (`--inventory`), identical to the read-only inventory taken at 19:40.
3. **The seven open lines** read with their row hashes just before the reset. Unchanged since 8 November.
4. **Dry run** on production: every step, including the archive, its decryption and verification, the delete and the
   proofs. It reached 0 in every form table, with **78 other tables identical**, then **rolled back**.
5. **Execute** with `--expect` the inventory: **RESET COMMITTED**.
6. **Independent checks, afterwards** (below).

### Before and after

| Record | Before | After |
|---|---:|---:|
| Attendance days (`attendance`) | 102 | **0** |
| Timesheet lines (`timesheet_entries`), including the seven open lines | 48 | **0** |
| Timesheets, sent or not (`timesheet_periods`) | 15 | **0** |
| Submitted-line ledger (`timesheet_submitted_lines`) | 28 | **0** |
| Monthly submissions (`monthly_submissions`) | 7 | **0** |
| Completed forms — awaiting, withdrawn or submitted (`payroll_form_completions`) | 3 | **0** (0 withdrawn after) |
| Removed-line ids (`timesheet_line_removals`) | 4 | **0** |
| Working comments (`timesheet_working_comments`) | 2 | **0** |
| Daily comments, 0033 (`timesheet_comments`) | 1 | **0** |
| Payroll submissions, timesheet corrections, correction drafts, line drafts, PDF names, 0037 months | 0 | **0** |
| Office notifications about forms | 20 | **0** |
| Stored form PDFs (`payroll-completions/`) | 3 (6 files) | **0** (the folder is gone) |
| Finance packages | 0 | 0 |

### Afterwards, checked independently

- **The database**, queried directly and read only, at 20:22 UTC:
  - every form table reads 0;
  - **none of the seven line ids** is in `timesheet_entries`;
  - the 10 guard triggers are all enabled again (`O`), exactly as before;
  - the 198 form audit events are all still there, plus one `forms_reset` event at 20:19:45.522;
  - all 7 users are unchanged, every one still with Timesheets required.
- **Every table's full-row fingerprint compared with 20:18, before the reset: 82 of 93 tables byte-identical.** The 11
  that changed are exactly these:
  - the 9 non-empty form tables, now 0;
  - `notifications`, 190 → 170: the 20 form notices, and nothing else;
  - `audit_events`, +1: the reset's own event.

  So these are unchanged byte for byte: jobs (119), users (7), customers (11), machines (19), sites, contacts,
  documents, signatures, checklists, availability, standby, sessions, the idempotency cache and the rest.
- **The archive**: `/var/backups/eje/forms-reset-archive-2026-11-09T20-19-45Z/forms-reset-archive-2026-11-09T20-19-45Z.tar.enc`.
  - 307 228 bytes, 0600 in a 0700 directory owned by `eje`, encrypted AES-256-GCM with the backup key
    (`23dba6772da10057`).
  - SHA-256 `1fbce7cd6d45fd34c753bec744683ee88caa1ec1642ad573f04bb8a26d56bec0`, the same in `report.json` and in the
    audit event.
  - `--verify` decrypted it again: every table count and all 6 file checksums match.
  - A separate decryption found **all seven open lines in it, 7/7**, with the dates, customers and hours recorded on
    8 November, among the 48 archived lines of 4 people.
  - No plaintext was left behind. The archive name never matches backup retention, so it is not pruned.
- **The application**, read only (11 of 11 checks passed, desktop and phone), as the demo Master (Senior Tech),
  Coordinator and Technician:
  - health ok, PostgreSQL reachable, email `refuse`, demonstration mode on, v1.9.1;
  - no timesheet submission, no pending correction and no form notification in any office view;
  - each person's own History, open lines and completed forms are empty, and every attendance day from 15 August to
    today reads unrecorded and unlocked;
  - the Coordinator is still attendance only;
  - the Timesheets, My Monthly Forms, Attendance, Payroll and Notifications pages open with no error, and the
    technician's Timesheets page shows its days, ready.
- **The service log: 0 errors** since the switch.

**One imperfection, recorded, not rewritten:** the `forms_reset` audit event's `metadata` holds its JSON as a string
inside `jsonb` (a double encoding by the client), not as an object. Its content is complete (archive name, checksum,
key fingerprint, counts), and the audit trail is append-only, so it stays as written. The tool now casts through
`text`, and the test checks for an object.

**What the checks themselves wrote:** the live checks signed in the three demonstration accounts. They ran twice (the
first run had mistakes in the check script itself), so 12 sign-ins, each audited, and nothing else. The reset tool's own event is the only other write.
