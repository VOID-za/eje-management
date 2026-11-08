import { beforeEach, describe, expect, it } from 'vitest';
import { editJobDetails } from './job-details';
import { createAvailability } from './availability-operations';
import { loadCalendar } from './calendar';
import { WorkflowError } from './errors';
import { buildHarness, dayOffset, seedUser, type Harness } from './test-harness';
import { editableDetailFields, jobDetailLabel, type Job } from '@/domain';

/**
 * JOB-SCHED-EDIT-1 (8 November 2026) — the scheduled date on Job details → Edit.
 *
 * Not a new field: the edit writes `Job.scheduledDate` / `scheduledEndDate`,
 * the columns creation writes and the calendar reads. These hold the edit to
 * the rules every other detail keeps (who, when, stale value, from/to audit)
 * and to the ones `rescheduleJob` keeps for a date (a real day, no end before
 * the start, the technicians free on the new days).
 *
 * Seed facts: EJE-1048 an open breakdown (Sipho and André, scheduled today),
 * EJE-1049 an open service booked across a range (Riaan), EJE-1064 a parts
 * collection, EJE-1046 SIGNED.
 */
const master = seedUser('user-master-elmarie');
const coordinator = seedUser('user-coord-christene');
const sipho = seedUser('user-tech-sipho');

let harness: Harness;
beforeEach(() => {
  harness = buildHarness();
});

const jobNumbered = async (jobNumber: string): Promise<Job> => {
  const job = await harness.repos.jobs.findByJobNumber(jobNumber);
  if (job === null) throw new Error(`${jobNumber} is not seeded`);
  return job;
};

const refusal = async (attempt: Promise<unknown>): Promise<string> => {
  try {
    await attempt;
    return 'not refused';
  } catch (error) {
    if (error instanceof WorkflowError) return error.violations[0]?.code ?? 'no code';
    throw error;
  }
};

const edits = async (job: Job) =>
  (await harness.repos.activity.list(job.id)).filter((event) => event.type === 'job_details_edited');

describe('which jobs carry an editable schedule', () => {
  it('every type creation schedules — and the end date only where it books a range', () => {
    expect(editableDetailFields('breakdown')).toContain('scheduledDate');
    expect(editableDetailFields('breakdown')).not.toContain('scheduledEndDate');
    expect(editableDetailFields('test_and_repair')).toContain('scheduledDate');
    expect(editableDetailFields('service')).toEqual(expect.arrayContaining(['scheduledDate', 'scheduledEndDate']));
    // Office-processed: creation stores no date, so there is none to edit.
    expect(editableDetailFields('parts')).not.toContain('scheduledDate');
    expect(editableDetailFields('delivery_note')).not.toContain('scheduledDate');
  });

  it('labels the date as New Job does', () => {
    expect(jobDetailLabel('scheduledDate', 'breakdown')).toBe('Scheduled date');
    expect(jobDetailLabel('scheduledDate', 'service')).toBe('Scheduled start date');
    expect(jobDetailLabel('scheduledEndDate', 'service')).toBe('Scheduled end date');
  });
});

describe('setting, changing and clearing the scheduled date', () => {
  it('changes an existing date, records it from/to, and touches no other date', async () => {
    const job = await jobNumbered('EJE-1048');
    const to = dayOffset(40);
    const saved = await editJobDetails(harness.as(master), job, {
      changes: { scheduledDate: to },
      expected: { scheduledDate: job.scheduledDate },
    });
    expect(saved.scheduledDate).toBe(to);

    const stored = await jobNumbered('EJE-1048');
    expect(stored.scheduledDate).toBe(to);
    // Creation, acceptance, completion and submission are not details.
    expect(stored.createdAt).toBe(job.createdAt);
    expect(stored.acceptedAt).toBe(job.acceptedAt);
    expect(stored.completedAt).toBe(job.completedAt);
    expect(stored.submittedAt).toBe(job.submittedAt);
    expect(stored.dateReceived).toBe(job.dateReceived);

    const trail = await edits(job);
    expect(trail).toHaveLength(1);
    expect(trail[0]!.actorId).toBe(master.id);
    expect(trail[0]!.detail).toContain('scheduled date');
    expect(trail[0]!.changes).toEqual([{ field: 'details.scheduledDate', from: job.scheduledDate, to }]);
  });

  it('clears it — an open job may be unscheduled — and sets it again on a job with none', async () => {
    const job = await jobNumbered('EJE-1048');
    const cleared = await editJobDetails(harness.as(coordinator), job, {
      changes: { scheduledDate: null },
      expected: { scheduledDate: job.scheduledDate },
    });
    expect(cleared.scheduledDate).toBeNull();

    const empty = await jobNumbered('EJE-1048');
    expect(empty.scheduledDate).toBeNull();
    const set = await editJobDetails(harness.as(coordinator), empty, {
      changes: { scheduledDate: dayOffset(41) },
      expected: { scheduledDate: null },
    });
    expect(set.scheduledDate).toBe(dayOffset(41));

    // The trail reads newest first.
    expect((await edits(job)).map((event) => event.changes)).toEqual([
      [{ field: 'details.scheduledDate', from: null, to: dayOffset(41) }],
      [{ field: 'details.scheduledDate', from: job.scheduledDate, to: null }],
    ]);
  });

  it('moves a service’s whole range, and clears both ends together', async () => {
    const job = await jobNumbered('EJE-1049');
    const saved = await editJobDetails(harness.as(master), job, {
      changes: { scheduledDate: dayOffset(50), scheduledEndDate: dayOffset(52) },
      expected: { scheduledDate: job.scheduledDate, scheduledEndDate: job.scheduledEndDate },
    });
    expect([saved.scheduledDate, saved.scheduledEndDate]).toEqual([dayOffset(50), dayOffset(52)]);

    const cleared = await editJobDetails(harness.as(master), saved, {
      changes: { scheduledDate: null, scheduledEndDate: null },
      expected: { scheduledDate: dayOffset(50), scheduledEndDate: dayOffset(52) },
    });
    expect([cleared.scheduledDate, cleared.scheduledEndDate]).toEqual([null, null]);
  });

  it('is reflected on the calendar at once', async () => {
    const job = await jobNumbered('EJE-1049');
    await editJobDetails(harness.as(master), job, {
      changes: { scheduledDate: dayOffset(60), scheduledEndDate: dayOffset(62) },
      expected: { scheduledDate: job.scheduledDate, scheduledEndDate: job.scheduledEndDate },
    });
    const calendar = await loadCalendar(harness.repos, { from: dayOffset(55), to: dayOffset(65) }, master);
    const entry = calendar.entries.find((candidate) => candidate.kind === 'job' && candidate.jobNumber === 'EJE-1049');
    expect(entry).toMatchObject({ start: dayOffset(60), end: dayOffset(62), days: 3 });

    // And gone from where it used to be.
    if (job.scheduledDate !== null) {
      const before = await loadCalendar(harness.repos, { from: job.scheduledDate, to: job.scheduledDate }, master);
      expect(before.entries.some((candidate) => candidate.kind === 'job' && candidate.jobNumber === 'EJE-1049')).toBe(false);
    }
  });
});

describe('what is refused, and leaves the job as it was', () => {
  it.each(['2026-02-31', '2026-13-01', 'tomorrow'])('a date that does not exist — %s', async (value) => {
    const job = await jobNumbered('EJE-1048');
    expect(
      await refusal(
        editJobDetails(harness.as(master), job, {
          changes: { scheduledDate: value },
          expected: { scheduledDate: job.scheduledDate },
        }),
      ),
    ).toBe('scheduled_date_invalid');
    expect((await jobNumbered('EJE-1048')).scheduledDate).toBe(job.scheduledDate);
    expect(await edits(job)).toHaveLength(0);
  });

  it('a service ending before it starts, or ending with no start', async () => {
    const job = await jobNumbered('EJE-1049');
    expect(
      await refusal(
        editJobDetails(harness.as(master), job, {
          changes: { scheduledDate: dayOffset(30), scheduledEndDate: dayOffset(28) },
          expected: { scheduledDate: job.scheduledDate, scheduledEndDate: job.scheduledEndDate },
        }),
      ),
    ).toBe('end_before_start');
    expect(
      await refusal(
        editJobDetails(harness.as(master), job, {
          changes: { scheduledDate: null },
          expected: { scheduledDate: job.scheduledDate },
        }),
      ),
    ).toBe('end_without_start');
    const stored = await jobNumbered('EJE-1049');
    expect([stored.scheduledDate, stored.scheduledEndDate]).toEqual([job.scheduledDate, job.scheduledEndDate]);
  });

  it('a technician — the same permission as every other detail', async () => {
    const job = await jobNumbered('EJE-1048');
    expect(
      await refusal(
        editJobDetails(harness.as(sipho), job, {
          changes: { scheduledDate: dayOffset(40) },
          expected: { scheduledDate: job.scheduledDate },
        }),
      ),
    ).toBe('not_permitted');
    expect((await jobNumbered('EJE-1048')).scheduledDate).toBe(job.scheduledDate);
  });

  it('a signed job', async () => {
    const job = await jobNumbered('EJE-1046');
    expect(
      await refusal(
        editJobDetails(harness.as(master), job, {
          changes: { scheduledDate: dayOffset(40) },
          expected: { scheduledDate: job.scheduledDate },
        }),
      ),
    ).toBe('job_finalized');
  });

  it('a job type that has no schedule (a parts collection)', async () => {
    const job = await jobNumbered('EJE-1064');
    expect(
      await refusal(
        editJobDetails(harness.as(master), job, {
          changes: { scheduledDate: dayOffset(40) },
          expected: { scheduledDate: null },
        }),
      ),
    ).toBe('not_applicable_to_job_type');
  });

  it('a stale date: somebody moved it after the editor opened the job', async () => {
    const opened = await jobNumbered('EJE-1048');
    await editJobDetails(harness.as(master), opened, {
      changes: { scheduledDate: dayOffset(42) },
      expected: { scheduledDate: opened.scheduledDate },
    });
    expect(
      await refusal(
        editJobDetails(harness.as(coordinator), await jobNumbered('EJE-1048'), {
          changes: { scheduledDate: dayOffset(43) },
          expected: { scheduledDate: opened.scheduledDate },
        }),
      ),
    ).toBe('job_details_changed');
    expect((await jobNumbered('EJE-1048')).scheduledDate).toBe(dayOffset(42));
  });

  it('a day an assigned technician is away — exactly as a reschedule is refused', async () => {
    await createAvailability(harness.as(master), {
      userId: sipho.id,
      type: 'appointment',
      startDate: dayOffset(44),
      endDate: dayOffset(44),
      allDay: true,
      startTime: null,
      endTime: null,
      description: 'Leave',
    });
    const job = await jobNumbered('EJE-1048');
    expect(
      await refusal(
        editJobDetails(harness.as(master), job, {
          changes: { scheduledDate: dayOffset(44) },
          expected: { scheduledDate: job.scheduledDate },
        }),
      ),
    ).toBe('technician_unavailable');
  });

  it('an old clash is not raised again when only another detail changes', async () => {
    const job = await jobNumbered('EJE-1048');
    await createAvailability(harness.as(master), {
      userId: sipho.id,
      type: 'appointment',
      startDate: job.scheduledDate!,
      endDate: job.scheduledDate!,
      allDay: true,
      startTime: null,
      endTime: null,
      description: 'Leave',
    });
    const saved = await editJobDetails(harness.as(master), job, {
      changes: { orderNumber: 'PO-ONLY' },
      expected: { orderNumber: job.orderNumber },
    });
    expect(saved.orderNumber).toBe('PO-ONLY');
  });
});
