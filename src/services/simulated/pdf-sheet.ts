import { A4_HEIGHT, A4_WIDTH, PdfBuilder, textWidth, type PdfFont, type PdfForm } from '@/lib/pdf/writer';
import { displaySize, type PdfImage } from '@/lib/pdf/image';
import { parseSvgPath, pathBounds, pathOperators } from '@/lib/pdf/path';
import {
  LETTERHEAD_INK,
  LETTERHEAD_REFERENCE,
  fullWidthHeaderGeometry,
  type FullWidthHeaderStyle,
  isMasterLetterhead,
  layoutLetterhead,
  letterheadLineGlyphs,
  letterheadLineMatrix,
  letterheadLineText,
  type DocumentLetterhead,
  type LetterheadArea,
  type LetterheadLine,
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
/**
 * JOB-CARD-6: the room a GENUINE job card or Parts Collection Note (edition 10 on) keeps above its
 * footer — 8pt clear of the footer rule at MARGIN + 26. FOOTER_SPACE's further 10pt is the height of
 * the demonstration stamp's band, which only a demonstration document draws.
 */
export const GENUINE_FOOTER_SPACE = 34;

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

  /** `footerSpace`: the room kept clear above the bottom margin for the footer (FOOTER_SPACE unless a renderer says otherwise). */
  constructor(private readonly footerSpace: number = FOOTER_SPACE) {
    this.break();
  }

  private break(): void {
    this.pdf.addPage();
    this.y = A4_HEIGHT - MARGIN;
  }

  /**
   * Starts a new page now, unless nothing has been drawn on this one yet. JOB-CARD-2: the
   * photographs always begin on a page of their own.
   */
  newPage(): void {
    if (this.y < A4_HEIGHT - MARGIN) this.break();
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
    return this.y - height < MARGIN + this.footerSpace;
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
export const drawEjeLetterhead = (pdf: PdfBuilder, box: LetterheadBox, lines?: readonly LetterheadLine[]): void => {
  const placed = layoutLetterhead(areaOf(box), lines === undefined ? {} : { lines });
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
 * THE JOB CARD'S HEADER ON THE EJE LETTERHEAD, ACROSS THE FULL PAGE. JOB-CARD-3 (the owner,
 * 17 November 2026).
 *
 * The header was the letterhead fitted into the 60pt band above the old rule — about 300pt of the
 * page's 515pt, its address and telephone lines under 5pt: squeezed, and too small to read. Now it is
 * the whole printable width (CONTENT_WIDTH, 515pt, so 103pt tall — scaled uniformly, never stretched):
 * the company name about 20pt, the address, cell, telephone, fax and email lines about 8pt, Reg and
 * VAT about 7pt. The document's name and number stand in the letterhead's own empty top-right corner
 * (`LETTERHEAD_TITLE_SLOT`): the label letter-spaced at 7.5pt, the number 12pt bold. Returns the y of
 * the rule that closes the header, a few points under the letterhead's lowest ink.
 */
export const LETTERHEAD_FULL_HEIGHT = (CONTENT_WIDTH * LETTERHEAD_REFERENCE.height) / LETTERHEAD_REFERENCE.width;

/**
 * JOB-CARD-4/-5: `style` is the header's edition (`fullWidthHeaderGeometry`): 7 to the byte as v1.16.0
 * drew it; 8 to the byte as v1.16.1 drew it; 9 the P.O. Box block moved down whole and the name and
 * number on one line.
 */
export const drawFullWidthLetterhead = (pdf: PdfBuilder, title: string, number: string, style: FullWidthHeaderStyle = 7): number => {
  const top = LETTERHEAD_TOP;
  const scale = CONTENT_WIDTH / LETTERHEAD_REFERENCE.width;
  const geometry = fullWidthHeaderGeometry(style);
  drawEjeLetterhead(
    pdf,
    { x: MARGIN, y: top - LETTERHEAD_FULL_HEIGHT, width: CONTENT_WIDTH, height: LETTERHEAD_FULL_HEIGHT },
    style === 7 ? undefined : geometry.lines,
  );
  const slot = geometry.slot;
  const right = MARGIN + slot.right * scale;
  const labelSize = slot.labelSize * scale;
  const tracking = slot.labelTracking * scale;
  const numberSize = slot.numberSize * scale;
  /*
   * One line: the number ends at the right edge as always, and the label ends `gap` before the number
   * begins — measured, like every layout here, with the substitution allowance, so the two never touch
   * even in a viewer whose substitute face sets wider.
   */
  const labelRight = slot.inline === true ? right - textWidth(number, numberSize, 'bold') - (slot.gap ?? 0) * scale : right;
  const labelLeft = labelRight - textWidth(title, labelSize, 'bold', tracking);
  pdf.text(labelLeft, top - slot.labelBaseline * scale, title, {
    font: 'bold',
    size: labelSize,
    colour: MUTED,
    tracking,
  });
  pdf.text(right - textWidth(number, numberSize, 'bold'), top - slot.numberBaseline * scale, number, {
    font: 'bold',
    size: numberSize,
    colour: INK,
  });
  return top - LETTERHEAD_FULL_HEIGHT - 5;
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
