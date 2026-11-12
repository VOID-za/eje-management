import { prepareJpeg, type PdfImage } from '@/lib/pdf/image';
import type { PdfBuilder } from '@/lib/pdf/writer';
import { PDF_MARK_JPEG_BASE64 } from './pdf-mark';

/**
 * The EJE mark on generated PDFs. BRAND-1.
 *
 * The lettering cut square from the owner's logo (`scripts/generate-brand-assets.mjs`),
 * embedded as the JPEG it already is — the same path a customer's photograph takes.
 * Always drawn into a SQUARE box, so it is never stretched.
 *
 * ONLY NEW RENDERS CARRY IT. An issued job card is rendered once and its bytes are
 * stored; a completed or submitted form's PDF likewise. Those are read back, never
 * redrawn, so nothing signed or submitted before this changes.
 */

let prepared: PdfImage | null = null;

/** The mark, decoded once. Throws if the generated asset is damaged — a build fault, not a runtime one. */
export const brandMark = (): PdfImage => {
  if (prepared !== null) return prepared;
  // atob, not Buffer: the renderers run in the browser too (the demonstration backend).
  const outcome = prepareJpeg(Uint8Array.from(atob(PDF_MARK_JPEG_BASE64), (char) => char.charCodeAt(0)));
  if (outcome.kind !== 'image') throw new Error(`The EJE mark for PDFs could not be read: ${outcome.reason}`);
  prepared = outcome.image;
  return prepared;
};

/** Draws the mark with its bottom-left corner at (x, y), `size` points square. */
export const drawBrandMark = (pdf: PdfBuilder, x: number, y: number, size: number): void => {
  pdf.image(brandMark(), x, y, size, size);
};

/**
 * The mark beside a one-line company name whose baseline is `baseline`, sized to that line:
 * from the capitals' top to just below the baseline, so it takes no room from the line beneath.
 * Returns how far the name must move right to sit beside it.
 */
export const drawInlineBrandMark = (pdf: PdfBuilder, x: number, baseline: number, fontSize: number): number => {
  const size = fontSize * 1.12;
  drawBrandMark(pdf, x, baseline - fontSize * 0.4, size);
  return size + fontSize * 0.45;
};
