# Attendance and Timesheet lifecycle, and a Senior Tech covering for the Office

The owner's specification of 11 November 2026: "EJE — Timesheet & Attendance Lifecycle Redesign, Employee-Owned
Corrections and Full Senior Tech Office Permissions". Requirement IDs: **FORM-LIFECYCLE-2**, **FORM-OPTIONAL-1** and
**OFFICE-COVER-1** (`docs/SCOPE.md`).

**No migration.** The lifecycle uses the tables and guard triggers that were already there: 0052, 0054, 0055 and 0056.

## What was already true, and what changed

The model the specification describes is mostly the one that already existed:
- FORM-LIFECYCLE-1, 6 November 2026: Complete, then My Monthly Forms.
- FORM-WITHDRAW-1: withdraw and correct before submission.
- PAYROLL-ONE-1: both forms submitted together, in one transaction.
- TS-FINAL-1 (v1.10.0): no correction after submission.

v1.10.0 did **not** disable correcting a form *before* submission. It removed only the request to correct a form
*after* submission, and this specification forbids that too.

What this release changes:
- **Wording.** Complete is not Submit:
  - *Completed* is now **Complete**, and its dialog says the form goes to My Monthly Forms and is not sent to the
    Office.
  - *Withdraw and Correct* is now **Correct / Edit**.
  - The history row reads **Submitted — Final**.
  - The leftover "ask the office for a correction" messages are gone.
  - The old dialog said "once completed, it cannot be edited again". That was wrong, and it is gone.
- **Correct / Edit returns to the form's own page**, for its dates, with everything entered.
- **Blank days and unused lines** (FORM-OPTIONAL-1):
  - Weekdays without an attendance entry are no longer something to confirm.
  - A timesheet line nobody typed into is not stored and does not stop Complete.
- **A Senior Tech covers for the Office** (OFFICE-COVER-1):
  - They get the Users page.
  - They set Timesheets required for Technicians and Apprentices.

## The state machine — one per form (timesheet, attendance), per person

```
             every change saves itself              Complete (owner only; checked on the server)
  IN PROGRESS ─────────────────────────► IN PROGRESS ─────────────────────────────► COMPLETED — awaiting submission
  (Timesheets / Attendance page)                                                    (My Monthly Forms; its dates locked)
        ▲                                                                                  │            │
        │      Correct / Edit (owner only, before submission)                              │            │ Submit to Office
        └──── RETURNED FOR EDITING ◄───────────────────────────────────────────────────────┘            │ (owner only; BOTH forms,
              (the completed copy kept, marked withdrawn; a correction draft open on                   │  one transaction)
               the same dates; every line and day still in its own table, unlocked)                    ▼
                                                                                         SUBMITTED — FINAL
                                                                                         (no edit, correction, withdrawal,
                                                                                          reopening or resubmission — by anybody)
```

| State | Where it is held | Who may change it |
|---|---|---|
| In progress | `timesheet_entries`, `timesheet_line_drafts`, `attendance`, `timesheet_working_comments` | the owner only |
| Completed, awaiting submission | `payroll_form_completions` row: `submission_id` null, `withdrawn_at` null. A write-once snapshot and PDF; its dates locked (`form-locks.ts`). | the owner only: Correct / Edit, or Submit |
| Returned for editing | that row marked `withdrawn_at` (once, by the guard trigger), plus a `payroll_form_correction_drafts` row on its dates | the owner only: edit, then Complete again (a new completion with `corrects_id`) |
| Submitted — final | `payroll_submissions`, and `submission_id` set on both completions (once, by the guard trigger), plus `timesheet_submitted_lines` | nobody |

**Values are never lost by Correct / Edit.** While a form waits on My Monthly Forms, its lines and days stay where
they were typed; they are only locked. Returning it unlocks them in place, and the comment and file name it was
completed with come back. Tests compare every line, value, day, status, absence reason and the comment before and
after: `forms-lifecycle-office-cover.test.ts` (9.2) and `payroll-withdrawal.test.ts`.

**Submit is atomic.** Both forms, the submission, the timesheet period, the line ledger and the stored PDFs are written
in the request's one transaction, under both form locks (attendance first).
- A failure anywhere leaves nothing submitted: no submission, no period, no ledger row, neither form marked. Both forms
  still wait, still their owner's to correct.
- `payroll-forms.db.test.ts` plants a failure at the last write and proves this, then that the retry goes once.
- Racing requests make one submission; a repeated request is answered from the idempotency store.

**Ownership.** Every write takes the person from the session, never from the request, and refuses anyone else:
- **Who is refused:** the Office, every Senior Tech, other Technicians and Apprentices.
- **Which writes:**
  - lines, their removal and the comment;
  - attendance days;
  - Complete, Correct / Edit and Submit.
- **Reading:** the Office and Senior Techs read what was *submitted*, on EJE Monthly Forms → View forms. Nobody reads
  another person's unsubmitted forms.
- **Tests:**
  - `forms-lifecycle-office-cover.test.ts` 9.1 and 9.3: every role, every path;
  - `reviewer-feedback-api.test.ts`: over HTTP, 403 each.

**Audit.** These are audited, each naming the actual actor:
- `payroll_form_completed` (completed, or the correction completed);
- `payroll_form_withdrawn` (returned for editing);
- the line and day events;
- the submission's events;
- `user_updated` for Timesheets required, naming who, whom, from and to.

A failed submission writes nothing, because its transaction is undone, its audit included. The refusal is in the
service log with the operation's name.

## Blank days and unused lines (FORM-OPTIONAL-1)

- **Attendance.** A day without an entry is a day not worked: Sunday, a public holiday, a day off.
  - Nothing is created for it.
  - It is never marked absent.
  - It is never asked about or refused at Complete or Submit. The old *weekdays not recorded — confirm* tick is gone.
  - The Complete dialog notes such days in one line ("that is fine for a day you did not work").
- **Timesheets.** No line is needed for a day not worked, nor for no overtime.
  - A line with nothing typed in it (or only zeros) is **not stored**.
  - "Add line" left unused writes no draft and no audit event.
  - Typed into and then cleared, its draft is removed.
  - It never stops Complete.
- **Started lines are still checked.**
  - A line with anything typed (a customer, an hour, a stray letter) keeps every existing rule.
  - Half-typed, it is a draft that stops Complete, as before.
  - A stored line cleared to blank stays a draft until it is filled in or removed. It is a change to a real line, not
    an unused one.
- **An attendance form with no entry at all is confirmed first** (the owner, 11 November 2026, before release).
  - The dialog reads **No attendance entries**: "You have not entered any attendance for this period. Are you sure you
    want to complete this form?"
  - **Go back and fill in attendance** closes the dialog and leaves the page and everything on it as it is. Nothing is
    completed.
  - **Complete without entries** completes the form. The audit event says it was completed without attendance
    entries, as confirmed, and the form reads "0 present, 0 absent, N without an entry".
  - No record is invented, and no day is marked absent.
  - The server refuses an unconfirmed one (`attendance_empty_unconfirmed`). An older client's
    `confirmUnrecorded: true` counts as the confirmation.
- **Blank days beside real entries never ask anything:** Sundays, a weekday not worked, a public holiday.
- **Kept on purpose:** a timesheet with **no lines at all** still asks "I have nothing to claim" before Complete.

## A Senior Tech covering for the Office (OFFICE-COVER-1)

Authorisation is by capability (`src/domain/access.ts`); the server checks every request against the session's role.
A Senior Tech already held **every one of the Office's 36 capabilities**, and 7 of its own. The whole table:

| Capability | Office | Senior Tech | Technician / Apprentice |
|---|:-:|:-:|:-:|
| `activity.viewAll` | ✓ | ✓ | — |
| `admin.access` | ✓ | ✓ | — |
| `attendance.viewAll` | ✓ | ✓ | — |
| `availability.manage` | ✓ | ✓ | — |
| `calendar.view` | ✓ | ✓ | ✓ |
| `captures.resolveReferral` | ✓ | ✓ | — |
| `customers.manage` | ✓ | ✓ | — |
| `customers.view` | ✓ | ✓ | ✓ |
| `emailTemplates.manage` | ✓ | ✓ | — |
| `jobs.acceptField` | — | ✓ | ✓ |
| `jobs.assign` | ✓ | ✓ | — |
| `jobs.authoriseUnsignedDelivery` | — | ✓ | — |
| `jobs.captureAdministratively` | ✓ | ✓ | — |
| `jobs.captureWork` | ✓ | ✓ | ✓ |
| `jobs.create` | ✓ | ✓ | — |
| `jobs.editDetails` | ✓ | ✓ | — |
| `jobs.editSubmittedJob` | ✓ | ✓ | — |
| `jobs.endUnstartedJob` | ✓ | ✓ | — |
| `jobs.exportPrices` | ✓ | ✓ | — |
| `jobs.issueFinal` | — | — | ✓ |
| `jobs.manageDrafts` | — | ✓ | — |
| `jobs.officeHandling` | ✓ | ✓ | — |
| `jobs.processParts` | ✓ | ✓ | — |
| `jobs.raiseCorrection` | — | ✓ | — |
| `jobs.recordCorrectionAcknowledgement` | ✓ | ✓ | — |
| `jobs.resolveSignatureRefusal` | ✓ | ✓ | — |
| `jobs.resubmitForSignature` | ✓ | ✓ | — |
| `jobs.takeOverSubmission` | ✓ | ✓ | — |
| `jobs.viewAll` | ✓ | ✓ | — |
| `jobs.viewAnySignatureRefusal` | ✓ | ✓ | — |
| `library.manage` | ✓ | ✓ | — |
| `library.view` | ✓ | ✓ | ✓ |
| `machines.manage` | ✓ | ✓ | — |
| `payroll.finance` | ✓ | ✓ | — |
| `settings.checklists` | ✓ | ✓ | — |
| `settings.manage` | — | ✓ | — |
| `settings.rates` | ✓ | ✓ | — |
| `standby.manage` | ✓ | ✓ | — |
| `standby.requestSwap` | — | ✓ | ✓ |
| `standby.view` | ✓ | ✓ | ✓ |
| `timesheets.reviewCorrections` | ✓ | ✓ | — |
| `timesheets.viewAll` | ✓ | ✓ | — |
| `users.manageMasters` | — | ✓ | — |
| `users.manageTechnicians` | ✓ | ✓ | — |

The only places the code named the Office role itself, and what this release does about each:

| Where | Before | Now |
|---|---|---|
| `config/navigation.ts`: the **Users** page (everybody's availability) | Office only | **Office and Senior Techs** |
| `canSetTimesheetRequired` | a Senior Tech: their own only | **a Senior Tech: their own, a Technician's and an Apprentice's**, as the Office. Never another Senior Tech's (TS-USER-2's explicit "not permitted" stands). |
| `canManageUser` / `assignableRoles` | a Senior Tech already manages everybody but another Senior Tech; the Office manages Technicians and Apprentices | unchanged: a Senior Tech already has more than the Office here |
| `technicians/[id]` breadcrumb, Timesheets-page note | text only | unchanged |

**Kept as they are:**
- **Office notifications** already go to the Office and every Senior Tech (`notifyOffice`).
- **Office Handling, Handle Jobcard, job intake and assignment, customers, machines, the Technical Library, EJE
  Monthly Forms and the Finance package** are capability-checked, so a Senior Tech already reaches them all.
- **A Senior Tech acts as themself.** The Senior Tech's role is unchanged in the database. Every audit event and
  notification names the Senior Tech, with no impersonation and no shared password.
- **No infrastructure access is granted.** No application capability reaches the server, a database console,
  deployments, backup keys or secrets. They exist only on the VPS, under root, outside the application.
- **Ownership is unaffected.** Office permissions never include editing another person's forms.

**Tests:**
- `forms-lifecycle-office-cover.test.ts` 9.5:
  - every Office capability is a Senior Tech's;
  - every sidebar page the Office sees, a Senior Tech sees;
  - no capability names infrastructure;
  - the Timesheets-required rule, audited as the Senior Tech.
- `authorization.test.ts`: over HTTP.
- The smoke journey: the Senior Tech's sidebar and Users page.

## The old correction request, removed

Asking the office to correct a *submitted* timesheet (TS-16) is gone everywhere:
- **The screens.** `TimesheetSubmissions.tsx` and `TimesheetCorrections.tsx` are deleted. They held the last *Ask for a
  correction* button and its form, and nothing rendered them since v1.10.0.
- **The server.** The routes to ask for a correction and to decide one both refuse everybody
  (`timesheet_submitted_final`).
- **Kept.** The owner's **Correct / Edit** before submission is a different thing, and it stays. So do the stored
  corrections (0 on production) and the application code that reads their history.

## Historical records

- **Corrections decided before TS-FINAL-1:** none exist on production (0). The route that decides them is kept, and so
  is the stored history.
- **Completed, withdrawn and submitted forms, the line ledger and the PDFs:** untouched. No migration ran, and no row
  was rewritten.
- **Blank drafts left from before this release:** kept. They no longer stop Complete, and nothing deletes them unless
  their owner clears them again.
