/**
 * THE WIDTHS OF TIMES-BOLD AND TIMES-BOLDITALIC, FOR THE MASTER LETTERHEAD. LETTERHEAD-2.
 *
 * The master letterhead sets its address, contact and PO Box columns in a bold serif, as the
 * official paper does: the base-14 Times-Bold and Times-BoldItalic, named in the PDF and not
 * embedded. Centring a line needs its width, so `src/lib/pdf/metrics.ts` carries their advance
 * widths for the WinAnsi range — written by this script between its GENERATED markers.
 *
 * WHERE THE NUMBERS COME FROM: Times New Roman Bold and Bold Italic (C:\Windows\Fonts\timesbd.ttf,
 * timesbi.ttf), the metric-compatible stand-in for base-14 Times that Windows, and most PDF
 * viewers on it, actually draw with. A minimal TrueType reader takes each character's glyph from
 * the Unicode cmap (format 4) and its advance from hmtx, scaled to 1000 units per em and rounded.
 *
 *   node scripts/generate-times-metrics.mjs [<fonts-dir>]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FONTS = process.argv[2] ?? 'C:\\Windows\\Fonts';
const TARGET = join(process.cwd(), 'src', 'lib', 'pdf', 'metrics.ts');

const tables = (font) => {
  const count = font.readUInt16BE(4);
  const found = {};
  for (let i = 0; i < count; i += 1) {
    const at = 12 + i * 16;
    found[font.toString('latin1', at, at + 4)] = font.readUInt32BE(at + 8);
  }
  return found;
};

/** Unicode code point -> advance width in 1/1000 em. */
const advanceOf = (path) => {
  const font = readFileSync(path);
  const t = tables(font);
  const unitsPerEm = font.readUInt16BE(t.head + 18);
  const metricsCount = font.readUInt16BE(t.hhea + 34);
  // The Windows Unicode BMP subtable (platform 3, encoding 1), format 4.
  const subtables = font.readUInt16BE(t.cmap + 2);
  let sub = -1;
  for (let i = 0; i < subtables; i += 1) {
    const at = t.cmap + 4 + i * 8;
    if (font.readUInt16BE(at) === 3 && font.readUInt16BE(at + 2) === 1) sub = t.cmap + font.readUInt32BE(at + 4);
  }
  if (sub < 0 || font.readUInt16BE(sub) !== 4) throw new Error(`${path}: no format 4 Unicode cmap`);
  const segments = font.readUInt16BE(sub + 6) / 2;
  const ends = sub + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const offsets = deltas + segments * 2;
  const glyphOf = (code) => {
    for (let s = 0; s < segments; s += 1) {
      if (code > font.readUInt16BE(ends + s * 2)) continue;
      const start = font.readUInt16BE(starts + s * 2);
      if (code < start) return 0;
      const delta = font.readInt16BE(deltas + s * 2);
      const rangeOffset = font.readUInt16BE(offsets + s * 2);
      if (rangeOffset === 0) return (code + delta) & 0xffff;
      const glyph = font.readUInt16BE(offsets + s * 2 + rangeOffset + (code - start) * 2);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
  return (code) => {
    const glyph = glyphOf(code);
    const index = Math.min(glyph, metricsCount - 1);
    return Math.round((font.readUInt16BE(t.hmtx + index * 4) * 1000) / unitsPerEm);
  };
};

// WinAnsi 0x80..0x9F as Unicode (the rest of 0xA0..0xFF is Latin-1).
const WIN_ANSI_HIGH = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

const block = (name, width) => {
  const ascii = [];
  for (let code = 32; code <= 126; code += 1) ascii.push(width(code));
  const rows = [];
  for (let i = 0; i < ascii.length; i += 19) rows.push(`  ${ascii.slice(i, i + 19).join(', ')},`);
  const extras = [...WIN_ANSI_HIGH, ...Array.from({ length: 96 }, (_, i) => String.fromCharCode(0xa0 + i))]
    .map((character) => `  '\\u${character.codePointAt(0).toString(16).padStart(4, '0')}': ${width(character.codePointAt(0))},`);
  return `const ${name} = [\n${rows.join('\n')}\n];\n\nconst ${name}_EXTRAS: Record<string, number> = {\n${extras.join('\n')}\n};\n`;
};

const generated =
  block('TIMES_BOLD', advanceOf(join(FONTS, 'timesbd.ttf'))) +
  '\n' +
  block('TIMES_BOLD_ITALIC', advanceOf(join(FONTS, 'timesbi.ttf')));

// The file keeps whichever line endings the checkout gave it.
const raw = readFileSync(TARGET, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const source = raw.replace(/\r\n/g, '\n');
const begin = source.indexOf('// BEGIN GENERATED TIMES BOLD');
const end = source.indexOf('// END GENERATED TIMES BOLD');
if (begin < 0 || end < 0) throw new Error('metrics.ts has lost its GENERATED markers');
const beginLineEnd = source.indexOf('\n', begin) + 1;
writeFileSync(TARGET, (source.slice(0, beginLineEnd) + generated + source.slice(end)).replace(/\n/g, eol));
console.log('wrote Times-Bold and Times-BoldItalic widths into', TARGET);
