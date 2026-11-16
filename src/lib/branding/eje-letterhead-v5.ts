/*
 * FROZEN — JOB-CARD-2 / LETTERHEAD-4 (16 November 2026). The EJE master letterhead EXACTLY as v1.13.0
 * and v1.14.0 drew it (base-14 Helvetica-BoldOblique / Times-Bold / Times-BoldItalic text and the traced
 * mark), kept so a document ISSUED with it (renderer 5) is shown and previewed with the artwork it was
 * issued with. New documents use eje-letterhead.ts (the paper's own typefaces). Do not change it.
 */
import type { PdfFont } from '@/lib/pdf/writer';
import { charWidth } from '@/lib/pdf/metrics';
import { EJE_MARK_ASPECT, EJE_MARK_POLYGONS } from './eje-letterhead-mark';

/**
 * THE EJE MASTER LETTERHEAD, AS DATA. LETTERHEAD-2 (15 November 2026).
 *
 * The owner: the official EJE letterhead recreated as a proper, reusable header — crisp
 * vector text and a clean logo, not a pasted image — ONE master header for every EJE
 * document, identical in the in-app preview, the generated PDF and the printed PDF.
 *
 * So the header is described ONCE, here, and both renderers draw from it: the PDF
 * (`drawEjeLetterhead` in services/simulated/pdf-sheet.ts) and the screen (`EjeLetterhead`
 * in components/documents). Neither has a position of its own.
 *
 * WHERE THE NUMBERS COME FROM: the approved digital recreation of the owner's photographed
 * letterhead ("EJE Letterhead - digital v3.png", 3300 × 660), whose generator placed every
 * line at the photo's own centre and baseline. The wording is the official paper's,
 * character for character — the double spaces and the en dashes included. Nothing is
 * invented, rewritten or left out.
 *
 * Coordinates are in that reference space: x to the right, y DOWNWARDS from the top edge,
 * baselines for text, a text line's x is its CENTRE.
 */

export const LETTERHEAD_REFERENCE_V5 = { width: 3300, height: 660 } as const;

/** The letterhead's ink: dark grey on white, as the paper. */
export const LETTERHEAD_INK_V5 = '#333333';

/**
 * The three faces of the paper: a bold italic sans for the name block, a bold serif for the
 * address and contact columns, a bold italic serif for the PO Box.
 */
export type LetterheadFontRoleV5 = 'sansBoldItalic' | 'serifBold' | 'serifBoldItalic';

/** One run of a line: most lines are one; the name's "cc" is set smaller. */
export interface LetterheadRunV5 {
  readonly text: string;
  readonly size: number;
}

export interface LetterheadLineV5 {
  readonly role: LetterheadFontRoleV5;
  /** Every line of the paper is centred on its x. */
  readonly anchor: 'middle';
  readonly x: number;
  readonly baseline: number;
  readonly runs: readonly LetterheadRunV5[];
  readonly ink: string;
}

/** The EJE mark's box (its proportions are the traced mark's own). */
export const LETTERHEAD_MARK_BOX_V5 = {
  x: 16,
  y: 215,
  height: 420,
  width: 420 * EJE_MARK_ASPECT,
} as const;

const line = (role: LetterheadFontRoleV5, x: number, baseline: number, ...runs: LetterheadRunV5[]): LetterheadLineV5 => ({
  role,
  anchor: 'middle',
  x,
  baseline,
  runs,
  ink: LETTERHEAD_INK_V5,
});
const run = (text: string, size: number): LetterheadRunV5 => ({ text, size });

/** v3's baselines were placed on the photo; its top margin of 110 px is trimmed here. */
const DY = -110;

export const LETTERHEAD_LINES_V5: readonly LetterheadLineV5[] = [
  // The name block, centred above.
  line('sansBoldItalic', 1772, 197 + DY, run('Reg: CK1987/020035/23', 44)),
  line('sansBoldItalic', 1895, 333 + DY, run('EJE Industrial Electronics ', 118), run('cc', 96)),
  line('sansBoldItalic', 1772, 402 + DY, run('VAT NO: 4950134991', 44)),
  // The address column.
  line('serifBold', 1032, 478 + DY, run('Bonfoi Office Park', 50)),
  line('serifBold', 1032, 535 + DY, run('c/oTempelhof South  Rd', 50)),
  line('serifBold', 1032, 592 + DY, run('and Atlas Rd', 50)),
  line('serifBold', 1032, 649 + DY, run('Bonaero Park', 50)),
  line('serifBold', 1032, 708 + DY, run('Kempton Park, 1619', 50)),
  // The contact column.
  line('serifBold', 1942, 478 + DY, run('Cell:  083 443 7736 – Peet Buitendag', 50)),
  line('serifBold', 1942, 539 + DY, run('Cell: 082 330 3404 – Dawie Malan', 50)),
  line('serifBold', 1942, 600 + DY, run('Tel: 083 285 1644/011 979 5080', 50)),
  line('serifBold', 1942, 659 + DY, run('Fax: 086 529 0073', 50)),
  line('serifBold', 1942, 718 + DY, run('Email: sales@ejeie.co.za or peetb@ejeie.co.za', 50)),
  // The PO Box, at the right.
  line('serifBoldItalic', 2974, 424 + DY, run('P.O. Box 16282', 50)),
  line('serifBoldItalic', 2974, 486 + DY, run('Atlasville', 50)),
  line('serifBoldItalic', 2974, 553 + DY, run('1465', 50)),
];

/** The full text of a line, as a reader reads it. */
export const letterheadLineTextV5 = (value: LetterheadLineV5): string => value.runs.map((part) => part.text).join('');

/** The PDF's face for each of the paper's (base-14: Helvetica-BoldOblique, Times-Bold, Times-BoldItalic). */
export const LETTERHEAD_PDF_FONT_V5: Record<LetterheadFontRoleV5, PdfFont> = {
  sansBoldItalic: 'boldItalic',
  serifBold: 'serifBold',
  serifBoldItalic: 'serifBoldItalic',
};

/**
 * A line's width as the PDF's font metrics give it, in the line's own units — what a PDF viewer
 * advances, WITHOUT the substitution allowance `textWidth` adds for layout. LETTERHEAD-2: the PDF
 * centres each line by it, and the screen sets each line to exactly it (`textLength`), so a line
 * is the same length on every device whatever fonts that device has.
 */
export const letterheadLineWidthV5 = (value: LetterheadLineV5): number => {
  const font = LETTERHEAD_PDF_FONT_V5[value.role];
  return value.runs.reduce((sum, part) => {
    let thousandths = 0;
    for (const character of part.text) thousandths += charWidth(character, font);
    return sum + (thousandths / 1000) * part.size;
  }, 0);
};

/** A box in a y-DOWN space (the screen's, or a PDF page measured from its top). */
export interface LetterheadAreaV5 {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A line placed in a box: the same shape, in the box's units. */
export type PlacedLetterheadLineV5 = LetterheadLineV5;

export interface PlacedLetterheadV5 {
  /** Reference units to the box's units. */
  readonly scale: number;
  /** Where the whole header lands. */
  readonly area: LetterheadAreaV5;
  readonly mark: LetterheadAreaV5;
  /** The mark's outlines, normalised 0..1 across `mark` (y downwards); fill even-odd. */
  readonly markPolygons: readonly (readonly number[])[];
  readonly lines: readonly PlacedLetterheadLineV5[];
}

/**
 * The master header placed in a box: scaled UNIFORMLY (never stretched) by the tighter of
 * the box's width and height, centred top to bottom, and against the box's left edge or
 * centred across it as the caller asks. Returns absolute positions in the box's units.
 *
 * Pure — the single source both the PDF and the screen draw from.
 */
export const layoutLetterheadV5 = (
  box: LetterheadAreaV5,
  options: { readonly align?: 'left' | 'centre' } = {},
): PlacedLetterheadV5 => {
  const scale = Math.max(
    0,
    Math.min(box.width / LETTERHEAD_REFERENCE_V5.width, box.height / LETTERHEAD_REFERENCE_V5.height),
  );
  const width = LETTERHEAD_REFERENCE_V5.width * scale;
  const height = LETTERHEAD_REFERENCE_V5.height * scale;
  const left = options.align === 'centre' ? box.left + (box.width - width) / 2 : box.left;
  const top = box.top + (box.height - height) / 2;
  return {
    scale,
    area: { left, top, width, height },
    mark: {
      left: left + LETTERHEAD_MARK_BOX_V5.x * scale,
      top: top + LETTERHEAD_MARK_BOX_V5.y * scale,
      width: LETTERHEAD_MARK_BOX_V5.width * scale,
      height: LETTERHEAD_MARK_BOX_V5.height * scale,
    },
    markPolygons: EJE_MARK_POLYGONS,
    lines: LETTERHEAD_LINES_V5.map((value) => ({
      ...value,
      x: left + value.x * scale,
      baseline: top + value.baseline * scale,
      runs: value.runs.map((part) => ({ text: part.text, size: part.size * scale })),
    })),
  };
};

/** The mark's outlines as an SVG path `d`, in the mark box's units (for an even-odd fill). */
export const markPathDataV5 = (mark: LetterheadAreaV5, polygons: readonly (readonly number[])[] = EJE_MARK_POLYGONS): string =>
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
