import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderJobCardPdf } from './job-card-pdf';
import { renderCorrectionPdf } from './correction-pdf';
import { renderDeliveryNotePdf } from './delivery-note-pdf';
import { pdfPlainText } from '@/lib/pdf/inspect';
import { buildDeliveryNoteModel } from '@/lib/job-card/delivery-note';
import { documentIdentityFor } from '@/lib/job-card/document-identity';
import { loadJobView, type JobView } from '@/application/job-view';
import { buildHarness } from '@/application/test-harness';
import { JobCardDocument } from '@/components/jobs/JobCardDocument';
import { PartsCollectionNote } from '@/components/jobs/PartsCollectionNote';
import { DeliveryNoteDocument } from '@/components/jobs/DeliveryNoteDocument';
import { DEFAULT_COMPANY_ID, WD_HEARN_JHB_COMPANY_ID, type CompanyDetails } from '@/domain';
import {
  FROZEN_AT,
  GENERATED_AT,
  JOB_DOCUMENTS,
  correctionSource,
  deliveryNoteModel,
  jobSource,
} from '@/test/letterhead-documents';
import { textRuns } from '@/test/letterhead-fixture';
import type { FinalDocumentSource } from '../ports';

/**
 * MULTI-CO-1: the dark "EJE" tile in the text header is EJE's own mark. A WD
 * Hearn JHB document without a letterhead carries no tile — never "EJE" beside
 * "WD Hearn JHB" — and its Delivery Note is released by WDJ, not EJE. EJE's
 * documents keep the tile and their bytes (`letterhead.test.ts` pins those).
 */

const WDJ: CompanyDetails = {
  id: WD_HEARN_JHB_COMPANY_ID,
  code: 'WDJ',
  name: 'WD Hearn JHB',
  registration: '',
  vatNumber: '',
  physicalAddress: '12 Hearn Street, Germiston',
  postalAddress: '',
  phone: '',
  fax: '',
  email: '',
};

/** Text runs that are exactly the tile's "EJE" — a job number like EJE-1044 is not one. */
const tileRuns = (bytes: Uint8Array) => textRuns(bytes).filter((run) => run.value === 'EJE');
const tileMarkup = /<span class="flex size-11[^"]*">EJE<\/span>/u;

let eje: FinalDocumentSource;
let ejeParts: FinalDocumentSource;
let ejeView: JobView;
let ejePartsView: JobView;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FROZEN_AT);
  eje = await jobSource(JOB_DOCUMENTS.jobCard);
  ejeParts = await jobSource(JOB_DOCUMENTS.partsCollectionNote);
  const harness = buildHarness();
  ejeView = (await loadJobView(harness.repos, JOB_DOCUMENTS.jobCard))!;
  ejePartsView = (await loadJobView(harness.repos, JOB_DOCUMENTS.partsCollectionNote))!;
});
afterAll(() => {
  vi.useRealTimers();
});

describe('the EJE tile is EJE’s alone', () => {
  it('is on EJE’s job card and parts collection note, and on no WD Hearn JHB one', () => {
    for (const source of [eje, ejeParts]) {
      expect(tileRuns(renderJobCardPdf(source, 'eje.pdf', GENERATED_AT).bytes)).toHaveLength(1);
      const wd = renderJobCardPdf({ ...source, company: WDJ }, 'wd.pdf', GENERATED_AT).bytes;
      expect(tileRuns(wd)).toEqual([]);
      expect(pdfPlainText(wd)).toContain('WD Hearn JHB');
    }
  });

  it('leaves the WD Hearn JHB name and address exactly where EJE’s stand', () => {
    const at = (bytes: Uint8Array, value: string) => {
      const run = textRuns(bytes).find((candidate) => candidate.value === value)!;
      return { x: run.x, y: run.y };
    };
    const ejeBytes = renderJobCardPdf(eje, 'eje.pdf', GENERATED_AT).bytes;
    const wdBytes = renderJobCardPdf({ ...eje, company: WDJ }, 'wd.pdf', GENERATED_AT).bytes;
    const ejeName = eje.company!.name;
    expect(at(wdBytes, 'WD Hearn JHB')).toEqual(at(ejeBytes, ejeName));
  });

  it('is on EJE’s correction addendum (an id left out means EJE), and not on WD Hearn JHB’s', () => {
    expect(tileRuns(renderCorrectionPdf(correctionSource, 'c.pdf').bytes)).toHaveLength(1);
    expect(
      tileRuns(renderCorrectionPdf({ ...correctionSource, company: { ...correctionSource.company, id: DEFAULT_COMPANY_ID } }, 'c.pdf').bytes),
    ).toHaveLength(1);
    const wd = renderCorrectionPdf(
      { ...correctionSource, company: { id: WD_HEARN_JHB_COMPANY_ID, name: 'WD Hearn JHB', address: '', contactLine: '', registrationLine: '' } },
      'c.pdf',
    ).bytes;
    expect(tileRuns(wd)).toEqual([]);
    expect(pdfPlainText(wd)).toContain('WD Hearn JHB');
  });

  it('is not on WD Hearn JHB’s on-screen job card and collection note; EJE’s carry the master letterhead instead', () => {
    // LETTERHEAD-2: on screen, as in the PDF, EJE's header is the master letterhead — the
    // text header (and its tile) is what a company WITHOUT a letterhead keeps.
    for (const markup of [
      renderToStaticMarkup(createElement(JobCardDocument, { view: ejeView })),
      renderToStaticMarkup(createElement(PartsCollectionNote, { view: ejePartsView })),
    ]) {
      expect(markup).toContain('data-letterhead="eje-master"');
      expect(markup).not.toMatch(tileMarkup);
    }
    const wdCard = renderToStaticMarkup(createElement(JobCardDocument, { view: { ...ejeView, company: WDJ } }));
    const wdNote = renderToStaticMarkup(createElement(PartsCollectionNote, { view: { ...ejePartsView, company: WDJ } }));
    for (const markup of [wdCard, wdNote]) {
      expect(markup).not.toMatch(tileMarkup);
      expect(markup).not.toMatch(/>EJE</u);
      expect(markup).toContain('WD Hearn JHB');
      expect(markup).toContain('data-testid="no-company-tile"');
      expect(markup).not.toContain('data-letterhead');
    }
    // With an uploaded letterhead, WD Hearn JHB's on-screen documents show that image instead.
    const letterhead = { companyId: WD_HEARN_JHB_COMPANY_ID, sha256: 'wd-image' };
    for (const markup of [
      renderToStaticMarkup(createElement(JobCardDocument, { view: { ...ejeView, company: WDJ, companyLetterhead: letterhead } })),
      renderToStaticMarkup(createElement(PartsCollectionNote, { view: { ...ejePartsView, company: WDJ, companyLetterhead: letterhead } })),
    ]) {
      expect(markup).toContain('data-letterhead="uploaded"');
      expect(markup).toContain('alt="WD Hearn JHB letterhead"');
      expect(markup).not.toContain('data-testid="no-company-tile"');
      expect(markup).not.toContain('eje-master');
    }
  });

  it('does not change the document identity of an EJE job, and is not part of it', async () => {
    const withId = await documentIdentityFor(eje);
    // The same EJE source, its company id changed: the identity reads only what the customer reads.
    const relabelled = await documentIdentityFor({ ...eje, company: { ...eje.company!, id: WD_HEARN_JHB_COMPANY_ID } });
    expect(relabelled).toBe(withId);
  });
});

describe('the Delivery Note is released by the job’s company', () => {
  it('says "Released by (EJE)" on EJE’s and "Released by (WDJ)" on WD Hearn JHB’s', () => {
    expect(pdfPlainText(renderDeliveryNotePdf(deliveryNoteModel).bytes)).toContain('Released by (EJE)');
    const ejeBuilt = { ...buildDeliveryNoteModel(ejeView, GENERATED_AT), signature: null };
    expect(ejeBuilt.company.code).toBe('EJE');
    expect(pdfPlainText(renderDeliveryNotePdf(ejeBuilt).bytes)).toContain('Released by (EJE)');

    const wdBuilt = { ...buildDeliveryNoteModel({ ...ejeView, company: WDJ }, GENERATED_AT), signature: null };
    const wdText = pdfPlainText(renderDeliveryNotePdf(wdBuilt).bytes);
    expect(wdText).toContain('Released by (WDJ)');
    expect(wdText).not.toContain('Released by (EJE)');

    const markup = renderToStaticMarkup(createElement(DeliveryNoteDocument, { model: wdBuilt }));
    expect(markup).toContain('Released by (WDJ)');
    expect(renderToStaticMarkup(createElement(DeliveryNoteDocument, { model: deliveryNoteModel }))).toContain('Released by (EJE)');
  });
});
