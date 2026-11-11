import { beforeEach, describe, expect, it } from 'vitest';
import { asUserId, can, capabilitiesFor, completesTimesheet, type TimesheetLineTyped, type User } from '@/domain';
import { NAVIGATION } from '@/config/navigation';
import { clearAttendance, recordAttendance } from './attendance-operations';
import { checkFormCompletion, completePayrollForm, loadMyCompletedForms, submitCompletedForms, withdrawCompletedForm } from './payroll-completions';
import { listPayrollHistory } from './payroll-forms';
import { loadWorkingLines, removeTimesheetLine, saveTimesheetLine } from './timesheet-lines';
import { saveWorkingTimesheetComment } from './timesheets';
import { setTimesheetRequired, updateUser } from './user-operations';
import { buildHarness, seedUser, type Harness } from './test-harness';

/**
 * THE ATTENDANCE AND TIMESHEET LIFECYCLE, AND A SENIOR TECH COVERING FOR THE OFFICE — the owner's specification of
 * 11 November 2026 ("Timesheet & Attendance Lifecycle Redesign, Employee-Owned Corrections and Full Senior Tech Office
 * Permissions"), its section 9, case by case.
 *
 *   FORM-LIFECYCLE-2 — Complete moves a form to My Monthly Forms, still its owner's; Correct / Edit brings it back to
 *     its page with everything entered; Submit sends both together and is FINAL.
 *   FORM-OPTIONAL-1 — a day not worked, or no overtime, is left blank: no record, no question, no refusal.
 *   OFFICE-COVER-1  — a Senior Tech holds every Office permission on their own account; nobody, with any
 *     permission, edits another person's forms.
 */
const sipho = seedUser('user-tech-sipho');
const riaan = seedUser('user-tech-riaan');
const elmarie = seedUser('user-master-elmarie');
const johan = seedUser('user-master-johan');
const christene = seedUser('user-coord-christene');
const thabo: User = { ...seedUser('user-tech-thabo'), role: 'apprentice' };
const SIPHO = asUserId(sipho.id);
const clock = { at: '2026-11-26T06:00:00.000Z', now(): string { return this.at; } };
// 1 November 2026 is a Sunday.
const FROM = '2026-11-01';
const TO = '2026-11-25';

let harness: Harness;
beforeEach(async () => {
  clock.at = '2026-11-26T06:00:00.000Z';
  harness = buildHarness({ clock });
  await harness.repos.users.save(thabo);
});

const typed = (values: Partial<TimesheetLineTyped> = {}): TimesheetLineTyped => ({
  pick: '', customerName: '', overtime: '', double: '', callout: '', internalKm: '', customerKm: '', ...values,
});
const fresh = async (user: User): Promise<User> => (await harness.repos.users.findById(user.id))!;
const as = async (user: User) => harness.as(await fresh(user));
const line = async (who: User, date: string, value: TimesheetLineTyped, id: string = crypto.randomUUID(), expectedRevision: string | null = null) =>
  saveTimesheetLine(await as(who), who.id, { id, date, typed: value, expectedRevision });
const day = async (who: User, date: string, status: 'present' | 'absent', absenceReason: string | null = null) =>
  recordAttendance(await as(who), { userId: who.id, date, status, absenceReason, note: status === 'absent' ? 'Clinic' : '' });
// No confirmations: blank days are never asked about (FORM-OPTIONAL-1).
const complete = async (who: User, kind: 'timesheet' | 'attendance') =>
  completePayrollForm(await as(who), who.id, { kind, from: FROM, to: TO, fileName: '' });
const refusedWith = async (work: Promise<unknown>, code: string) => expect(work).rejects.toMatchObject({ violations: [{ code }] });
const refused = async (work: Promise<unknown>) => expect(work).rejects.toBeDefined();

/** Sipho's November, as he would type it: two working days with lines, an absence with its reason, a comment. */
const fillSipho = async () => {
  const first = await line(sipho, '2026-11-03', typed({ customerName: 'ABC Engineering', overtime: '2.5', internalKm: '14', customerKm: '32' }));
  const second = await line(sipho, '2026-11-04', typed({ pick: '__workshop__', double: '4', callout: '350' }));
  await day(sipho, '2026-11-03', 'present');
  await day(sipho, '2026-11-04', 'present');
  await day(sipho, '2026-11-05', 'absent', 'sick_leave');
  await saveWorkingTimesheetComment(await as(sipho), sipho.id, 'Crane job ran late on the 3rd.');
  return { first, second };
};
const snapshotOfLines = async () =>
  (await loadWorkingLines(await as(sipho), sipho.id)).filter((row) => row.entry !== null).map((row) => ({ id: row.id, date: row.date, typed: row.typed })).sort((a, b) => a.id.localeCompare(b.id));
const snapshotOfDays = async () =>
  (await harness.repos.attendance.listRecords(FROM, TO, SIPHO)).map((record) => ({ date: record.date, status: record.status, absenceReason: record.absenceReason, note: record.note })).sort((a, b) => a.date.localeCompare(b.date));

describe('9.1 — only the owner edits a form, whoever else is asking', () => {
  it('Sipho edits his own; another technician, an Apprentice, the Office and both Senior Techs are refused on every path', async () => {
    const { first } = await fillSipho();
    const timesheet = await complete(sipho, 'timesheet');
    const attendance = await complete(sipho, 'attendance');
    for (const other of [riaan, thabo, christene, elmarie, johan]) {
      const context = await as(other);
      await refused(withdrawCompletedForm(context, SIPHO, timesheet.id));
      await refused(withdrawCompletedForm(context, SIPHO, attendance.id));
      await refused(saveTimesheetLine(context, SIPHO, { id: first.id, date: '2026-11-03', typed: typed({ customerName: 'Rewritten', overtime: '9' }), expectedRevision: first.revision }));
      await refused(saveTimesheetLine(context, SIPHO, { id: crypto.randomUUID(), date: '2026-11-06', typed: typed({ customerName: 'Added by someone else', overtime: '1' }), expectedRevision: null }));
      await refused(removeTimesheetLine(context, SIPHO, first.id));
      await refused(recordAttendance(context, { userId: SIPHO, date: '2026-11-06', status: 'present', note: '' }));
      await refused(clearAttendance(context, { userId: SIPHO, date: '2026-11-03' }));
      await refused(completePayrollForm(context, SIPHO, { kind: 'timesheet', from: FROM, to: TO, fileName: '' }));
      await refused(submitCompletedForms(context, SIPHO));
      await refused(saveWorkingTimesheetComment(context, SIPHO, 'Not yours'));
    }
    // Nothing of his changed, and both forms still wait for him.
    const state = await loadMyCompletedForms(await as(sipho), SIPHO);
    expect([state.timesheet?.id, state.attendance?.id]).toEqual([timesheet.id, attendance.id]);
    expect((await snapshotOfLines()).map((row) => row.typed.customerName).sort()).toEqual(['', 'ABC Engineering']);
    // His own: allowed.
    await expect(withdrawCompletedForm(await as(sipho), SIPHO, timesheet.id)).resolves.toMatchObject({ id: timesheet.id });
    await expect(withdrawCompletedForm(await as(sipho), SIPHO, attendance.id)).resolves.toMatchObject({ id: attendance.id });
  });
});

describe('9.2 — Complete, then Correct / Edit: back on its page with everything entered, completed again', () => {
  it('the timesheet: every line, every value and the comment come back; a change is kept; completed again it is on My Monthly Forms', async () => {
    const { first } = await fillSipho();
    const linesBefore = await snapshotOfLines();
    const completed = await complete(sipho, 'timesheet');
    expect((await loadMyCompletedForms(await as(sipho), SIPHO)).timesheet?.id).toBe(completed.id);
    // Locked while it waits: even its owner changes it only through Correct / Edit.
    await refusedWith(line(sipho, '2026-11-03', typed({ customerName: 'ABC Engineering', overtime: '3' }), first.id, first.revision), 'form_completed');

    await withdrawCompletedForm(await as(sipho), SIPHO, completed.id);
    // Everything entered, exactly: the same lines and values, the comment given back.
    expect(await snapshotOfLines()).toEqual(linesBefore);
    expect((await harness.repos.attendance.findWorkingComment(SIPHO))?.comment).toBe('Crane job ran late on the 3rd.');
    const state = await loadMyCompletedForms(await as(sipho), SIPHO);
    expect(state.timesheet).toBeNull();
    expect(state.drafts.timesheet).toMatchObject({ from: FROM, to: TO });

    // Changed, added to, completed again.
    const current = (await loadWorkingLines(await as(sipho), sipho.id)).find((row) => row.id === first.id)!;
    await line(sipho, '2026-11-03', typed({ customerName: 'ABC Engineering', overtime: '3', internalKm: '14', customerKm: '32' }), first.id, current.revision);
    await line(sipho, '2026-11-06', typed({ customerName: 'Brelko', overtime: '1' }));
    const again = await complete(sipho, 'timesheet');
    expect(again.correctsId).toBe(completed.id);
    const frozen = await harness.repos.payroll.findFormCompletion(again.id);
    expect(frozen?.timesheet?.entries.map((entry) => [entry.date, entry.customerName, entry.overtimeHours]).sort()).toEqual([
      ['2026-11-03', 'ABC Engineering', 3],
      ['2026-11-04', '', 0],
      ['2026-11-06', 'Brelko', 1],
    ]);
    expect((await loadMyCompletedForms(await as(sipho), SIPHO)).timesheet?.id).toBe(again.id);
    // Audited: completed, returned, completed again — each naming Sipho as the actor.
    const trail = (await harness.repos.activity.list()).filter((event) => event.type.startsWith('payroll_form_'));
    expect(trail.map((event) => event.type).sort()).toEqual(['payroll_form_completed', 'payroll_form_completed', 'payroll_form_withdrawn']);
    for (const event of trail) expect(event.actorId).toBe(sipho.id);
  });

  it('the attendance: every day, status and absence reason come back; a change is kept; completed again', async () => {
    await fillSipho();
    const daysBefore = await snapshotOfDays();
    const completed = await complete(sipho, 'attendance');
    await refusedWith(day(sipho, '2026-11-06', 'present'), 'form_completed');
    await withdrawCompletedForm(await as(sipho), SIPHO, completed.id);
    expect(await snapshotOfDays()).toEqual(daysBefore);
    await day(sipho, '2026-11-05', 'present');
    await day(sipho, '2026-11-06', 'present');
    const again = await complete(sipho, 'attendance');
    const frozen = await harness.repos.payroll.findFormCompletion(again.id);
    const statusOf = (date: string) => frozen?.attendance?.find((entry) => entry.date === date)?.status ?? null;
    expect([statusOf('2026-11-03'), statusOf('2026-11-05'), statusOf('2026-11-06')]).toEqual(['present', 'present', 'present']);
  });
});

describe('9.3 — Submit sends both together, and it is final for everybody', () => {
  it('both forms go as one submission; afterwards nothing in them is changed, corrected, withdrawn or submitted again — by anybody', async () => {
    const { first, second } = await fillSipho();
    const timesheet = await complete(sipho, 'timesheet');
    const attendance = await complete(sipho, 'attendance');
    const submission = await submitCompletedForms(await as(sipho), SIPHO);
    expect(submission.timesheetPeriodId).not.toBeNull();
    const frozenBefore = await Promise.all([timesheet.id, attendance.id].map((id) => harness.repos.payroll.findFormCompletion(id)));
    expect(frozenBefore.map((form) => form?.submissionId)).toEqual([submission.id, submission.id]);

    for (const who of [sipho, riaan, christene, elmarie, johan]) {
      const context = await as(who);
      await refused(withdrawCompletedForm(context, SIPHO, timesheet.id));
      await refused(withdrawCompletedForm(context, SIPHO, attendance.id));
      await refused(saveTimesheetLine(context, SIPHO, { id: first.id, date: '2026-11-03', typed: typed({ customerName: 'Rewritten', overtime: '9' }), expectedRevision: first.revision }));
      await refused(removeTimesheetLine(context, SIPHO, second.id));
      await refused(submitCompletedForms(context, SIPHO));
    }
    // The owner's own attempts are refused with the reason: final.
    await refusedWith(withdrawCompletedForm(await as(sipho), SIPHO, timesheet.id), 'form_already_submitted');
    await refusedWith(line(sipho, '2026-11-03', typed({ customerName: 'Rewritten', overtime: '9' }), first.id, first.revision), 'timesheet_line_submitted');
    await refused(day(sipho, '2026-11-03', 'absent', 'sick_leave'));

    // Exactly as submitted: the completed forms, the history and the lines.
    const frozenAfter = await Promise.all([timesheet.id, attendance.id].map((id) => harness.repos.payroll.findFormCompletion(id)));
    expect(frozenAfter).toEqual(frozenBefore);
    const history = await listPayrollHistory(await as(sipho), SIPHO);
    expect(history).toHaveLength(1);
    expect(history[0]!.documents.map((document) => document.kind)).toEqual(['timesheet', 'attendance']);
    expect((await loadMyCompletedForms(await as(sipho), SIPHO))).toMatchObject({ timesheet: null, attendance: null });
  });
});

describe('9.4 — days not worked and unused lines are left blank', () => {
  it('attendance: Sunday and a weekday skipped, completed with no question; no record made for them', async () => {
    await day(sipho, '2026-11-02', 'present');
    await day(sipho, '2026-11-04', 'present');
    const check = await checkFormCompletion(await as(sipho), SIPHO, 'attendance', FROM, TO);
    expect(check.problems).toEqual([]);
    expect(check.needs.confirmUnrecorded).toBe(false);
    // Completed with no confirmation at all.
    const completed = await completePayrollForm(await as(sipho), SIPHO, { kind: 'attendance', from: FROM, to: TO, fileName: '' });
    expect((await harness.repos.attendance.listRecords(FROM, TO, SIPHO)).map((record) => record.date).sort()).toEqual(['2026-11-02', '2026-11-04']);
    const frozen = await harness.repos.payroll.findFormCompletion(completed.id);
    const sunday = frozen?.attendance?.find((entry) => entry.date === '2026-11-01');
    const tuesday = frozen?.attendance?.find((entry) => entry.date === '2026-11-03');
    // A blank day is just that: no status — never "absent".
    expect([sunday?.status ?? null, tuesday?.status ?? null]).toEqual([null, null]);
    expect(completed.summary).toMatch(/without an entry/u);
  });

  it('timesheet: Sunday and a weekday skipped, no overtime line, an unused line left blank — completed with only the work done; nothing empty stored', async () => {
    await line(sipho, '2026-11-02', typed({ customerName: 'ABC Engineering', overtime: '1.5' }));
    // "Add line", never filled in: not stored, not audited, in nobody's way.
    const blank = crypto.randomUUID();
    const kept = await line(sipho, '2026-11-03', typed(), blank);
    expect(kept).toMatchObject({ id: blank, complete: false, problems: [], revision: null, entry: null });
    // Zeros typed are blank too: no zero-hour line is ever made.
    const zeros = crypto.randomUUID();
    await line(sipho, '2026-11-04', typed({ overtime: '0', double: '0', callout: '0', internalKm: '0', customerKm: '0' }), zeros);
    expect(await harness.repos.attendance.listLineDrafts(SIPHO)).toEqual([]);
    expect((await harness.repos.attendance.listEntries(SIPHO, FROM, TO)).map((entry) => entry.date)).toEqual(['2026-11-02']);
    expect((await harness.repos.activity.list()).filter((event) => event.type === 'timesheet_entry_draft')).toEqual([]);

    // Typed into, then cleared again: its draft goes.
    const cleared = crypto.randomUUID();
    const started = await line(sipho, '2026-11-05', typed({ customerName: 'Half', overtime: 'abc' }), cleared);
    expect(started.complete).toBe(false);
    expect(await harness.repos.attendance.listLineDrafts(SIPHO)).toHaveLength(1);
    await line(sipho, '2026-11-05', typed(), cleared, started.revision);
    expect(await harness.repos.attendance.listLineDrafts(SIPHO)).toEqual([]);

    const completed = await complete(sipho, 'timesheet');
    const frozen = await harness.repos.payroll.findFormCompletion(completed.id);
    expect(frozen?.timesheet?.entries.map((entry) => [entry.date, entry.overtimeHours])).toEqual([['2026-11-02', 1.5]]);
  });

  it('a line that has been started is still checked: a half-typed one stops Complete and is kept as typed', async () => {
    await line(sipho, '2026-11-02', typed({ customerName: 'ABC Engineering', overtime: '1' }));
    const half = await line(sipho, '2026-11-03', typed({ customerName: 'Brelko', overtime: 'two' }));
    expect(half.complete).toBe(false);
    expect(half.problems.length).toBeGreaterThan(0);
    await refusedWith(complete(sipho, 'timesheet'), 'timesheet_lines_incomplete');
    // Nothing invented: the stored lines are only the complete one.
    expect((await harness.repos.attendance.listEntries(SIPHO, FROM, TO)).map((entry) => entry.customerName)).toEqual(['ABC Engineering']);
    expect((await harness.repos.attendance.listLineDrafts(SIPHO)).map((draft) => draft.typed.overtime)).toEqual(['two']);
  });
});

describe('9.5 — a Senior Tech covers for the Office, on their own account', () => {
  it('holds every Office capability, and sees every page the Office sees — the Users page included', () => {
    const office = capabilitiesFor('coordinator');
    expect(office.length).toBeGreaterThan(30);
    for (const capability of office) expect(can('master', capability), capability).toBe(true);
    const sees = (user: User) =>
      NAVIGATION.filter(
        (item) =>
          (item.capability === undefined || can(user.role, item.capability)) &&
          (item.roles === undefined || item.roles.includes(user.role)) &&
          (item.keepsTimesheet !== true || completesTimesheet(user)),
      ).map((item) => item.href);
    const missing = sees(christene).filter((href) => !sees(elmarie).includes(href));
    expect(missing).toEqual([]);
    expect(sees(elmarie)).toContain('/users');
    // Not infrastructure: no capability names a server, a backup, a key or a deployment.
    expect(capabilitiesFor('master').filter((capability) => /backup|server|deploy|secret|key|database|shell/u.test(capability))).toEqual([]);
  });

  it('sets Timesheets required for a Technician and an Apprentice, as the Office does — audited as themself; never another Senior Tech\'s', async () => {
    await setTimesheetRequired(await as(elmarie), sipho.id, false);
    await updateUser(await as(elmarie), { ...(await fresh(thabo)), timesheetRequired: false });
    expect([(await fresh(sipho)).timesheetRequired, (await fresh(thabo)).timesheetRequired]).toEqual([false, false]);
    const events = (await harness.repos.activity.list()).filter((event) => event.summary.startsWith('Timesheets '));
    expect(events).toHaveLength(2);
    for (const event of events) {
      // The actor is the Senior Tech — never the Office's account.
      expect(event.actorId).toBe(elmarie.id);
      expect(event.detail).toContain(`by ${elmarie.firstName} ${elmarie.lastName}`);
    }
    await refusedWith(setTimesheetRequired(await as(elmarie), johan.id, false), 'timesheet_setting_not_permitted');
    expect((await fresh(johan)).timesheetRequired).not.toBe(false);
    // Still a Senior Tech: covering for the Office changes nobody's role.
    expect((await fresh(elmarie)).role).toBe('master');
  });
});
