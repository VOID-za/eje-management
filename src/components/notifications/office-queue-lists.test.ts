import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OfficeHandlingList } from './OfficeQueueLists';
import type { OfficeQueueRow } from '@/application/office-lifecycle';

/**
 * INBOX-HANDLE-1 (8 November 2026): THE INBOX OPENS A JOB CARD; IT DOES NOT HANDLE ONE.
 *
 * The Jobcard tab's Office Handling list carried "Mark handled" on every row,
 * so a card could be handled without anybody opening it. These render the list
 * as the browser receives it and hold it to a link to the job and nothing that
 * acts — and hold the job page's panel to the *Handle Jobcard* that replaced it.
 */
const row = (over: Partial<OfficeQueueRow> = {}): OfficeQueueRow => ({
  jobId: 'job-1065',
  jobNumber: 'EJE-1065',
  jobType: 'breakdown',
  status: 'office_handling',
  customerName: 'ABC Engineering',
  submittedAt: '2026-11-08T09:30:00.000Z',
  officeHandling: null,
  invoice: null,
  purchaseOrder: null,
  poOnHandling: null,
  ...over,
});

const render = (rows: readonly OfficeQueueRow[]): string =>
  renderToStaticMarkup(createElement(OfficeHandlingList, { rows }));

describe('the Inbox’s Office Handling list', () => {
  it('opens each job card on its job page', () => {
    const html = render([row(), row({ jobId: 'job-1070', jobNumber: 'EJE-1070', poOnHandling: 'PO-7' })]);
    expect(html).toContain('data-testid="office-handling-EJE-1065"');
    expect(html).toMatch(/<a[^>]*data-testid="queue-open-job-EJE-1065"[^>]*href="\/jobs\/EJE-1065"/u);
    expect(html).toMatch(/<a[^>]*data-testid="queue-open-job-EJE-1070"[^>]*href="\/jobs\/EJE-1070"/u);
    expect(html).toContain('Open jobcard');
    // The PO that handling would record is still said, so the office knows before opening it.
    expect(html).toContain('PO PO-7 on the job');
  });

  it('carries no Mark handled, no PO decision and no button at all', () => {
    const html = render([row(), row({ jobId: 'job-1070', jobNumber: 'EJE-1070', poOnHandling: 'PO-7' })]);
    expect(html).not.toMatch(/mark handled/iu);
    expect(html).not.toContain('Not the PO');
    expect(html).not.toContain('queue-mark-handled');
    expect(html).not.toContain('<button');
  });

  it('has no client path to the handling command left in it', () => {
    const source = readFileSync(new URL('./OfficeQueueLists.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('handleOffice');
  });

  it('says plainly when nothing is waiting', () => {
    expect(render([])).toContain('No submitted job card is waiting for the office.');
  });
});

describe('the job page’s office panel', () => {
  const panel = readFileSync(new URL('../jobs/OfficeLifecyclePanel.tsx', import.meta.url), 'utf8');

  it('offers Handle Jobcard, and the PO variant names the PO', () => {
    expect(panel).toContain('data-testid="handle-jobcard"');
    expect(panel).toContain("'Handle Jobcard'");
    expect(panel).toContain('`Handle Jobcard (PO ${existingPo})`');
    expect(panel).not.toMatch(/Mark handled with PO|data-testid="mark-handled"/u);
  });

  it('offers it only to the office, only in Office Handling, through the one handling command', () => {
    expect(panel).toMatch(/office && isAwaitingOfficeHandling\(job\.status\) && \(/u);
    expect(panel).toContain('jobs.handleOffice(');
  });
});
