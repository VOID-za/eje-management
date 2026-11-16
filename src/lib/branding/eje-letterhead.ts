import { DEFAULT_COMPANY_ID } from '@/domain/types/company';
import type { PdfImage } from '@/lib/pdf/image';
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

export const LETTERHEAD_REFERENCE = { width: 3300, height: 660 } as const;

/** The letterhead's ink: dark grey on white, as the paper. */
export const LETTERHEAD_INK = '#333333';

/**
 * The three faces of the paper: a bold italic sans for the name block, a bold serif for the
 * address and contact columns, a bold italic serif for the PO Box.
 */
export type LetterheadFontRole = 'sansBoldItalic' | 'serifBold' | 'serifBoldItalic';

/** One run of a line: most lines are one; the name's "cc" is set smaller. */
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
}

/** The EJE mark's box (its proportions are the traced mark's own). */
export const LETTERHEAD_MARK_BOX = {
  x: 16,
  y: 215,
  height: 420,
  width: 420 * EJE_MARK_ASPECT,
} as const;

const line = (role: LetterheadFontRole, x: number, baseline: number, ...runs: LetterheadRun[]): LetterheadLine => ({
  role,
  anchor: 'middle',
  x,
  baseline,
  runs,
  ink: LETTERHEAD_INK,
});
const run = (text: string, size: number): LetterheadRun => ({ text, size });

/** v3's baselines were placed on the photo; its top margin of 110 px is trimmed here. */
const DY = -110;

export const LETTERHEAD_LINES: readonly LetterheadLine[] = [
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
export const letterheadLineText = (value: LetterheadLine): string => value.runs.map((part) => part.text).join('');

/** The PDF's face for each of the paper's (base-14: Helvetica-BoldOblique, Times-Bold, Times-BoldItalic). */
export const LETTERHEAD_PDF_FONT: Record<LetterheadFontRole, PdfFont> = {
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
export const letterheadLineWidth = (value: LetterheadLine): number => {
  const font = LETTERHEAD_PDF_FONT[value.role];
  return value.runs.reduce((sum, part) => {
    let thousandths = 0;
    for (const character of part.text) thousandths += charWidth(character, font);
    return sum + (thousandths / 1000) * part.size;
  }, 0);
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
      runs: value.runs.map((part) => ({ text: part.text, size: part.size * scale })),
    })),
  };
};

/**
 * WHERE THE LETTERHEAD'S INK IS, in the reference space: the mark and every line (from a little
 * above its capitals to below its descenders), with no paper margin around it. LETTERHEAD-3: a
 * form's header fits THIS, not the whole reference sheet — the sheet's empty right-hand margin
 * and top and bottom edges otherwise cost the header a sixth of its size.
 */
export const LETTERHEAD_INK_BOUNDS: LetterheadArea = (() => {
  let left: number = LETTERHEAD_MARK_BOX.x;
  let top: number = LETTERHEAD_MARK_BOX.y;
  let right: number = LETTERHEAD_MARK_BOX.x + LETTERHEAD_MARK_BOX.width;
  let bottom: number = LETTERHEAD_MARK_BOX.y + LETTERHEAD_MARK_BOX.height;
  for (const value of LETTERHEAD_LINES) {
    const half = letterheadLineWidth(value) / 2;
    const size = Math.max(...value.runs.map((part) => part.size));
    left = Math.min(left, value.x - half);
    right = Math.max(right, value.x + half);
    top = Math.min(top, value.baseline - size * 0.76);
    bottom = Math.max(bottom, value.baseline + size * 0.24);
  }
  return { left, top, width: right - left, height: bottom - top };
})();

/** The ink's width ÷ height: a box this shape holds the letterhead with nothing to spare. */
export const LETTERHEAD_INK_ASPECT = LETTERHEAD_INK_BOUNDS.width / LETTERHEAD_INK_BOUNDS.height;

/**
 * The master header placed so its INK fills the box: scaled uniformly by the tighter of the box's
 * width and height, against the box's left edge, centred top to bottom. The same lines, mark and
 * proportions as `layoutLetterhead` — only the paper margin around them is not reserved.
 */
export const layoutLetterheadInk = (box: LetterheadArea): PlacedLetterhead => {
  const ink = LETTERHEAD_INK_BOUNDS;
  const scale = Math.max(0, Math.min(box.width / ink.width, box.height / ink.height));
  const top = box.top + (box.height - ink.height * scale) / 2;
  return layoutLetterhead({
    left: box.left - ink.left * scale,
    top: top - ink.top * scale,
    width: LETTERHEAD_REFERENCE.width * scale,
    height: LETTERHEAD_REFERENCE.height * scale,
  });
};

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
 * preview of what will be), or when what was issued was drawn with it.
 */
export const showsMasterLetterhead = (finalDocument: { readonly renderer: number | null } | null): boolean =>
  finalDocument === null || finalDocument.renderer === MASTER_LETTERHEAD_RENDERER;
