import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '@/domain';
import { DEMO_USERS, signedInAs, startTestServer, type ApiTestClient } from '@/test/api-harness';
import { embedsImageData, imageObjectCount, letterheadPng, preparedLetterhead, sha256 } from '@/test/letterhead-fixture';
import { pdfPlainText } from '@/lib/pdf/inspect';

/**
 * LETTERHEAD-1 OVER HTTP: uploading, reading back, replacing and removing a
 * company's letterhead through the real routes, with the real session, upload
 * bounds, sniffing, permission and audit.
 */
const PNG = letterheadPng(600, 100);
/** A real JPEG (Chromium's encoder), from the image module's fixtures. */
const JPEG = new Uint8Array(readFileSync(join(process.cwd(), 'src/lib/pdf/__fixtures__/quadrants.jpg')));

interface AdminCompany {
  readonly id: string;
  readonly letterhead: { readonly sha256: string; readonly contentType: string; readonly uploadedAt: string; readonly uploadedBy: string | null } | null;
}

const upload = (client: ApiTestClient, companyId: string, file: { name: string; type: string; bytes: Uint8Array }) =>
  client.upload<AdminCompany>(`/api/admin/companies/${companyId}/letterhead`, file);

describe('a company’s letterhead over HTTP', () => {
  let master: ApiTestClient;
  beforeEach(async () => {
    startTestServer();
    master = await signedInAs(DEMO_USERS.master);
  });

  it('accepts a PNG, stores it with its checksum, and serves those exact bytes back', async () => {
    const saved = await upload(master, 'eje', { name: 'eje-letterhead.png', type: 'image/png', bytes: PNG });
    expect(saved.status, JSON.stringify(saved.error)).toBe(200);
    expect(saved.data.letterhead).toMatchObject({ sha256: sha256(PNG), contentType: 'image/png' });
    // Never a way in: the storage key stays on the server.
    expect(JSON.stringify(saved.raw)).not.toContain('storageKey');

    const listed = await master.get<readonly AdminCompany[]>('/api/admin/companies');
    expect(listed.data.find((company) => company.id === 'eje')?.letterhead?.sha256).toBe(sha256(PNG));

    const file = await master.download(`/api/companies/eje/letterhead?v=${sha256(PNG)}`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(file.headers.get('x-content-type-options')).toBe('nosniff');
    expect(sha256(file.bytes)).toBe(sha256(PNG));
  });

  it('accepts a JPEG, typed by its bytes rather than the browser’s claim', async () => {
    const saved = await upload(master, 'wd-hearn-jhb', { name: 'wd.bin', type: 'application/octet-stream', bytes: JPEG });
    expect(saved.status, JSON.stringify(saved.error)).toBe(200);
    expect(saved.data.letterhead).toMatchObject({ sha256: sha256(JPEG), contentType: 'image/jpeg' });
    expect((await master.download('/api/companies/wd-hearn-jhb/letterhead')).headers.get('content-type')).toBe('image/jpeg');
  });

  it('refuses a text file renamed .png, an oversized file and an image the documents cannot embed', async () => {
    const renamed = await upload(master, 'eje', {
      name: 'letterhead.png',
      type: 'image/png',
      bytes: new TextEncoder().encode('This is not an image, whatever its name says.'),
    });
    expect(renamed.status).toBe(422);
    expect(renamed.error?.violations[0]?.code).toBe('unsupported_file_type');

    const oversized = new Uint8Array(2 * 1024 * 1024 + 1);
    oversized.set(PNG);
    const tooLarge = await upload(master, 'eje', { name: 'big.png', type: 'image/png', bytes: oversized });
    // Refused by the upload bound itself, before the body reaches the operation (400, as every route's bound).
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.error?.violations[0]?.code).toBe('file_too_large');

    // A PNG signature over pixels that will not decode.
    const broken = new Uint8Array([...PNG.subarray(0, 33), ...new Uint8Array(64).fill(7)]);
    const unembeddable = await upload(master, 'eje', { name: 'broken.png', type: 'image/png', bytes: broken });
    expect(unembeddable.status).toBe(422);
    expect(unembeddable.error?.violations[0]?.code).toBe('letterhead_not_embeddable');

    const webp = await upload(master, 'eje', {
      name: 'letterhead.webp',
      type: 'image/webp',
      bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]),
    });
    expect(webp.status).toBe(422);
    expect(webp.error?.violations[0]?.code).toBe('unsupported_file_type');

    // Nothing was recorded by any of them.
    const listed = await master.get<readonly AdminCompany[]>('/api/admin/companies');
    expect(listed.data.find((company) => company.id === 'eje')?.letterhead).toBeNull();
  });

  it('a technician can neither upload nor remove one, and may read it for a preview', async () => {
    const technician = await signedInAs(DEMO_USERS.technician);
    const refused = await upload(technician, 'eje', { name: 'eje.png', type: 'image/png', bytes: PNG });
    expect(refused.status).toBe(403);
    expect(refused.error?.violations[0]?.code).toBe('not_permitted');

    expect((await upload(master, 'eje', { name: 'eje.png', type: 'image/png', bytes: PNG })).status).toBe(200);
    expect((await technician.post('/api/admin/companies/eje/letterhead/remove')).status).toBe(403);
    const read = await technician.download('/api/companies/eje/letterhead');
    expect(read.status).toBe(200);
    expect(sha256(read.bytes)).toBe(sha256(PNG));
  });

  it('is audited when uploaded, replaced and removed, and removal leaves the text header', async () => {
    expect((await upload(master, 'eje', { name: 'eje.png', type: 'image/png', bytes: PNG })).status).toBe(200);
    expect((await upload(master, 'eje', { name: 'eje.jpg', type: 'image/jpeg', bytes: JPEG })).status).toBe(200);
    const removed = await master.post<AdminCompany>('/api/admin/companies/eje/letterhead/remove');
    expect(removed.status, JSON.stringify(removed.error)).toBe(200);
    expect(removed.data.letterhead).toBeNull();
    expect((await master.download('/api/companies/eje/letterhead')).status).toBe(404);

    const activity = await master.get<{ events: readonly { summary: string; changes: readonly { field: string; from: unknown; to: unknown }[] }[] }>('/api/activity');
    const events = (activity.data.events ?? []).filter((event) => event.summary.includes('letterhead'));
    expect(events.map((event) => event.summary)).toEqual(
      expect.arrayContaining([
        'EJE Industrial Electronics letterhead uploaded',
        'EJE Industrial Electronics letterhead replaced',
        'EJE Industrial Electronics letterhead removed',
      ]),
    );
    const changes = events.flatMap((event) => event.changes);
    expect(changes).toEqual(
      expect.arrayContaining([
        { field: 'company.eje.letterhead', from: null, to: sha256(PNG) },
        { field: 'company.eje.letterhead', from: sha256(PNG), to: sha256(JPEG) },
        { field: 'company.eje.letterhead', from: sha256(JPEG), to: null },
      ]),
    );
  });

  it('a 404 for a company with none, and for a company nobody knows', async () => {
    expect((await master.download('/api/companies/wd-hearn-jhb/letterhead')).status).toBe(404);
    expect((await master.download('/api/companies/nobody/letterhead')).status).toBe(404);
    expect((await upload(master, 'nobody', { name: 'x.png', type: 'image/png', bytes: PNG })).status).toBe(422);
  });

  it('a job screen names its own company’s letterhead, by checksum and never by key', async () => {
    const wdPng = letterheadPng(500, 120, [200, 30, 30]);
    expect((await upload(master, 'eje', { name: 'eje.png', type: 'image/png', bytes: PNG })).status).toBe(200);
    expect((await upload(master, 'wd-hearn-jhb', { name: 'wd.png', type: 'image/png', bytes: wdPng })).status).toBe(200);

    const created = await master.post<Job>('/api/jobs', {
      customerId: 'cust-midrand',
      siteId: 'site-midrand-main',
      contactId: 'contact-midrand-main',
      machineId: 'machine-midrand-press',
      companyId: 'wd-hearn-jhb',
      jobType: 'breakdown',
      priority: 'normal',
      scheduledDate: null,
      scheduledEndDate: null,
      orderNumber: '',
      referenceNumber: '',
      faultDescription: 'Spindle will not start.',
      primaryTechnicianId: null,
      additionalTechnicianIds: [],
      courierCollection: false,
      deliveryNote: '',
    });
    expect(created.status, JSON.stringify(created.error)).toBe(200);

    type Screen = { view: { companyLetterhead: { companyId: string; sha256: string } | null } };
    const wd = await master.get<Screen>(`/api/jobs/${created.data.jobNumber}`);
    expect(wd.data.view.companyLetterhead).toEqual({ companyId: 'wd-hearn-jhb', sha256: sha256(wdPng) });
    const eje = await master.get<Screen>('/api/jobs/EJE-1044');
    expect(eje.data.view.companyLetterhead).toEqual({ companyId: 'eje', sha256: sha256(PNG) });
    expect(JSON.stringify(wd.raw)).not.toContain('storageKey');
  });

  // LETTERHEAD-2: EJE's letterhead is now the MASTER letterhead — vector text and the traced
  // mark, no image — even with an EJE image uploaded; WD Hearn's image is never on them.
  // FORMS-INTERNAL-1 (the owner, 16 November 2026): attendance and timesheets are internal — no letterhead at all.
  it('a timesheet and an attendance form carry no letterhead at all — neither EJE’s nor WD Hearn’s', async () => {
    const wdPng = letterheadPng(500, 120, [200, 30, 30]);
    expect((await upload(master, 'eje', { name: 'eje.png', type: 'image/png', bytes: PNG })).status).toBe(200);
    expect((await upload(master, 'wd-hearn-jhb', { name: 'wd.png', type: 'image/png', bytes: wdPng })).status).toBe(200);
    const [eje, wd] = [await preparedLetterhead(PNG), await preparedLetterhead(wdPng)];

    const technician = await signedInAs(DEMO_USERS.technician);
    const sheet = await technician.download('/api/timesheets/user-tech-sipho/period/pdf?from=2026-10-01&to=2026-10-31');
    expect(sheet.status, sheet.error?.message).toBe(200);
    expect(imageObjectCount(sheet.bytes)).toBe(0);
    expect(embedsImageData(sheet.bytes, eje)).toBe(false);
    expect(embedsImageData(sheet.bytes, wd)).toBe(false);
    expect(pdfPlainText(sheet.bytes)).not.toContain('EJE Industrial Electronics cc');
    expect(pdfPlainText(sheet.bytes)).not.toContain('VAT NO: 4950134991');

    const attendance = await technician.download('/api/attendance/pdf?from=2026-10-01&to=2026-10-31');
    expect(attendance.status, attendance.error?.message).toBe(200);
    expect(imageObjectCount(attendance.bytes)).toBe(0);
    expect(embedsImageData(attendance.bytes, eje)).toBe(false);
    expect(embedsImageData(attendance.bytes, wd)).toBe(false);
    expect(pdfPlainText(attendance.bytes)).not.toContain('EJE Industrial Electronics cc');
    expect(pdfPlainText(attendance.bytes)).not.toContain('P.O. Box 16282');
  });
});
