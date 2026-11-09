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

## The production run

_Recorded below after the run._
