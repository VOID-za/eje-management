import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_USERS, signedInAs, startTestServer, type ApiResponse, type ApiTestClient } from '@/test/api-harness';

/**
 * BD-PARTS-1 over HTTP (the owner, 15 November 2026): the rule holds on the routes themselves, not only on the
 * screens. A Breakdown in completion takes `add_part`, `update_part` and `remove_line` from the technician on it;
 * the same requests are refused once the customer is shown the job card, and after signing; a technician who is
 * not on the job is refused throughout; and two concurrent additions never lose one.
 */

interface PartLine { readonly id: string; readonly partNumber: string; readonly quantity: number; readonly unitPrice: number }
interface JobBody { readonly id: string; readonly jobNumber: string; readonly status: string; readonly parts: readonly PartLine[] }

const NEW_BREAKDOWN = {
  customerId: 'cust-abc',
  siteId: 'site-abc-jhb',
  contactId: 'contact-abc-jhb',
  machineId: 'machine-abc-lv40',
  jobType: 'breakdown',
  priority: 'urgent',
  scheduledDate: null,
  scheduledEndDate: null,
  orderNumber: 'PO-BD-PARTS',
  referenceNumber: '',
  faultDescription: 'Spindle drive alarm 9.',
  primaryTechnicianId: null,
  courierCollection: false,
  deliveryNote: '',
} as const;

const userId = async (client: ApiTestClient, email: string): Promise<string> =>
  (await client.get<{ users: readonly { id: string; email: string }[] }>('/api/admin')).data.users.find((user) => user.email === email)?.id ?? '';
const codes = (response: ApiResponse<unknown>): readonly string[] => (response.error?.violations ?? []).map((violation) => violation.code);
const part = (partNumber: string, quantity: number, unitPrice: number) => ({ partNumber, description: `${partNumber} part`, quantity, unitPrice });

describe('BD-PARTS-1 — a Breakdown’s parts in completion, over the API', () => {
  let master: ApiTestClient;
  let sipho: ApiTestClient;
  let riaan: ApiTestClient;
  let job: JobBody;

  /** The job as the server holds it now, read through the same route the job page uses. */
  const read = async (): Promise<JobBody> => (await master.get<{ view: { job: JobBody } }>(`/api/jobs/${job.jobNumber}`)).data.view.job;
  const partsNow = async () => (await read()).parts.map((line) => [line.partNumber, line.quantity]);

  beforeEach(async () => {
    startTestServer();
    master = await signedInAs(DEMO_USERS.master);
    const siphoId = await userId(master, DEMO_USERS.technician);
    job = (await master.post<JobBody>('/api/jobs', { ...NEW_BREAKDOWN, primaryTechnicianId: siphoId })).data;
    sipho = await signedInAs(DEMO_USERS.technician);
    riaan = await signedInAs(DEMO_USERS.otherTechnician);
    expect((await sipho.post(`/api/jobs/${job.id}/accept`)).status).toBe(200);
    expect((await sipho.post(`/api/jobs/${job.id}/add_labour`, { date: '2026-11-14', rateType: 'normal', hours: 2, description: 'Fault found' })).status).toBe(200);
    expect((await sipho.post(`/api/jobs/${job.id}/add_part`, part('BRG-6205', 1, 9_500))).status).toBe(200);
    expect((await sipho.post(`/api/jobs/${job.id}/save_report`, {
      faultFindings: 'Bearing collapsed.', diagnosis: 'Worn bearing.', workPerformed: 'Replaced the bearing.', recommendations: '', generalNotes: '',
    })).status).toBe(200);
    const started = await sipho.post<JobBody>(`/api/jobs/${job.id}/start_completion`);
    expect(started.status, JSON.stringify(started.error)).toBe(200);
    expect(started.data.status).toBe('completion');
  });

  it('adds, changes and removes parts in completion; the job stays in completion and reads back exactly', async () => {
    expect((await sipho.post(`/api/jobs/${job.id}/add_part`, part('FUSE-10A', 2, 1_200))).status).toBe(200);
    const relay = await sipho.post<JobBody>(`/api/jobs/${job.id}/add_part`, part('RLY-24V', 1, 4_300));
    expect(relay.status).toBe(200);
    const relayId = relay.data.parts.find((line) => line.partNumber === 'RLY-24V')!.id;
    const changed = await sipho.post<JobBody>(`/api/jobs/${job.id}/update_part`, { lineId: relayId, ...part('RLY-24V', 3, 4_300) });
    expect(changed.status, JSON.stringify(changed.error)).toBe(200);
    const fuseId = changed.data.parts.find((line) => line.partNumber === 'FUSE-10A')!.id;
    expect((await sipho.post(`/api/jobs/${job.id}/remove_line`, { kind: 'part', lineId: fuseId })).status).toBe(200);

    const now = await read();
    expect(now.status).toBe('completion');
    expect(now.parts.map((line) => [line.partNumber, line.quantity, line.unitPrice])).toEqual([['BRG-6205', 1, 9_500], ['RLY-24V', 3, 4_300]]);
  });

  it('a technician who is not on the job is refused, and nothing changes', async () => {
    const response = await riaan.post(`/api/jobs/${job.id}/add_part`, part('NOT-MINE', 1, 1));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await partsNow()).toEqual([['BRG-6205', 1]]);
  });

  it('refuses every part change once the customer is shown the job card, and after the signature', async () => {
    expect((await sipho.post(`/api/jobs/${job.id}/start_signature`)).status).toBe(200);
    const lineId = (await read()).parts[0]!.id;
    for (const [route, body] of [
      ['add_part', part('LATE', 1, 1)],
      ['update_part', { lineId, ...part('BRG-6205', 9, 1) }],
      ['remove_line', { kind: 'part', lineId }],
    ] as const) {
      const response = await sipho.post(`/api/jobs/${job.id}/${route}`, body);
      expect(response.status, route).toBe(422);
      expect(codes(response), route).toContain('parts_locked_after_completion');
      const office = await master.post(`/api/jobs/${job.id}/${route}`, body);
      expect(office.status, `office ${route}`).toBe(422);
    }
    expect((await sipho.post(`/api/jobs/${job.id}/capture_signature`, { customerName: 'Thandi', customerSurname: 'Nkosi', strokeData: 'M0,0 L10,10' })).status).toBe(200);
    const signed = await master.post(`/api/jobs/${job.id}/add_part`, part('LATE', 1, 1));
    expect(signed.status).toBe(422);
    expect(codes(signed)).toContain('job_finalized');
    expect(await partsNow()).toEqual([['BRG-6205', 1]]);
  });

  it('two additions sent at the same moment are both kept, or the loser is refused — never silently lost', async () => {
    const answers = await Promise.all([
      sipho.post(`/api/jobs/${job.id}/add_part`, part('PAR-A', 1, 100)),
      sipho.post(`/api/jobs/${job.id}/add_part`, part('PAR-B', 1, 200)),
    ]);
    const accepted = answers.filter((answer) => answer.status === 200).length;
    const parts = (await read()).parts.map((line) => line.partNumber);
    expect(accepted).toBeGreaterThanOrEqual(1);
    expect(parts.filter((number) => number === 'PAR-A' || number === 'PAR-B')).toHaveLength(accepted);
  });
});
