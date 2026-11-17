import { DEFAULT_COMPANY_ID } from '@/domain/types/company';
import type { PdfImage } from '@/lib/pdf/image';
import { EJE_MARK_ASPECT, EJE_MARK_POLYGONS } from './eje-letterhead-mark';
import {
  LETTERHEAD_GLYPH_LINES,
  LETTERHEAD_GLYPH_REFERENCE,
  LETTERHEAD_GLYPHS,
  LETTERHEAD_MARK_PLACEMENT,
  LETTERHEAD_UNITS_PER_EM,
  type LetterheadGlyphFace,
} from './eje-letterhead-glyphs';

/**
 * THE EJE MASTER LETTERHEAD, AS DATA. LETTERHEAD-2 (15 November 2026), LETTERHEAD-4 (16 November).
 *
 * The owner: the official EJE letterhead recreated as a proper, reusable header — crisp
 * vector artwork and a clean logo, not a pasted image — ONE master header for every EJE
 * document, identical in the in-app preview, the generated PDF and the printed PDF.
 *
 * So the header is described ONCE, here, and both renderers draw from it: the PDF
 * (`drawEjeLetterhead` in services/simulated/pdf-sheet.ts) and the screen (`EjeLetterhead`
 * in components/documents). Neither has a position of its own.
 *
 * THE PAPER'S OWN TYPEFACES (LETTERHEAD-4): the name, "Reg:" and "VAT NO:" in Verdana Bold
 * Italic; the address and contact columns and "Atlasville" in Georgia Bold (with its old-style
 * figures); "P.O. Box 16282" and "1465" in Georgia Bold Italic. Those faces are neither PDF
 * base-14 fonts nor on every device, so every line is drawn from its glyph OUTLINES
 * (eje-letterhead-glyphs.ts, generated from the fonts by scripts/generate-eje-letterhead-text.mjs)
 * — the same shapes in the PDF and on screen, whatever fonts the device has. The PDF also
 * carries each line as invisible text, so it can still be searched and copied.
 *
 * WHERE THE NUMBERS COME FROM: each line fitted onto the owner's photograph of the official
 * paper, outline to ink (the generator says how). The wording is the official paper's,
 * character for character — the double spaces and the en dashes included. Nothing is
 * invented, rewritten or left out.
 *
 * Coordinates are in that reference space: x to the right, y DOWNWARDS from the top edge,
 * baselines for text, a text line's x is the CENTRE of its advance.
 */

export const LETTERHEAD_REFERENCE = LETTERHEAD_GLYPH_REFERENCE;

/** The letterhead's ink: dark grey on white, as the paper. */
export const LETTERHEAD_INK = '#333333';

/** The three faces of the paper: Verdana Bold Italic, Georgia Bold, Georgia Bold Italic. */
export type LetterheadFontRole = LetterheadGlyphFace;

/** A line's text and its em size. */
export interface LetterheadRun {
  readonly text: string;
  readonly size: number;
}

export interface LetterheadLine {
  readonly role: LetterheadFontRole;
  /** Every line of the paper is centred on its x. */
  readonly anchor: 'middle';
  readonly x: number;
  readonly baseline: number;
  readonly runs: readonly LetterheadRun[];
  readonly ink: string;
  /** Horizontal scale: the paper sets its glyphs this much narrower than the face's own. */
  readonly hscale: number;
  /** The line's advance — what it spans, centred on x. */
  readonly width: number;
  /** Each character's pen position along the line, in font units from its start. */
  readonly pens: readonly number[];
}

/** The EJE mark's box (its proportions are the traced mark's own). */
export const LETTERHEAD_MARK_BOX = {
  x: LETTERHEAD_MARK_PLACEMENT.x,
  y: LETTERHEAD_MARK_PLACEMENT.y,
  height: LETTERHEAD_MARK_PLACEMENT.height,
  width: LETTERHEAD_MARK_PLACEMENT.height * EJE_MARK_ASPECT,
} as const;

export const LETTERHEAD_LINES: readonly LetterheadLine[] = LETTERHEAD_GLYPH_LINES.map((line) => ({
  role: line.role,
  anchor: 'middle',
  x: line.x,
  baseline: line.baseline,
  runs: [{ text: line.text, size: line.size }],
  ink: LETTERHEAD_INK,
  hscale: line.hscale,
  width: line.width,
  pens: line.pens,
}));

/** The full text of a line, as a reader reads it. */
export const letterheadLineText = (value: LetterheadLine): string => value.runs.map((part) => part.text).join('');

/** A line's advance, in the line's own units: the span both renderers centre on its x. */
export const letterheadLineWidth = (value: LetterheadLine): number => value.width;

export { LETTERHEAD_UNITS_PER_EM };

/** One glyph of a line: which outline (font units, y UP) and where its pen stands. */
export interface LetterheadLineGlyph {
  /** Stable within the letterhead: the face and the character. */
  readonly key: string;
  readonly path: string;
  readonly pen: number;
}

/** A line's visible glyphs (a space draws nothing), in order. */
export const letterheadLineGlyphs = (value: LetterheadLine): readonly LetterheadLineGlyph[] => {
  const glyphs: LetterheadLineGlyph[] = [];
  [...letterheadLineText(value)].forEach((character, index) => {
    const glyph = LETTERHEAD_GLYPHS[value.role][character];
    if (glyph === undefined) throw new Error(`The letterhead has no ${value.role} outline for "${character}"`);
    if (glyph.path.length === 0) return;
    glyphs.push({ key: `${value.role}:${character}`, path: glyph.path, pen: value.pens[index] ?? 0 });
  });
  return glyphs;
};

/**
 * Where a line's glyph outlines go: the matrix a b c d e f that takes font units (y UP, the
 * line's start at 0) to the line's own space (y DOWN) — a = em × hscale ÷ units, d = −em ÷ units,
 * (e, f) the start of the line's advance on its baseline. Both renderers place every glyph by it.
 */
export const letterheadLineMatrix = (value: LetterheadLine): readonly [number, number, number, number, number, number] => {
  const size = value.runs[0]?.size ?? 0;
  return [
    (size * value.hscale) / LETTERHEAD_UNITS_PER_EM,
    0,
    0,
    -size / LETTERHEAD_UNITS_PER_EM,
    value.x - value.width / 2,
    value.baseline,
  ];
};

/** A box in a y-DOWN space (the screen's, or a PDF page measured from its top). */
export interface LetterheadArea {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A line placed in a box: the same shape, in the box's units. */
export type PlacedLetterheadLine = LetterheadLine;

export interface PlacedLetterhead {
  /** Reference units to the box's units. */
  readonly scale: number;
  /** Where the whole header lands. */
  readonly area: LetterheadArea;
  readonly mark: LetterheadArea;
  /** The mark's outlines, normalised 0..1 across `mark` (y downwards); fill even-odd. */
  readonly markPolygons: readonly (readonly number[])[];
  readonly lines: readonly PlacedLetterheadLine[];
}

/**
 * The master header placed in a box: scaled UNIFORMLY (never stretched) by the tighter of
 * the box's width and height, centred top to bottom, and against the box's left edge or
 * centred across it as the caller asks. Returns absolute positions in the box's units.
 *
 * Pure — the single source both the PDF and the screen draw from.
 */
export const layoutLetterhead = (
  box: LetterheadArea,
  options: { readonly align?: 'left' | 'centre' } = {},
): PlacedLetterhead => {
  const scale = Math.max(
    0,
    Math.min(box.width / LETTERHEAD_REFERENCE.width, box.height / LETTERHEAD_REFERENCE.height),
  );
  const width = LETTERHEAD_REFERENCE.width * scale;
  const height = LETTERHEAD_REFERENCE.height * scale;
  const left = options.align === 'centre' ? box.left + (box.width - width) / 2 : box.left;
  const top = box.top + (box.height - height) / 2;
  return {
    scale,
    area: { left, top, width, height },
    mark: {
      left: left + LETTERHEAD_MARK_BOX.x * scale,
      top: top + LETTERHEAD_MARK_BOX.y * scale,
      width: LETTERHEAD_MARK_BOX.width * scale,
      height: LETTERHEAD_MARK_BOX.height * scale,
    },
    markPolygons: EJE_MARK_POLYGONS,
    lines: LETTERHEAD_LINES.map((value) => ({
      ...value,
      x: left + value.x * scale,
      baseline: top + value.baseline * scale,
      width: value.width * scale,
      runs: value.runs.map((part) => ({ text: part.text, size: part.size * scale })),
    })),
  };
};

/**
 * THE DOCUMENT'S NAME AND NUMBER, IN THE LETTERHEAD'S TOP-RIGHT CORNER. JOB-CARD-3 (the owner,
 * 17 November 2026).
 *
 * With the letterhead across the page's full width, the paper's own top-right corner — above the
 * P.O. Box block and to the right of the company name — is empty, and that is where the document says
 * what it is: "JOB CARD" (or "PARTS COLLECTION NOTE") on one line, its number under it, both against
 * the right edge. In the letterhead's reference units (3300 x 660, y down), so the PDF and the screen
 * place them from the same numbers and they scale with the artwork:
 *
 *   - the label: about 7.5pt on the page, letter-spaced, its baseline level with the top of the "Reg:"
 *     line and clear of the company name below it;
 *   - the number: about 12pt bold — restrained beside the 20pt company name — its baseline above the
 *     P.O. Box block's first line by more than a line's height.
 *
 * `letterhead-title.test.ts` holds every document title clear of every line of the letterhead.
 */
export const LETTERHEAD_TITLE_SLOT = {
  /** Both lines end here: the letterhead's right edge. */
  right: LETTERHEAD_REFERENCE.width,
  labelBaseline: 52,
  labelSize: 48,
  /** Extra space after each character of the label (TRACK_TITLE at the label's size, x 1/scale). */
  labelTracking: 8.65,
  numberBaseline: 162,
  numberSize: 77,
} as const;

/** The mark's outlines as an SVG path `d`, in the mark box's units (for an even-odd fill). */
export const markPathData = (mark: LetterheadArea, polygons: readonly (readonly number[])[] = EJE_MARK_POLYGONS): string =>
  polygons
    .map((polygon) => {
      const points: string[] = [];
      for (let index = 0; index + 1 < polygon.length; index += 2) {
        const x = mark.left + polygon[index]! * mark.width;
        const y = mark.top + polygon[index + 1]! * mark.height;
        points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
      }
      return `M${points.join('L')}Z`;
    })
    .join('');

/**
 * WHICH HEADER A DOCUMENT CARRIES. LETTERHEAD-2.
 *
 * EJE's documents carry the master header above — never an uploaded image of it, and no
 * longer the text header. Any other company keeps exactly what LETTERHEAD-1 gave it: its
 * uploaded letterhead image when it has one, otherwise (undefined) its text header.
 *
 * The master header is a marker, not data: everything it draws is in this module.
 */
export interface MasterLetterhead {
  readonly kind: 'eje-master-letterhead';
}

export const EJE_MASTER_LETTERHEAD: MasterLetterhead = Object.freeze({ kind: 'eje-master-letterhead' });

/** What a renderer is handed: the master header, a company's uploaded image, or nothing. */
export type DocumentLetterhead = MasterLetterhead | PdfImage;

export const isMasterLetterhead = (value: DocumentLetterhead | undefined): value is MasterLetterhead =>
  value !== undefined && 'kind' in value && value.kind === 'eje-master-letterhead';

/** EJE — the default company — is the company whose documents carry the master header. */
export const carriesMasterLetterhead = (companyId: string | null | undefined): boolean =>
  companyId === DEFAULT_COMPANY_ID;

/**
 * WHICH ISSUED DOCUMENTS CARRY THE MASTER HEADER. LETTERHEAD-2.
 *
 * An issued document is never re-rendered, so an EJE job issued before the master letterhead
 * (or backfilled, which is drawn with no letterhead at all) keeps the text header in its stored
 * PDF — and the screen beside it must show that same header, not the master.
 *
 * So an issue drawn with the master letterhead records this renderer number on its stored file
 * and on the job's record. It is a marker, not a new renderer: nothing is re-rendered for it,
 * RENDERER_VERSION (the backfill's comparison) is unchanged, and no stored row is migrated. 5 is
 * above every number recorded before it (job card 1–4, delivery note 1), so no earlier issue
 * can carry it.
 */
export const MASTER_LETTERHEAD_RENDERER = 5;

/**
 * Whether a job's document on screen shows the master header: while nothing is issued (it is a
 * preview of what will be), or when what was issued was drawn with it: renderer 5, or any later one —
 * JOB-CARD-2 records 6 on every job card issued since, all of them on the master letterhead (the
 * independent review: a Delivery Note beside a renderer-6 job card showed the text header).
 */
export const showsMasterLetterhead = (finalDocument: { readonly renderer: number | null } | null): boolean =>
  finalDocument === null || (finalDocument.renderer !== null && finalDocument.renderer >= MASTER_LETTERHEAD_RENDERER);
