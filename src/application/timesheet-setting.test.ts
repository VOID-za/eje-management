import { beforeEach, describe, expect, it } from 'vitest';
import { assignableToJobs, can, completesTimesheet, type TimesheetLineTyped, type User } from '@/domain';
import { recordAttendance } from './attendance-operations';
import { loadPayrollMonth } from './finance-packages';
import { completePayrollForm, loadMyCompletedForms, submitCompletedForms } from './payroll-completions';
import { listPayrollHistory } from './payroll-forms';
import { saveTimesheetLine } from './timesheet-lines';
import { listTimesheetPeople, loadWorkingTimesheet, saveTimesheetEntry } from './timesheets';
import { setTimesheetRequired, updateUser } from './user-operations';
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
  for (const [name, person, by] of [['Technician', sipho, coordinator], ['Apprentice', apprentice, coordinator], ['Senior Tech, by the Office', otherMaster, coordinator], ['Senior Tech, by themselves', otherMaster, otherMaster]] as const) {
    // TS-USER-2: the Office sets it for everybody who keeps a timesheet; a Senior Tech sets their own.
    it(`${name}: disabled — refused on the server, attendance only, nothing outstanding; enabled — the timesheet again`, async () => {
      // The Office reaches a Senior Tech through the single-setting path: the rest of that account stays protected.
      if (by.role === 'coordinator' && person.role === 'master') await setTimesheetRequired(harness.as(by), person.id, false);
      else await setRequired(by, person, false);
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
      if (by.role === 'coordinator' && person.role === 'master') await setTimesheetRequired(harness.as(by), person.id, true);
      else await setRequired(by, person, true);
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

describe('TS-USER-2 — who may change it (the owner, 11 November 2026)', () => {
  const trail = async () => (await harness.repos.activity.list()).filter((event) => event.summary.startsWith('Timesheets '));
  const unchanged = async (...people: User[]) => {
    for (const person of people) expect((await fresh(person)).timesheetRequired).not.toBe(false);
  };

  it("the Office sets a Technician's, an Apprentice's and a Senior Tech's — each change audited with who, whom, from and to", async () => {
    await setRequired(coordinator, sipho, false);
    await setRequired(coordinator, apprentice, false);
    await setTimesheetRequired(harness.as(coordinator), otherMaster.id, false);
    for (const person of [sipho, apprentice, otherMaster]) expect((await fresh(person)).timesheetRequired).toBe(false);
    const events = await trail();
    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(event.detail).toContain('from Enabled to Disabled');
      expect(event.detail).toContain(`by ${coordinator.firstName} ${coordinator.lastName}`);
      expect(event.changes).toEqual([{ field: 'Timesheets required', from: 'Enabled', to: 'Disabled' }]);
    }
    expect(events.map((event) => event.summary).sort()).toEqual(
      [sipho, apprentice, otherMaster].map((person) => `Timesheets not required: ${person.firstName} ${person.lastName}`).sort(),
    );
    // Only the setting: the rest of a Senior Tech account stays out of the Office's reach.
    await expect(setRequired(coordinator, otherMaster, true)).rejects.toBeDefined();
    expect((await fresh(otherMaster)).timesheetRequired).toBe(false);
  });

  it("a Senior Tech sets their own and — covering for the Office (OFFICE-COVER-1) — a Technician's and an Apprentice's; never another Senior Tech's", async () => {
    await setRequired(master, master, false);
    expect((await fresh(master)).timesheetRequired).toBe(false);
    await setTimesheetRequired(harness.as(await fresh(master)), master.id, true);
    expect((await fresh(master)).timesheetRequired).toBe(true);
    // Another Senior Tech's: refused through either path.
    await refusedWith(setTimesheetRequired(harness.as(master), otherMaster.id, false), 'timesheet_setting_not_permitted');
    await expect(setRequired(master, otherMaster, false)).rejects.toBeDefined();
    await unchanged(otherMaster);
    // OFFICE-COVER-1: a Technician's and an Apprentice's, as the Office does — through either path.
    await setTimesheetRequired(harness.as(master), sipho.id, false);
    await setRequired(master, apprentice, false);
    expect([(await fresh(sipho)).timesheetRequired, (await fresh(apprentice)).timesheetRequired]).toEqual([false, false]);
    // Editing a technician's other details leaves the setting as it is.
    await expect(updateUser(harness.as(master), { ...(await fresh(sipho)), jobTitle: 'Lead Technician' })).resolves.toMatchObject({ jobTitle: 'Lead Technician', timesheetRequired: false });
    expect((await trail()).map((event) => event.summary).sort()).toEqual(
      [master, master, sipho, apprentice].map((person, index) => `Timesheets ${index === 1 ? 'required' : 'not required'}: ${person.firstName} ${person.lastName}`).sort(),
    );
  });

  it("a Technician and an Apprentice set nobody's, their own included; an Office account has nothing to set", async () => {
    for (const actor of [sipho, riaan, apprentice]) {
      for (const target of [sipho, riaan, apprentice, master, otherMaster]) {
        await expect(setTimesheetRequired(harness.as(await fresh(actor)), target.id, false)).rejects.toBeDefined();
      }
    }
    await expect(setRequired(sipho, sipho, false)).rejects.toBeDefined();
    for (const actor of [coordinator, master]) {
      await refusedWith(setTimesheetRequired(harness.as(actor), coordinator.id, false), 'timesheet_setting_not_permitted');
    }
    await unchanged(sipho, riaan, apprentice, master, otherMaster);
    expect(await trail()).toHaveLength(0);
  });
});

describe('TS-USER-1 — never switched off half-way', () => {

  it('not while a correction of a submitted timesheet waits for the office', async () => {
    const { requestTimesheetCorrection } = await import('./timesheet-corrections');
    const saved = await line(sipho);
    await recordAttendance(harness.as(sipho), { userId: sipho.id, date: '2026-11-05', status: 'present', note: '' });
    await complete(sipho, 'timesheet');
    await complete(sipho, 'attendance');
    const submission = await submitCompletedForms(harness.as(sipho), sipho.id);
    await requestTimesheetCorrection(harness.as(sipho), sipho.id, {
      from: FROM, to: TO, periodId: submission.timesheetPeriodId!, reason: 'OT was 2', comment: '',
      lines: [{ entryId: saved.id, date: '2026-11-05', customerName: 'ABC Engineering', overtimeHours: 2, doubleHours: 0 }],
    });
    await refusedWith(setRequired(coordinator, sipho, false), 'timesheet_in_progress');
  });

  it('not while a completed timesheet waits on My Monthly Forms — it is submitted first, so no form is stranded', async () => {
    await line(sipho);
    await complete(sipho, 'timesheet');
    await refusedWith(setRequired(coordinator, sipho, false), 'timesheet_in_progress');
    expect((await fresh(sipho)).timesheetRequired).not.toBe(false);
  });
});
