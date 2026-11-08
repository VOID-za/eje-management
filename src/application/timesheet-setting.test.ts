import { beforeEach, describe, expect, it } from 'vitest';
import { assignableToJobs, can, completesTimesheet, type TimesheetLineTyped, type User } from '@/domain';
import { recordAttendance } from './attendance-operations';
import { loadPayrollMonth } from './finance-packages';
import { completePayrollForm, loadMyCompletedForms, submitCompletedForms } from './payroll-completions';
import { listPayrollHistory } from './payroll-forms';
import { saveTimesheetLine } from './timesheet-lines';
import { listTimesheetPeople, loadWorkingTimesheet, saveTimesheetEntry } from './timesheets';
import { updateUser } from './user-operations';
import { buildHarness, seedUser, type Harness } from './test-harness';

/**
 * TIMESHEETS REQUIRED, PER USER — TS-USER-1 (the owner, 8 November 2026).
 *
 * The role decides who MAY keep a timesheet (never the Office); the person's own setting on the Users page decides
 * whether they MUST. Disabled: no timesheet is asked of them, written, completed or submitted — refused on the
 * server, not only hidden — and nothing is counted as outstanding; attendance and every other permission of the
 * role stay exactly as they were. Every existing account keeps its behaviour (the setting defaults to required).
 */
const sipho = seedUser('user-tech-sipho');
const riaan = seedUser('user-tech-riaan');
const master = seedUser('user-master-elmarie');
const otherMaster = seedUser('user-master-johan');
const coordinator = seedUser('user-coord-christene');
const apprentice: User = { ...seedUser('user-tech-thabo'), role: 'apprentice' };
const clock = { at: '2026-11-26T06:00:00.000Z', now(): string { return this.at; } };
const FROM = '2026-11-01';
const TO = '2026-11-25';

let harness: Harness;
beforeEach(async () => {
  clock.at = '2026-11-26T06:00:00.000Z';
  harness = buildHarness({ clock });
  await harness.repos.users.save(apprentice);
});

const typed = (overtime: string): TimesheetLineTyped => ({ pick: '', customerName: 'ABC Engineering', overtime, double: '0', callout: '0', internalKm: '0', customerKm: '0' });
const refusedWith = async (work: Promise<unknown>, code: string) => expect(work).rejects.toMatchObject({ violations: [{ code }] });
const fresh = async (user: User): Promise<User> => (await harness.repos.users.findById(user.id))!;
/** As the office would: the Users page's edit, with only the setting changed. */
const setRequired = async (by: User, user: User, required: boolean) => updateUser(harness.as(by), { ...(await fresh(user)), timesheetRequired: required });
const line = async (who: User, date = '2026-11-05') =>
  saveTimesheetLine(harness.as(await fresh(who)), who.id, { id: crypto.randomUUID(), date, typed: typed('1'), expectedRevision: null });
const complete = async (who: User, kind: 'timesheet' | 'attendance') =>
  completePayrollForm(harness.as(await fresh(who)), who.id, { kind, from: FROM, to: TO, fileName: '', confirmUnrecorded: true, confirmNoLines: true });

describe('TS-USER-1 — the default keeps every account as it was', () => {
  it('a Senior Tech, Technician and Apprentice keep a timesheet; the Office keeps none, whatever its setting says', async () => {
    for (const person of [master, sipho, apprentice]) expect(completesTimesheet(await fresh(person))).toBe(true);
    expect(completesTimesheet(coordinator)).toBe(false);
    expect(completesTimesheet({ ...coordinator, timesheetRequired: true })).toBe(false);
    expect(completesTimesheet({ role: 'technician', timesheetRequired: false })).toBe(false);
  });
});

describe('TS-USER-1 — disabled and enabled again, for every role that keeps a timesheet', () => {
  for (const [name, person, by] of [['Technician', sipho, coordinator], ['Apprentice', apprentice, coordinator], ['Senior Tech', otherMaster, otherMaster]] as const) {
    // A Senior Tech account is edited by its holder (no Senior Tech edits another's, the existing rule).
    it(`${name}: disabled — refused on the server, attendance only, nothing outstanding; enabled — the timesheet again`, async () => {
      await setRequired(by, person, false);
      const off = await fresh(person);
      expect(off.timesheetRequired).toBe(false);
      expect(off.role).toBe(person.role);
      // Every timesheet path is refused for them — the line, the old entries route, completing, opening their own sheet.
      await refusedWith(line(person), 'timesheet_not_required');
      await refusedWith(saveTimesheetEntry(harness.as(off), person.id, { date: '2026-11-05', customerName: 'X', overtimeHours: 1, doubleHours: 0 }), 'timesheet_not_required');
      await refusedWith(complete(person, 'timesheet'), 'timesheet_not_required');
      await refusedWith(loadWorkingTimesheet(harness.as(off), person.id), 'timesheet_not_required');
      // Attendance alone is what they submit — no empty timesheet created, nothing waiting on a timesheet.
      const state = await loadMyCompletedForms(harness.as(off), person.id);
      expect(state.timesheetRequired).toBe(false);
      await recordAttendance(harness.as(off), { userId: person.id, date: '2026-11-05', status: 'present', note: '' });
      await complete(person, 'attendance');
      expect((await loadMyCompletedForms(harness.as(off), person.id)).readiness).toBe('ready');
      const submission = await submitCompletedForms(harness.as(off), person.id);
      expect(submission).toMatchObject({ timesheetRequired: false, timesheetPeriodId: null });
      // The office's month: attendance only, never "timesheet missing".
      const row = (await loadPayrollMonth(harness.as(coordinator), '2026-11')).rows.find((candidate) => candidate.technician.id === person.id)!;
      expect(row.timesheetRequired).toBe(false);
      expect(row.status).toBe('ready');
      // Nobody lists a timesheet of theirs to keep.
      expect((await listTimesheetPeople(harness.as(master))).map((entry) => entry.id)).not.toContain(person.id);
      // Everything else the role does is unchanged.
      expect(assignableToJobs(off.role)).toBe(true);
      if (person.role === 'master') expect(can(off.role, 'payroll.finance')).toBe(true);
      // Enabled again: the timesheet workflow is theirs once more.
      await setRequired(by, person, true);
      await expect(line(person, '2026-11-27')).resolves.toMatchObject({ complete: true });
      const trail = (await harness.repos.activity.list()).filter((event) => event.summary.startsWith('Timesheets '));
      expect(trail.map((event) => event.summary).sort()).toEqual([`Timesheets not required: ${off.firstName} ${off.lastName}`, `Timesheets required: ${off.firstName} ${off.lastName}`].sort());
    });
  }

  it('a person whose timesheets are disabled later still sees the timesheets they submitted before', async () => {
    await line(sipho);
    await recordAttendance(harness.as(sipho), { userId: sipho.id, date: '2026-11-05', status: 'present', note: '' });
    await complete(sipho, 'timesheet');
    await complete(sipho, 'attendance');
    await submitCompletedForms(harness.as(sipho), sipho.id);
    await setRequired(coordinator, sipho, false);
    const history = await listPayrollHistory(harness.as(await fresh(sipho)), sipho.id);
    expect(history[0]!.documents.map((document) => document.kind)).toEqual(['timesheet', 'attendance']);
  });
});

describe('TS-USER-1 — who may change it, and when', () => {
  it('only those who may edit the account; never by the person themselves when they cannot; recorded on the audit trail', async () => {
    await expect(setRequired(riaan, sipho, false)).rejects.toBeDefined();
    expect((await fresh(sipho)).timesheetRequired).not.toBe(false);
    // The Office cannot change a Senior Tech's account (the existing rule), so not this either.
    await expect(setRequired(coordinator, otherMaster, false)).rejects.toBeDefined();
    expect((await fresh(otherMaster)).timesheetRequired).not.toBe(false);
  });

  it('not while a completed timesheet waits on My Monthly Forms — it is submitted first, so no form is stranded', async () => {
    await line(sipho);
    await complete(sipho, 'timesheet');
    await refusedWith(setRequired(coordinator, sipho, false), 'timesheet_in_progress');
    expect((await fresh(sipho)).timesheetRequired).not.toBe(false);
  });
});
