import { asCompanyId, DEFAULT_COMPANY_ID, isCompanyRuleError, type Company, type CompanyId, type CompanyLetterhead } from '@/domain';
import { preparePdfImage, sniffImage } from '@/lib/pdf/image';
import { EJE_MASTER_LETTERHEAD, carriesMasterLetterhead, type DocumentLetterhead } from '@/lib/branding/eje-letterhead';
import { sha256Hex } from '@/lib/job-card/document-identity';
import { StorageIntegrityFailed } from '@/services/ports';
import type { OperationContext } from './context';
import { audit } from './audit';
import { WorkflowError } from './errors';
import { adminViewOf, assertAdministers, type CompanyAdminView } from './company-operations';
import { storeAndMeasure } from './stored-file';

/**
 * A COMPANY'S OFFICIAL LETTERHEAD. LETTERHEAD-1 (15 November 2026).
 *
 * The owner: every newly generated document carries the official letterhead of
 * the company it is from, and the letterhead image is the source of truth —
 * logo, name, registration, VAT, addresses, telephone, fax, email, PO Box. It
 * is UPLOADED by the office, per company, exactly as the company supplied it;
 * nothing here draws, crops, retouches or invents one. Until a company's is
 * uploaded its documents keep the text header they have always had.
 *
 * WHAT IS ACCEPTED: a PNG or a JPEG, at most `MAX_LETTERHEAD_BYTES`, decided
 * by the BYTES (never the file name or the browser's claim), and only one the
 * document renderer can actually embed — it is prepared here, the same way it
 * will be prepared for every document, and refused if that fails. A letterhead
 * that uploads and then silently prints as nothing is worse than a refusal.
 *
 * WHO: the people who edit the companies (`settings.rates`), and every upload
 * and removal is audited as `settings_updated`, like the rest of a company's
 * details.
 *
 * NOTHING ALREADY ISSUED CHANGES. A document is drawn once, when it is issued,
 * and its bytes are kept; a new or removed letterhead reaches new documents
 * only. Removing one clears the company's record and keeps the stored bytes,
 * as every withdrawn file is kept.
 */

/** 2 MB: a full-page-width letterhead scan at print resolution is well inside it. */
export const MAX_LETTERHEAD_BYTES = 2 * 1024 * 1024;

/**
 * THE APPLICATION'S OWN LOGO FILES ARE NOT A LETTERHEAD. BRAND-1, LETTERHEAD-1.
 *
 * The owner approved the company's official letterhead on documents; the
 * application's interface logo stays off them. So the interface's PNG and JPEG
 * files — the logo as supplied and the home-screen icons cut from it — are
 * refused here by their checksum, whatever they are renamed to. (Its WebP cuts
 * are refused as WebP.) The BRAND-1 test holds this list to the files on disk,
 * so a new interface image cannot be added without being added here.
 */
export const INTERFACE_IMAGE_SHA256: ReadonlySet<string> = new Set([
  'be5eff04aeef909daef918c3c3a2723bfec05a846ef69cbb8010fd5a05fa6d45', // the logo as supplied (JPEG)
  '7973b0723fc67640c6a7cf3cb82a21e148ca26766f7198ad1f5831e7c2ee1d62', // apple-touch-icon.png
  '5513ead7f140e4c930c49971fdbccef9b0ead9252402eb503d9b61192f90e377', // icon-192.png
  'a8742150ea5c4a66138e5862843fa1c85769aee46baaa467b1bfb4fc225b8f95', // icon-512.png
  'f135834ec15f477a60b3af8737a39f6e817e4af26cef6ed449af1bf3aeef4e52', // icon-64.png
  'ffe9f079988f43f840aab2bd9f3646fef069a3dd2ee60976019d2cba8165ea45', // icon-maskable-512.png
]);

const refuse = (message: string, code: string, detail: string): WorkflowError =>
  new WorkflowError(message, [{ code, message: detail }]);

const companyOrRefuse = async (context: OperationContext, companyId: string): Promise<Company> => {
  const company = await context.repos.companies.findById(asCompanyId(companyId));
  if (company === null) {
    throw refuse('That company is not one the system serves.', 'unknown_company', 'Reload the list of companies.');
  }
  return company;
};

const saveOrRefuse = async (context: OperationContext, company: Company): Promise<Company> => {
  try {
    return await context.repos.companies.save(company);
  } catch (error) {
    if (isCompanyRuleError(error)) throw refuse(`${company.name} could not be saved.`, error.code, error.message);
    throw error;
  }
};

export interface LetterheadUpload {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

export const uploadCompanyLetterhead = async (
  context: OperationContext,
  companyId: string,
  file: LetterheadUpload,
): Promise<CompanyAdminView> => {
  assertAdministers(context);
  const existing = await companyOrRefuse(context, companyId);

  if (file.bytes.byteLength === 0) {
    throw refuse('That file is empty.', 'empty_file', 'Choose the letterhead image the company supplied.');
  }
  if (file.bytes.byteLength > MAX_LETTERHEAD_BYTES) {
    throw refuse('That file is too large.', 'file_too_large', 'A letterhead may be at most 2 MB.');
  }
  const kind = sniffImage(file.bytes);
  if (kind !== 'png' && kind !== 'jpeg') {
    throw refuse('That file is not a PNG or a JPEG.', 'unsupported_file_type',
      'Upload the letterhead as a PNG or a JPEG image, as the company supplied it.');
  }
  const checksum = await sha256Hex(file.bytes);
  if (INTERFACE_IMAGE_SHA256.has(checksum)) {
    throw refuse('That is the application’s logo, not a letterhead.', 'interface_logo_not_letterhead',
      'Upload the company’s official letterhead exactly as the company supplied it.');
  }
  const prepared = await preparePdfImage(file.bytes);
  if (prepared.kind !== 'image') {
    throw refuse('That image cannot be printed on a document.', 'letterhead_not_embeddable',
      `${prepared.reason} Save it again as an ordinary (non-interlaced) PNG or a JPEG and upload that.`);
  }

  const contentType = kind === 'png' ? 'image/png' : 'image/jpeg';
  const stored = await storeAndMeasure(
    context,
    { fileName: file.fileName, contentType, bytes: file.bytes },
    { message: 'That letterhead could not be stored.', code: 'letterhead_not_stored' },
  );
  const letterhead: CompanyLetterhead = {
    storageKey: stored.storageKey,
    contentType,
    sha256: stored.checksumSha256 ?? checksum,
    uploadedAt: context.services.clock.now(),
    uploadedBy: context.actor.id,
  };
  const saved = await saveOrRefuse(context, { ...existing, letterhead });

  await audit(context, {
    jobId: null,
    type: 'settings_updated',
    summary: `${saved.name} letterhead ${existing.letterhead === null ? 'uploaded' : 'replaced'}`,
    detail:
      `${file.fileName} (${file.bytes.byteLength} bytes, ${contentType}, ${prepared.image.width} × ${prepared.image.height}). ` +
      'Printed across the top of new documents only; documents already issued are unchanged.',
    changes: [{ field: `company.${saved.id}.letterhead`, from: existing.letterhead?.sha256 ?? null, to: letterhead.sha256 }],
  });
  return adminViewOf(saved);
};

export const removeCompanyLetterhead = async (
  context: OperationContext,
  companyId: string,
): Promise<CompanyAdminView> => {
  assertAdministers(context);
  const existing = await companyOrRefuse(context, companyId);
  if (existing.letterhead === null) return adminViewOf(existing);

  const saved = await saveOrRefuse(context, { ...existing, letterhead: null });
  await audit(context, {
    jobId: null,
    type: 'settings_updated',
    summary: `${saved.name} letterhead removed`,
    detail: 'New documents carry the text header again; documents already issued are unchanged.',
    changes: [{ field: `company.${saved.id}.letterhead`, from: existing.letterhead.sha256, to: null }],
  });
  return adminViewOf(saved);
};

/** The stored letterhead file of a company, or null when it has none (or its bytes are gone). */
export const readCompanyLetterheadFile = async (
  context: Pick<OperationContext, 'repos' | 'services'>,
  companyId: CompanyId,
): Promise<{ readonly bytes: Uint8Array; readonly contentType: string; readonly sha256: string } | null> => {
  const company = await context.repos.companies.findById(companyId);
  if (company === null || company.letterhead === null) return null;
  const stored = await context.services.storage.getDocument(company.letterhead.storageKey);
  if (stored === null || stored.bytes.byteLength === 0) return null;
  return { bytes: stored.bytes, contentType: company.letterhead.contentType, sha256: company.letterhead.sha256 };
};

/**
 * The letterhead file for the download route (`GET /api/companies/:id/letterhead`).
 *
 * A DAMAGED FILE IS NOT A MISSING ONE, and it is not served: when the stored
 * bytes no longer match their checksum the store raises, and this answers the
 * way every other stored document does — `document_damaged`, a 422 — rather
 * than a 500. The browser's preview treats any refusal as "no letterhead" and
 * draws the text header, as the server's own render does (`loadCompanyLetterhead`).
 */
export const downloadCompanyLetterheadFile = async (
  context: Pick<OperationContext, 'repos' | 'services'>,
  companyId: CompanyId,
): Promise<Awaited<ReturnType<typeof readCompanyLetterheadFile>>> => {
  try {
    return await readCompanyLetterheadFile(context, companyId);
  } catch (cause) {
    if (!(cause instanceof StorageIntegrityFailed)) throw cause;
    throw new WorkflowError('The letterhead is damaged.', [
      {
        code: 'document_damaged',
        message:
          'The stored letterhead is not the file that was uploaded, so it has not been served. ' +
          'Documents carry the text header until it is restored from a backup or uploaded again.',
      },
    ]);
  }
};

/**
 * The company's letterhead, prepared for a document — or undefined, and the
 * document carries its text header exactly as before.
 *
 * Undefined, too, when a letterhead is recorded but cannot be read or drawn
 * (its bytes damaged or gone): a document must not fail to issue for want of
 * its letterhead, and the text header names the same company from the same
 * record, so nothing false is printed.
 *
 * EJE IS THE MASTER LETTERHEAD. LETTERHEAD-2 (15 November 2026): the owner had
 * the official EJE letterhead recreated as a vector header, one for every EJE
 * document, so EJE's documents carry that — not an uploaded image of it (one
 * may still be stored; it is not printed), and no longer the text header. No
 * file is read for it. Every other company is exactly as LETTERHEAD-1 left it.
 */
export const loadCompanyLetterhead = async (
  context: Pick<OperationContext, 'repos' | 'services'>,
  companyId: CompanyId,
): Promise<DocumentLetterhead | undefined> => {
  if (carriesMasterLetterhead(companyId)) return EJE_MASTER_LETTERHEAD;
  let file: Awaited<ReturnType<typeof readCompanyLetterheadFile>>;
  try {
    file = await readCompanyLetterheadFile(context, companyId);
  } catch (cause) {
    if (!(cause instanceof StorageIntegrityFailed)) throw cause;
    return undefined;
  }
  if (file === null) return undefined;
  const prepared = await preparePdfImage(file.bytes);
  return prepared.kind === 'image' ? prepared.image : undefined;
};

/**
 * The letterhead of the DEFAULT company (EJE), for the paperwork that is no
 * job's: timesheets, attendance, payroll and finance packages are EJE's own —
 * so, since LETTERHEAD-2, the master letterhead.
 */
export const defaultCompanyLetterhead = (
  context: Pick<OperationContext, 'repos' | 'services'>,
): Promise<DocumentLetterhead | undefined> => loadCompanyLetterhead(context, DEFAULT_COMPANY_ID);
