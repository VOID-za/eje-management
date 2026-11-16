/**
 * THE MASTER LETTERHEAD'S LETTERING, AS GLYPH OUTLINES. LETTERHEAD-4.
 *
 * The owner (16 November 2026): the typefaces of the master letterhead were wrong. The official
 * paper is set in Verdana Bold Italic (the name, "Reg:" and "VAT NO:"), Georgia Bold (the address
 * and contact columns, with Georgia's old-style figures, and "Atlasville") and Georgia Bold Italic
 * ("P.O. Box 16282" and "1465"). Helvetica and Times changed the paper's identity.
 *
 * Those faces are not base-14 PDF fonts and are not on every device, so the lettering is drawn as
 * OUTLINES: this script reads the owner's Windows fonts (verdanaz.ttf, georgiab.ttf, georgiaz.ttf),
 * lays every line out with the font's own advances and GPOS pair kerning (none of which applies to
 * this wording), and writes src/lib/branding/eje-letterhead-glyphs.ts:
 *
 *   - each DISTINCT glyph once, in font units (y up), its TrueType quadratic curves kept as curves;
 *   - each line as its glyphs and their pen positions, plus where the line sits and how big it is.
 *
 * No font file is embedded, committed or shipped: only the shapes of the glyphs these lines use.
 *
 * WHERE EACH LINE GOES: measured on the owner's photograph ("EJE Letterhead - official, metadata
 * removed.jpg", 3497 × 860) by fitting each line's own outlines to the photo's ink (least squares
 * over the flat-fielded ink coverage, every line separately): its centre, baseline, em size and
 * horizontal scale, in photo pixels (MEASURED below). The paper's lettering is narrower than the
 * fonts' natural proportions — 0.85 of them in the name block, the contact column and the PO Box,
 * 0.96 in the address column, consistently line after line — so each block keeps the horizontal
 * scale it has on the paper (as a word processor's character scale sets it).
 *
 * THE PHOTO, STRAIGHTENED: the photo is tilted by about 0.2° (every line's baseline falls by
 * ~0.0035 px per px to the right); each line is placed with that tilt taken out (about x = 1900)
 * and drawn level. Otherwise the photo's pixels ARE the reference space: x + 16 and y − 108 put
 * the EJE mark (traced from the same photo by scripts/generate-eje-letterhead-mark.mjs) at the
 * left edge of the 3300 × 660 reference box, as before.
 *
 *   node scripts/generate-eje-letterhead-text.mjs [<fonts-dir>]     (default C:\Windows\Fonts)
 *
 * `opentype.js` is used HERE ONLY, at authoring time, and is deliberately NOT a dependency of the
 * project: the lockfile must stay identical to the live release's for the rollback-compatibility check.
 * Install it for one run, without saving it:
 *
 *   npm install --no-save opentype.js@1.3.4
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import opentype from 'opentype.js';

const FONTS = process.argv[2] ?? 'C:/Windows/Fonts';
const OUT = join(process.cwd(), 'src', 'lib', 'branding', 'eje-letterhead-glyphs.ts');

const FACES = {
  sansBoldItalic: { file: 'verdanaz.ttf', name: 'Verdana Bold Italic' },
  serifBold: { file: 'georgiab.ttf', name: 'Georgia Bold' },
  serifBoldItalic: { file: 'georgiaz.ttf', name: 'Georgia Bold Italic' },
};

// ---- What was measured on the photo (photo pixels, y downwards, as photographed). --------------
// centre: the middle of the line's advance; baseline: at that centre; size: the em, vertically;
// hscale: the em horizontally ÷ vertically. Sizes and horizontal scales are each block's common
// value (the lines of a block agree within 1 %). The name's "cc" measured the same size as the
// rest of the name (129.4 against 129.5) and follows it after one ordinary space.
const D = '\u2013';
const NAME = { size: 129.3, hscale: 0.857 };
const SMALL = { size: 44.6, hscale: 0.857 };
const ADDRESS = { size: 51.6, hscale: 0.959 };
const CONTACT = { size: 52.55, hscale: 0.853 };
const POBOX = { size: 52.0, hscale: 0.848 };
const MEASURED = [
  ['sansBoldItalic', 'Reg: CK1987/020035/23', 1773.5, 197.2, SMALL],
  ['sansBoldItalic', 'EJE Industrial Electronics cc', 1900.0, 335.5, NAME],
  ['sansBoldItalic', 'VAT NO: 4950134991', 1776.5, 406.8, SMALL],
  ['serifBold', 'Bonfoi Office Park', 1038.0, 479.4, ADDRESS],
  ['serifBold', 'c/oTempelhof South  Rd', 1030.5, 537.1, ADDRESS],
  ['serifBold', 'and Atlas Rd', 1029.8, 595.1, ADDRESS],
  ['serifBold', 'Bonaero Park', 1028.8, 653.5, ADDRESS],
  ['serifBold', 'Kempton Park, 1619', 1027.6, 712.0, ADDRESS],
  ['serifBold', `Cell:  083 443 7736 ${D} Peet Buitendag`, 1939.9, 482.9, CONTACT],
  ['serifBold', `Cell: 082 330 3404 ${D} Dawie Malan`, 1941.5, 542.8, CONTACT],
  ['serifBold', 'Tel: 083 285 1644/011 979 5080', 1942.3, 602.1, CONTACT],
  ['serifBold', 'Fax: 086 529 0073', 1943.4, 661.3, CONTACT],
  ['serifBold', 'Email: sales@ejeie.co.za or peetb@ejeie.co.za', 1943.9, 721.9, CONTACT],
  ['serifBoldItalic', 'P.O. Box 16282', 2974.4, 430.2, POBOX],
  // Upright on the paper (a two-storey "a", fitted IoU 0.79 upright against 0.55 italic):
  // Georgia Bold, a little larger than its neighbours.
  ['serifBold', 'Atlasville', 2979.0, 491.7, { size: 55.6, hscale: 0.848 }],
  ['serifBoldItalic', '1465', 2982.1, 551.9, POBOX],
];
/** The traced mark's box on the photo (its outline fitted back onto the photo's ink: IoU 0.990). */
const MARK = { x: -0.06, y: 323.19, height: 419.25 };

// ---- The photo, straightened, into the reference box. -----------------------------------------
const TILT = 0.0035;
const PIVOT = 1900;
const REFERENCE = { width: 3300, height: 660 };
const toReference = (x, y) => [x + 16, y - TILT * (x - PIVOT) - 108];

// ---- Kerning. -----------------------------------------------------------------------------------
const coverageIndex = (coverage, glyph) => {
  if (coverage.format === 1) return coverage.glyphs.indexOf(glyph);
  for (const range of coverage.ranges) if (glyph >= range.start && glyph <= range.end) return range.index + glyph - range.start;
  return -1;
};
const classOf = (definition, glyph) => {
  if (definition === undefined) return 0;
  if (definition.format === 1) {
    const index = glyph - definition.startGlyph;
    return index >= 0 && index < definition.classes.length ? definition.classes[index] : 0;
  }
  for (const range of definition.ranges) if (glyph >= range.start && glyph <= range.end) return range.classId;
  return 0;
};
/** GPOS pair kerning (lookup type 2, both formats), in font units. */
const kerning = (font, left, right) => {
  for (const lookup of font.tables.gpos?.lookups ?? []) {
    if (lookup.lookupType !== 2) continue;
    for (const subtable of lookup.subtables) {
      const index = coverageIndex(subtable.coverage, left);
      if (index < 0) continue;
      if (subtable.posFormat === 1) {
        const pair = subtable.pairSets[index]?.find((candidate) => candidate.secondGlyph === right);
        if (pair !== undefined) return pair.value1?.xAdvance ?? 0;
      } else {
        const value = subtable.classRecords[classOf(subtable.classDef1, left)]?.[classOf(subtable.classDef2, right)];
        if (value?.value1?.xAdvance) return value.value1.xAdvance;
      }
    }
  }
  return 0;
};

// ---- Layout. ------------------------------------------------------------------------------------
const fonts = Object.fromEntries(
  Object.entries(FACES).map(([role, face]) => [role, opentype.loadSync(join(FONTS, face.file))]),
);
const r1 = (value) => Math.round(value * 10) / 10 + 0;
const r4 = (value) => Math.round(value * 10000) / 10000 + 0;

/** A glyph's outline in font units (integers, y up), SVG syntax. */
const outline = (glyph) => {
  const parts = [];
  let last = null;
  for (const command of glyph.path.commands) {
    if (command.type === 'Z') {
      parts.push('Z');
      last = null;
      continue;
    }
    const x = Math.round(command.x);
    const y = Math.round(command.y);
    if (command.type === 'M') parts.push(`M${x} ${y}`);
    else if (command.type === 'L') {
      if (last === `${x} ${y}`) continue;
      parts.push(`L${x} ${y}`);
    } else if (command.type === 'Q') parts.push(`Q${Math.round(command.x1)} ${Math.round(command.y1)} ${x} ${y}`);
    else throw new Error(`unexpected ${command.type} in a TrueType outline`);
    last = `${x} ${y}`;
  }
  return parts.join('').replace(/ -/g, '-');
};

const glyphTable = Object.fromEntries(Object.keys(FACES).map((role) => [role, new Map()]));
let kerned = 0;
const lines = MEASURED.map(([role, text, centre, baseline, { size, hscale }]) => {
  const font = fonts[role];
  const em = font.unitsPerEm;
  const characters = [...text];
  const glyphs = font.stringToGlyphs(text);
  if (glyphs.length !== characters.length) throw new Error(`"${text}": one glyph per character expected`);
  const pens = [];
  let pen = 0;
  glyphs.forEach((glyph, index) => {
    if (glyph.index === 0) throw new Error(`"${text}": "${characters[index]}" is not in ${FACES[role].name}`);
    if (!glyphTable[role].has(characters[index])) {
      glyphTable[role].set(characters[index], { advance: glyph.advanceWidth, path: outline(glyph) });
    }
    pens.push(pen);
    pen += glyph.advanceWidth;
    if (index + 1 < glyphs.length) {
      const k = kerning(font, glyph.index, glyphs[index + 1].index);
      if (k !== 0) kerned += 1;
      pen += k;
    }
  });
  const [x, y] = toReference(centre, baseline);
  return {
    role,
    text,
    x: r1(x),
    baseline: r1(y),
    size,
    hscale,
    /** The advance in reference units. */
    width: r1((pen * size * hscale) / em),
    pens,
    advance: pen,
  };
});

const [markX, markY] = toReference(MARK.x, MARK.y + MARK.height / 2);
const mark = { x: r1(markX), y: r1(markY - MARK.height / 2), height: MARK.height };

const em = fonts.sansBoldItalic.unitsPerEm;
for (const font of Object.values(fonts)) if (font.unitsPerEm !== em) throw new Error('one em for every face expected');

const glyphCount = Object.values(glyphTable).reduce((sum, table) => sum + table.size, 0);
const pathBytes = Object.values(glyphTable).reduce((sum, table) => sum + [...table.values()].reduce((s, g) => s + g.path.length, 0), 0);
const body = `/**
 * THE MASTER LETTERHEAD'S LETTERING, AS OUTLINES. LETTERHEAD-4.
 *
 * GENERATED by scripts/generate-eje-letterhead-text.mjs from the owner's Windows fonts
 * (${Object.values(FACES).map((face) => face.name).join(', ')}) and the positions measured on the
 * owner's photograph of the official letterhead. Do not edit; run the script again.
 *
 * Only the outlines of the ${glyphCount} glyphs these lines use are here — no font file is embedded or shipped.
 *
 * Glyph outlines are in font units (${em} to the em), y UP, SVG syntax (M, L, Q, Z); fill NONZERO.
 * A line is in the ${REFERENCE.width} × ${REFERENCE.height} reference space (x to the right, y DOWNWARDS):
 * \`x\` is the centre of its advance, \`baseline\` its baseline, \`size\` its em (vertically),
 * \`hscale\` its horizontal scale, \`width\` its advance; \`pens\` puts each glyph along it, in font units.
 */

export const LETTERHEAD_GLYPH_REFERENCE = { width: ${REFERENCE.width}, height: ${REFERENCE.height} } as const;

export const LETTERHEAD_UNITS_PER_EM = ${em};

/** The traced EJE mark's box (left, top, height; its width follows EJE_MARK_ASPECT). */
export const LETTERHEAD_MARK_PLACEMENT = { x: ${mark.x}, y: ${mark.y}, height: ${mark.height} } as const;

export type LetterheadGlyphFace = 'sansBoldItalic' | 'serifBold' | 'serifBoldItalic';

export interface LetterheadGlyph {
  readonly advance: number;
  readonly path: string;
}

/** Each face's glyphs, by the character they draw. */
export const LETTERHEAD_GLYPHS: Readonly<Record<LetterheadGlyphFace, Readonly<Record<string, LetterheadGlyph>>>> = {
${Object.entries(glyphTable)
  .map(
    ([role, table]) =>
      `  ${role}: {\n${[...table.entries()]
        .map(([character, glyph]) => `    ${JSON.stringify(character)}: { advance: ${glyph.advance}, path: '${glyph.path}' },`)
        .join('\n')}\n  },`,
  )
  .join('\n')}
};

export interface LetterheadGlyphLine {
  readonly role: LetterheadGlyphFace;
  readonly text: string;
  readonly x: number;
  readonly baseline: number;
  readonly size: number;
  readonly hscale: number;
  readonly width: number;
  /** Each character's pen position along the line, font units from its start. */
  readonly pens: readonly number[];
}

export const LETTERHEAD_GLYPH_LINES: readonly LetterheadGlyphLine[] = [
${lines
  .map(
    (line) =>
      `  {\n    role: '${line.role}',\n    text: ${JSON.stringify(line.text)},\n    x: ${line.x},\n    baseline: ${line.baseline},\n` +
      `    size: ${line.size},\n    hscale: ${line.hscale},\n    width: ${line.width},\n    pens: [${line.pens.join(', ')}],\n  },`,
  )
  .join('\n')}
];
`;
writeFileSync(OUT, body);
console.log(`${lines.length} lines, ${glyphCount} distinct glyphs (${pathBytes} bytes of outline), ${kerned} kerned pairs; mark at ${mark.x}, ${mark.y}; wrote ${OUT}`);
for (const line of lines) {
  console.log(`${line.role.padEnd(16)} x ${line.x} baseline ${line.baseline} size ${line.size} × ${r4(line.hscale)} width ${line.width}  ${line.text}`);
}
