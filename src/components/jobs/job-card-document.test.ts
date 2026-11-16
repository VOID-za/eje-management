import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-15T08:00:00.000Z'));
});
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildHarness } from '@/application/test-harness';
import { loadJobView, type JobView } from '@/application/job-view';
import { formatDate } from '@/lib/format';
import { JOB_CARD_LAYOUT_RENDERER } from '@/lib/job-card/layout-version';
import type { IsoDate } from '@/domain';
import { withWork } from '@/test/job-card-fixtures';
import { JobCardDocument } from './JobCardDocument';
import { PartsCollectionNote } from './PartsCollectionNote';

/**
 * JOB-CARD-2 on screen: the on-screen job card draws the redesigned layout the PDF draws — and a job
 * ISSUED before the redesign is shown as it was issued.
 */
const viewOf = async (jobNumber: string): Promise<JobView> => (await loadJobView(buildHarness().repos, jobNumber))!;

const withDatedWork = (view: JobView): JobView => {
  const source = withWork(
    { ...view, photoImages: new Map() },
    {
      labour: [
        { date: '2026-11-10', rateType: 'normal', hours: 6, description: 'Fault finding' },
        { date: '2026-11-12', rateType: 'overtime', hours: 2, description: 'Commissioning' },
      ],
      travel: [{ date: '2026-11-11', kilometres: 64, description: 'Site visit' }],
      parts: [{ partNumber: 'TRF-400', description: 'Transformer', quantity: 1, unitPriceCents: 312000 }],
    },
  );
  return { ...view, job: { ...source.job, finalDocument: null } };
};

let service: JobView;
let breakdown: JobView;

beforeAll(async () => {
  service = await viewOf('EJE-1044'); // issued before the redesign, with its checklist
  breakdown = await viewOf('EJE-1054'); // signed, with photographs, not issued
});

describe('JOB-CARD-2 — the on-screen job card', () => {
  it('dates labour and travel with their recorded dates; parts are undated', () => {
    const view = withDatedWork(breakdown);
    const markup = renderToStaticMarkup(createElement(JobCardDocument, { view }));
    const dates = [...markup.matchAll(/data-testid="job-card-charge-date">([^<]*)</gu)].map((m) => m[1]);
    expect(dates).toEqual([
      formatDate('2026-11-10' as IsoDate),
      formatDate('2026-11-12' as IsoDate),
      formatDate('2026-11-11' as IsoDate),
      '',
    ]);
    expect(markup).toMatch(/<th[^>]*>Date<\/th><th[^>]*>Description<\/th><th[^>]*>Qty<\/th><th[^>]*>Rate<\/th><th[^>]*>Amount<\/th>/u);
  });

  it('groups the contact details, puts the acceptance after the totals and before the checklist, and the photographs last on a new page', () => {
    const view = { ...service, job: { ...service.job, finalDocument: null } };
    const markup = renderToStaticMarkup(createElement(JobCardDocument, { view }));
    expect(markup).toContain('data-testid="job-card-contact"');
    expect(markup).toContain('Contact details');
    expect(markup).toContain('data-testid="job-card-main-heading"');
    const order = ['job-card-charges', 'job-card-acceptance', service.job.checklist === null ? 'job-card-acceptance' : 'Checklist (version'].map((marker) => markup.indexOf(marker));
    expect(order[0]).toBeLessThan(order[1]!);
    expect(order[1]).toBeLessThan(order[2]! + 1);
    const photos = renderToStaticMarkup(createElement(JobCardDocument, { view: breakdown }));
    expect(photos.indexOf('job-card-acceptance')).toBeLessThan(photos.indexOf('job-card-photographs'));
    expect(photos).toMatch(/class="[^"]*break-before-page[^"]*" data-testid="job-card-photographs"/u);
    expect(photos).toMatch(/class="[^"]*sm:ml-auto[^"]*" data-testid="job-card-acceptance"/u);
  });

  it('a job issued before the redesign is shown in the layout it was issued in; one issued after, in the new one', () => {
    const before = renderToStaticMarkup(createElement(JobCardDocument, { view: service }));
    expect(service.job.finalDocument).not.toBeNull();
    expect(before).not.toContain('job-card-charges');
    expect(before).not.toContain('Contact details');
    const issuedNow = { ...service, job: { ...service.job, finalDocument: { ...service.job.finalDocument!, renderer: JOB_CARD_LAYOUT_RENDERER } } };
    const after = renderToStaticMarkup(createElement(JobCardDocument, { view: issuedNow }));
    expect(after).toContain('job-card-charges');
    expect(after).toContain('Contact details');
  });

  it('the Parts Collection Note groups the contact and puts the collector’s acceptance on the right', async () => {
    const parts = await viewOf('EJE-1064'); // a collection not yet issued
    const markup = renderToStaticMarkup(createElement(PartsCollectionNote, { view: parts }));
    expect(markup).toContain('data-testid="parts-note-contact"');
    expect(markup).toMatch(/class="[^"]*sm:ml-auto[^"]*" data-testid="parts-note-acceptance"/u);
  });
});
