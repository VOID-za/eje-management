import type { PdfFont } from './writer';

/**
 * Character advance widths for the base-14 fonts, in 1/1000 em.
 *
 * From the standard AFM metrics for Helvetica, Helvetica-Bold and Times-Italic.
 * Estimating these was a real bug: an approximation that ran about 20% narrow
 * told the line-wrapper a line fitted when it did not, so the customer's
 * contact details and the acceptance declaration overran their columns and were
 * painted over by the panel beside them.
 *
 * A viewer lays text out with exactly these numbers, so measuring with them is
 * the only way a wrap decision can be correct.
 *
 * Helvetica-BoldOblique (`boldItalic`) carries Helvetica-Bold's widths. Times-Bold
 * and Times-BoldItalic (`serifBold`, `serifBoldItalic` — the master letterhead's
 * serif, LETTERHEAD-2) are GENERATED below by scripts/generate-times-metrics.mjs
 * from Times New Roman Bold and Bold Italic (C:\Windows\Fonts\timesbd.ttf and
 * timesbi.ttf), the metric-compatible stand-in for base-14 Times: each WinAnsi
 * character's advance read from the font's cmap (format 4) and hmtx, scaled to
 * 1000 units per em.
 */

const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

const TIMES_ITALIC = [
  250, 333, 420, 500, 500, 833, 778, 214, 333, 333, 500, 675, 250, 333, 250, 278, 500, 500, 500,
  500, 500, 500, 500, 500, 500, 500, 333, 333, 675, 675, 675, 500, 920, 611, 611, 667, 722, 611,
  611, 722, 722, 333, 444, 667, 556, 833, 667, 722, 611, 722, 611, 500, 556, 722, 611, 833, 611,
  556, 556, 389, 278, 389, 422, 500, 333, 500, 500, 444, 500, 444, 278, 500, 500, 278, 278, 444,
  278, 722, 500, 500, 500, 500, 389, 389, 278, 500, 444, 667, 444, 444, 389, 400, 275, 400, 541,
];

// BEGIN GENERATED TIMES BOLD (scripts/generate-times-metrics.mjs — do not edit by hand)
const TIMES_BOLD = [
  250, 333, 555, 500, 500, 1000, 833, 278, 333, 333, 500, 570, 250, 333, 250, 278, 500, 500, 500,
  500, 500, 500, 500, 500, 500, 500, 333, 333, 570, 570, 570, 500, 930, 722, 667, 722, 722, 667,
  611, 778, 778, 389, 500, 778, 667, 944, 722, 778, 611, 778, 722, 556, 667, 722, 722, 1000, 722,
  722, 667, 333, 278, 333, 581, 500, 333, 500, 556, 444, 556, 444, 333, 500, 556, 278, 333, 556,
  278, 833, 556, 500, 556, 556, 444, 389, 333, 556, 500, 722, 500, 500, 444, 394, 220, 394, 520,
];

const TIMES_BOLD_EXTRAS: Record<string, number> = {
  '\u20ac': 500,
  '\u201a': 333,
  '\u0192': 500,
  '\u201e': 500,
  '\u2026': 1000,
  '\u2020': 500,
  '\u2021': 500,
  '\u02c6': 333,
  '\u2030': 1000,
  '\u0160': 556,
  '\u2039': 333,
  '\u0152': 1000,
  '\u017d': 667,
  '\u2018': 333,
  '\u2019': 333,
  '\u201c': 500,
  '\u201d': 500,
  '\u2022': 350,
  '\u2013': 500,
  '\u2014': 1000,
  '\u02dc': 333,
  '\u2122': 1000,
  '\u0161': 389,
  '\u203a': 333,
  '\u0153': 722,
  '\u017e': 444,
  '\u0178': 722,
  '\u00a0': 250,
  '\u00a1': 333,
  '\u00a2': 500,
  '\u00a3': 500,
  '\u00a4': 500,
  '\u00a5': 500,
  '\u00a6': 220,
  '\u00a7': 500,
  '\u00a8': 333,
  '\u00a9': 747,
  '\u00aa': 300,
  '\u00ab': 500,
  '\u00ac': 570,
  '\u00ad': 333,
  '\u00ae': 747,
  '\u00af': 500,
  '\u00b0': 400,
  '\u00b1': 549,
  '\u00b2': 300,
  '\u00b3': 300,
  '\u00b4': 333,
  '\u00b5': 576,
  '\u00b6': 540,
  '\u00b7': 333,
  '\u00b8': 333,
  '\u00b9': 300,
  '\u00ba': 330,
  '\u00bb': 500,
  '\u00bc': 750,
  '\u00bd': 750,
  '\u00be': 750,
  '\u00bf': 500,
  '\u00c0': 722,
  '\u00c1': 722,
  '\u00c2': 722,
  '\u00c3': 722,
  '\u00c4': 722,
  '\u00c5': 722,
  '\u00c6': 1000,
  '\u00c7': 722,
  '\u00c8': 667,
  '\u00c9': 667,
  '\u00ca': 667,
  '\u00cb': 667,
  '\u00cc': 389,
  '\u00cd': 389,
  '\u00ce': 389,
  '\u00cf': 389,
  '\u00d0': 722,
  '\u00d1': 722,
  '\u00d2': 778,
  '\u00d3': 778,
  '\u00d4': 778,
  '\u00d5': 778,
  '\u00d6': 778,
  '\u00d7': 570,
  '\u00d8': 778,
  '\u00d9': 722,
  '\u00da': 722,
  '\u00db': 722,
  '\u00dc': 722,
  '\u00dd': 722,
  '\u00de': 611,
  '\u00df': 556,
  '\u00e0': 500,
  '\u00e1': 500,
  '\u00e2': 500,
  '\u00e3': 500,
  '\u00e4': 500,
  '\u00e5': 500,
  '\u00e6': 722,
  '\u00e7': 444,
  '\u00e8': 444,
  '\u00e9': 444,
  '\u00ea': 444,
  '\u00eb': 444,
  '\u00ec': 278,
  '\u00ed': 278,
  '\u00ee': 278,
  '\u00ef': 278,
  '\u00f0': 500,
  '\u00f1': 556,
  '\u00f2': 500,
  '\u00f3': 500,
  '\u00f4': 500,
  '\u00f5': 500,
  '\u00f6': 500,
  '\u00f7': 549,
  '\u00f8': 500,
  '\u00f9': 556,
  '\u00fa': 556,
  '\u00fb': 556,
  '\u00fc': 556,
  '\u00fd': 500,
  '\u00fe': 556,
  '\u00ff': 500,
};

const TIMES_BOLD_ITALIC = [
  250, 389, 555, 500, 500, 833, 778, 278, 333, 333, 500, 570, 250, 333, 250, 278, 500, 500, 500,
  500, 500, 500, 500, 500, 500, 500, 333, 333, 570, 570, 570, 500, 832, 667, 667, 667, 722, 667,
  667, 722, 778, 389, 500, 667, 611, 889, 722, 722, 611, 722, 667, 556, 611, 722, 667, 889, 667,
  611, 611, 333, 278, 333, 570, 500, 333, 500, 500, 444, 500, 444, 333, 500, 556, 278, 278, 500,
  278, 778, 556, 500, 500, 500, 389, 389, 278, 556, 444, 667, 500, 444, 389, 348, 220, 348, 570,
];

const TIMES_BOLD_ITALIC_EXTRAS: Record<string, number> = {
  '\u20ac': 500,
  '\u201a': 333,
  '\u0192': 500,
  '\u201e': 500,
  '\u2026': 1000,
  '\u2020': 500,
  '\u2021': 500,
  '\u02c6': 333,
  '\u2030': 1000,
  '\u0160': 556,
  '\u2039': 333,
  '\u0152': 944,
  '\u017d': 611,
  '\u2018': 333,
  '\u2019': 333,
  '\u201c': 500,
  '\u201d': 500,
  '\u2022': 350,
  '\u2013': 500,
  '\u2014': 1000,
  '\u02dc': 333,
  '\u2122': 1000,
  '\u0161': 389,
  '\u203a': 333,
  '\u0153': 722,
  '\u017e': 389,
  '\u0178': 611,
  '\u00a0': 250,
  '\u00a1': 389,
  '\u00a2': 500,
  '\u00a3': 500,
  '\u00a4': 500,
  '\u00a5': 500,
  '\u00a6': 220,
  '\u00a7': 500,
  '\u00a8': 333,
  '\u00a9': 747,
  '\u00aa': 266,
  '\u00ab': 500,
  '\u00ac': 606,
  '\u00ad': 333,
  '\u00ae': 747,
  '\u00af': 500,
  '\u00b0': 400,
  '\u00b1': 549,
  '\u00b2': 300,
  '\u00b3': 300,
  '\u00b4': 333,
  '\u00b5': 576,
  '\u00b6': 500,
  '\u00b7': 250,
  '\u00b8': 333,
  '\u00b9': 300,
  '\u00ba': 300,
  '\u00bb': 500,
  '\u00bc': 750,
  '\u00bd': 750,
  '\u00be': 750,
  '\u00bf': 500,
  '\u00c0': 667,
  '\u00c1': 667,
  '\u00c2': 667,
  '\u00c3': 667,
  '\u00c4': 667,
  '\u00c5': 667,
  '\u00c6': 944,
  '\u00c7': 667,
  '\u00c8': 667,
  '\u00c9': 667,
  '\u00ca': 667,
  '\u00cb': 667,
  '\u00cc': 389,
  '\u00cd': 389,
  '\u00ce': 389,
  '\u00cf': 389,
  '\u00d0': 722,
  '\u00d1': 722,
  '\u00d2': 722,
  '\u00d3': 722,
  '\u00d4': 722,
  '\u00d5': 722,
  '\u00d6': 722,
  '\u00d7': 570,
  '\u00d8': 722,
  '\u00d9': 722,
  '\u00da': 722,
  '\u00db': 722,
  '\u00dc': 722,
  '\u00dd': 611,
  '\u00de': 611,
  '\u00df': 500,
  '\u00e0': 500,
  '\u00e1': 500,
  '\u00e2': 500,
  '\u00e3': 500,
  '\u00e4': 500,
  '\u00e5': 500,
  '\u00e6': 722,
  '\u00e7': 444,
  '\u00e8': 444,
  '\u00e9': 444,
  '\u00ea': 444,
  '\u00eb': 444,
  '\u00ec': 278,
  '\u00ed': 278,
  '\u00ee': 278,
  '\u00ef': 278,
  '\u00f0': 500,
  '\u00f1': 556,
  '\u00f2': 500,
  '\u00f3': 500,
  '\u00f4': 500,
  '\u00f5': 500,
  '\u00f6': 500,
  '\u00f7': 549,
  '\u00f8': 500,
  '\u00f9': 556,
  '\u00fa': 556,
  '\u00fb': 556,
  '\u00fc': 556,
  '\u00fd': 444,
  '\u00fe': 500,
  '\u00ff': 444,
};
// END GENERATED TIMES BOLD

/** Non-ASCII characters the job card can actually emit, per font. */
const EXTRAS: Record<'sans' | 'serif', Record<string, number>> = {
  sans: {
    ' ': 278,
    '·': 278,
    '•': 350,
    '–': 556,
    '—': 1000,
    '‘': 222,
    '’': 222,
    '“': 333,
    '”': 333,
    '°': 400,
    '±': 584,
    '×': 584,
    '…': 1000,
    '£': 556,
    '©': 737,
    '®': 737,
  },
  serif: {
    ' ': 250,
    '·': 250,
    '–': 500,
    '—': 889,
    '‘': 333,
    '’': 333,
    '“': 556,
    '”': 556,
    '°': 400,
    '…': 889,
  },
};

const tableFor = (font: PdfFont): readonly number[] => {
  switch (font) {
    // Helvetica-BoldOblique carries the same widths as Helvetica-Bold.
    case 'bold':
    case 'boldItalic':
      return HELVETICA_BOLD;
    case 'script':
      return TIMES_ITALIC;
    case 'serifBold':
      return TIMES_BOLD;
    case 'serifBoldItalic':
      return TIMES_BOLD_ITALIC;
    // Helvetica-Oblique carries the same widths as Helvetica.
    case 'italic':
    case 'regular':
      return HELVETICA;
  }
};

/**
 * Headroom for the font the VIEWER actually uses.
 *
 * The base-14 fonts are named, not embedded — that is the point of them, and it
 * keeps the file small. But a viewer without Helvetica substitutes something
 * metrically similar rather than identical: Chromium typically picks Liberation
 * Sans or DejaVu Sans, and DejaVu in particular sets noticeably wider.
 *
 * Laying out to exact Helvetica widths therefore still overflows in practice —
 * a line the metrics call 236pt rendered at about 270pt, which is how the
 * customer's contact details came to print over the job details beside them.
 * So every layout decision reserves this much headroom, and the PDF inspector
 * measures with it too, so a test sees what a reader would see.
 */
export const SUBSTITUTION_ALLOWANCE = 1.16;

/** Width of one character in 1/1000 em, or a sensible default. */
export const charWidth = (character: string, font: PdfFont): number => {
  const code = character.codePointAt(0) ?? 32;
  if (code >= 32 && code <= 126) {
    return tableFor(font)[code - 32] ?? 500;
  }
  if (font === 'serifBold') return TIMES_BOLD_EXTRAS[character] ?? 500;
  if (font === 'serifBoldItalic') return TIMES_BOLD_ITALIC_EXTRAS[character] ?? 500;
  const extras = EXTRAS[font === 'script' ? 'serif' : 'sans'];
  return extras[character] ?? (font === 'script' ? 500 : 556);
};
