import { A4_HEIGHT, A4_WIDTH, PdfBuilder, textWidth, type PdfFont, type PdfForm } from '@/lib/pdf/writer';
import { displaySize, type PdfImage } from '@/lib/pdf/image';
import { parseSvgPath, pathBounds, pathOperators } from '@/lib/pdf/path';
import {
  LETTERHEAD_INK,
  isMasterLetterhead,
  layoutLetterhead,
  letterheadLineGlyphs,
  letterheadLineMatrix,
  letterheadLineText,
  type DocumentLetterhead,
  type LetterheadArea,
} from '@/lib/branding/eje-letterhead';

/**
 * THE PAPER ITSELF: page geometry, the type scale, the colours and the cursor.
 *
 * Extracted from `job-card-pdf.ts` when a SECOND document needed it — the
 * correction addendum (BD-02). The two documents are different documents and
 * must look like the same company's paper, which they will only do while there
 * is one definition of what that paper is.
 *
 * The scale mirrors the on-screen document: it is 820px wide with 40px
 * padding, so 740px of content become 515pt here, a factor of about 0.7. Every
 * size and gap below is the screen's Tailwind value at that scale, which is
 * what keeps the printed document recognisably the same document rather than a
 * denser relative of it.
 */

export const MARGIN = 40;
export const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;
export const RIGHT = A4_WIDTH - MARGIN;
export const FOOTER_SPACE = 44;

/** Type scale, from the screen's px values at 0.7. */
export const SIZE = {
  companyName: 12.5, // text-lg
  jobNumber: 17, // text-2xl
  small: 7.5, // text-xs
  body: 9, // 13px base
  tiny: 7, // text-[11px]
  total: 11, // text-base
  signature: 17,
} as const;

/** Vertical rhythm, from the screen's spacing utilities at 0.7. */
export const GAP = {
  section: 17, // mt-6
  sectionLarge: 22, // mt-8
  line: 12,
  tight: 10,
} as const;

/**
 * The screen's letter-spaced section headings.
 *
 * `tracking-[0.12em]` at 7.5pt is 0.9pt; the wider `tracking-[0.18em]` on the
 * document title is 1.35pt. Applied through the PDF `Tc` operator, so the text
 * stays one searchable word rather than being padded with spaces.
 */
export const TRACK_HEADING = 0.9;
export const TRACK_TITLE = 1.35;

export const INK = '#1b2434'; // steel-900
export const BODY = '#39414f'; // steel-700/800
export const MUTED = '#6b7481'; // steel-500
export const FAINT = '#9aa2ad'; // steel-400
export const RULE = '#dfe3e8'; // steel-200
export const RULE_SOFT = '#eef0f3'; // steel-100
export const BAND = '#f6f7f9'; // steel-50

/** Column geometry for the charges table, mirroring the screen's widths. */
export const COL_QTY = RIGHT - 190;
export const COL_RATE = RIGHT - 120;
export const COL_AMOUNT = RIGHT;

export class Sheet {
  readonly pdf = new PdfBuilder();
  private y = 0;

  constructor() {
    this.break();
  }

  private break(): void {
    this.pdf.addPage();
    this.y = A4_HEIGHT - MARGIN;
  }

  get cursor(): number {
    return this.y;
  }

  move(by: number): void {
    this.y -= by;
  }

  /**
   * Places the cursor at an absolute position.
   *
   * Two-column blocks need it: each column is laid out from the same top, and
   * the block continues below whichever ran longer. Nudging a relative cursor
   * backwards instead is how the customer's contact details came to be printed
   * over the job details beside them.
   */
  setCursor(y: number): void {
    this.y = y;
  }

  /** True if `height` will not fit on the current page. */
  wouldOverflow(height: number): boolean {
    return this.y - height < MARGIN + FOOTER_SPACE;
  }

  /** Breaks to a new page when `height` will not fit. */
  need(height: number): void {
    if (this.wouldOverflow(height)) this.break();
  }

  text(x: number, value: string, options: { font?: PdfFont; size?: number; colour?: string } = {}): void {
    this.pdf.text(x, this.y, value, options);
  }

  /** Right-aligned at `x`. */
  textRight(x: number, value: string, options: { font?: PdfFont; size?: number; colour?: string } = {}): void {
    const size = options.size ?? SIZE.body;
    this.pdf.text(x - textWidth(value, size, options.font ?? 'regular'), this.y, value, options);
  }

  rule(colour = RULE, width = 0.6, from = MARGIN, to = RIGHT): void {
    this.pdf.line(from, this.y, to, this.y, width, colour);
  }

  /** The screen's uppercase, letter-spaced section heading. */
  sectionTitle(label: string): void {
    this.need(GAP.line + 14);
    this.pdf.text(MARGIN, this.y, label.toUpperCase(), {
      font: 'bold',
      size: SIZE.small,
      colour: MUTED,
      tracking: TRACK_HEADING,
    });
    this.move(GAP.line);
  }

  paragraph(
    value: string,
    options: { font?: PdfFont; size?: number; colour?: string; width?: number; x?: number; leading?: number } = {},
  ): void {
    const size = options.size ?? SIZE.body;
    const width = options.width ?? CONTENT_WIDTH;
    const leading = options.leading ?? size * 1.45;
    for (const line of PdfBuilder.wrap(value, width, size, options.font ?? 'regular')) {
      this.need(leading);
      this.pdf.text(options.x ?? MARGIN, this.y, line, {
        font: options.font,
        size,
        colour: options.colour ?? BODY,
      });
      this.move(leading);
    }
  }
}

/**
 * THE COMPANY'S OWN LETTERHEAD, ACROSS THE TOP OF A NEW DOCUMENT. LETTERHEAD-1
 * (15 November 2026).
 *
 * The owner: every newly generated document carries the official letterhead of
 * the company it is from — the image the office uploaded in Administration, as
 * it was supplied (logo, name, registration, VAT, addresses, telephone, fax,
 * email, PO Box). Nothing on it is drawn by us, so nothing on it can be wrong
 * in a way the office did not put there.
 *
 * ONE DRAWING, EVERY DOCUMENT. Each renderer hands its own fixed header box —
 * the band its text header uses today, plus the top margin — and this fits the
 * image into it: its own proportions kept (never stretched, never cropped),
 * against the left edge, centred top to bottom. No cursor moves: everything
 * below the header is exactly where it always was.
 *
 * NO LETTERHEAD, NO CHANGE. Returns false without drawing anything, and the
 * caller draws its text header exactly as it did before letterheads existed —
 * which is how every document of a company whose letterhead has not been
 * supplied must look, operation for operation.
 */
export interface LetterheadBox {
  /** Bottom-left corner, in PDF points from the page's bottom-left. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * How high a letterhead may reach: 14pt (5mm) below the paper's top edge,
 * inside what an office printer can print.
 */
export const LETTERHEAD_TOP = A4_HEIGHT - 14;

/** Where the image lands inside the box, its proportions kept. */
export const fitLetterhead = (image: PdfImage, box: LetterheadBox): LetterheadBox => {
  const natural = displaySize(image);
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  const width = natural.width * scale;
  const height = natural.height * scale;
  return { x: box.x, y: box.y + (box.height - height) / 2, width, height };
};

/** The box in the y-DOWN space the master layout is described in (the page measured from its top). */
const areaOf = (box: LetterheadBox): LetterheadArea => ({
  left: box.x,
  top: A4_HEIGHT - (box.y + box.height),
  width: box.width,
  height: box.height,
});

/**
 * Each glyph of the master letterhead as a form, built once per process and shared by every
 * document — so a document writes each distinct glyph once, however often its lines use it.
 */
const GLYPH_FORMS = new Map<string, PdfForm>();
const glyphForm = (key: string, path: string): PdfForm => {
  let form = GLYPH_FORMS.get(key);
  if (form === undefined) {
    const commands = parseSvgPath(path);
    const bounds = pathBounds(commands) ?? { left: 0, bottom: 0, right: 0, top: 0 };
    // Font units are whole numbers; a curve's raised control points are rounded back to them.
    const content = `${pathOperators(commands, (value) => String(Math.round(value)))} f`;
    form = { bbox: [bounds.left, bounds.bottom, bounds.right, bounds.top], content };
    GLYPH_FORMS.set(key, form);
  }
  return form;
};

/**
 * THE EJE MASTER LETTERHEAD, DRAWN INTO A BOX. LETTERHEAD-2 (15 November 2026), LETTERHEAD-4.
 *
 * The owner: the official letterhead recreated as a header — crisp vector artwork and a clean
 * logo, not a pasted image — the same on every EJE document and on the screen. So this draws
 * `layoutLetterhead` (lib/branding/eje-letterhead.ts), the one description both renderers
 * use: every line as its glyph outlines in the paper's own faces (Verdana Bold Italic, Georgia
 * Bold, Georgia Bold Italic — each glyph a form, written once), filled in the letterhead's
 * ink; each line ALSO as invisible text (render mode 3) over it, so the document is searched
 * and copied exactly as before; and the EJE mark as its traced outline, filled even-odd.
 * Fitted exactly as an uploaded image is: uniformly, against the box's left edge, centred top
 * to bottom. Nothing outside the box moves.
 */
export const drawEjeLetterhead = (pdf: PdfBuilder, box: LetterheadBox): void => {
  const placed = layoutLetterhead(areaOf(box));
  const mark = placed.mark;
  pdf.fillPolygons(
    placed.markPolygons,
    { x: mark.left, y: A4_HEIGHT - (mark.top + mark.height), width: mark.width, height: mark.height },
    LETTERHEAD_INK,
  );
  for (const line of placed.lines) {
    const [a, , , d, e, f] = letterheadLineMatrix(line);
    // The layout's y runs down the page; PDF's runs up — so the glyphs' own y-up units map with +|d|.
    pdf.drawForms(
      letterheadLineGlyphs(line).map((glyph) => ({ form: glyphForm(glyph.key, glyph.path), x: glyph.pen })),
      [a, 0, 0, -d, e, A4_HEIGHT - f],
      line.ink,
    );
    pdf.invisibleText(e, A4_HEIGHT - f, letterheadLineText(line), { size: line.runs[0]?.size ?? 0, width: line.width });
  }
};

/**
 * Draws the document's letterhead into its header box — the EJE master header
 * (LETTERHEAD-2), or a company's uploaded image (LETTERHEAD-1) — and says whether
 * it drew one.
 */
export const drawLetterhead = (
  pdf: PdfBuilder,
  letterhead: DocumentLetterhead | undefined,
  box: LetterheadBox,
): boolean => {
  if (letterhead === undefined || box.width <= 0 || box.height <= 0) return false;
  if (isMasterLetterhead(letterhead)) {
    drawEjeLetterhead(pdf, box);
    return true;
  }
  const fitted = fitLetterhead(letterhead, box);
  pdf.image(letterhead, fitted.x, fitted.y, fitted.width, fitted.height);
  return true;
};

/**
 * THE JOB CARD'S AND THE ADDENDUM'S HEADER WITH A LETTERHEAD: the image above,
 * and the document's name and number on ONE line, right-aligned, just above the
 * rule that closes the header — so somebody filing paper still reads "JOB CARD
 * EJE-1044" in the corner, and the letterhead has the band to itself.
 *
 * `ruleY` is where that rule is drawn today; the caller still draws it, and
 * moves its cursor exactly as before.
 */
export const drawLetterheadOverTitle = (
  pdf: PdfBuilder,
  letterhead: DocumentLetterhead,
  ruleY: number,
  title: string,
  number: string,
): void => {
  const baseline = ruleY + 6;
  const numberWidth = textWidth(number, SIZE.jobNumber, 'bold');
  pdf.text(RIGHT - numberWidth, baseline, number, { font: 'bold', size: SIZE.jobNumber, colour: INK });
  pdf.text(
    RIGHT - numberWidth - 8 - textWidth(title, SIZE.small, 'bold', TRACK_TITLE),
    baseline,
    title,
    { font: 'bold', size: SIZE.small, colour: MUTED, tracking: TRACK_TITLE },
  );
  // Clear of the number's capitals (about 0.72 of its size) by a few points.
  const bottom = baseline + SIZE.jobNumber * 0.72 + 4;
  drawLetterhead(pdf, letterhead, { x: MARGIN, y: bottom, width: CONTENT_WIDTH, height: LETTERHEAD_TOP - bottom });
};
