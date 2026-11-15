import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { preparePdfImage, type PdfImage } from '@/lib/pdf/image';
import { inspectPdf, type TextRun } from '@/lib/pdf/inspect';
import { LETTERHEAD_LINES, letterheadLineText } from '@/lib/branding/eje-letterhead';

/**
 * LETTERHEAD-1 test material: a letterhead image made in the test, and the
 * readings a test needs to say where it was drawn and that nothing else moved.
 *
 * No company's real letterhead has been supplied, so none is used — or
 * imitated — here. The image is a flat colour of a letterhead's usual shape,
 * which is all a test of placement needs.
 */

/** A real RGB PNG (no transparency, so it embeds as ONE image object). */
export const letterheadPng = (width: number, height: number, rgb: readonly [number, number, number] = [20, 60, 140]): Uint8Array => {
  const chunk = (type: string, data: Uint8Array): Buffer => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', new Uint8Array()),
    ]),
  );
};

/** The PNG, prepared the way the server and the browser prepare a stored letterhead. */
export const preparedLetterhead = async (bytes: Uint8Array): Promise<PdfImage> => {
  const prepared = await preparePdfImage(bytes);
  if (prepared.kind !== 'image') throw new Error(`letterhead fixture did not prepare: ${prepared.reason}`);
  return prepared.image;
};

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Every image drawn: which object, and its box on the page (the matrix maps the unit square to it). */
export const drawnImages = (bytes: Uint8Array) =>
  [...Buffer.from(bytes).toString('latin1').matchAll(/q (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) cm \/(Im\d+) Do Q/gu)].map((match) => {
    const [a, b, c, d, e, f] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
    return { name: match[7]!, x: e, y: f, width: Math.abs(a) + Math.abs(c), height: Math.abs(b) + Math.abs(d) };
  });

/** Image objects in the file (a soft mask would count as a second one). */
export const imageObjectCount = (bytes: Uint8Array): number =>
  [...Buffer.from(bytes).toString('latin1').matchAll(/\/Subtype \/Image\b/gu)].length;

/** Whether the file carries exactly these pixels as an embedded image stream. */
export const embedsImageData = (bytes: Uint8Array, image: PdfImage): boolean =>
  Buffer.from(bytes).includes(Buffer.from(image.data));

/** Every text run, positioned, in drawing order. */
export const textRuns = (bytes: Uint8Array): readonly TextRun[] => inspectPdf(bytes).runs;

const key = (run: TextRun) => `${run.page}|${run.font}|${run.size}|${run.x}|${run.y}|${run.value}`;

/** The runs below `y` on page 1, and every run on later pages: the body. */
export const runsBelow = (bytes: Uint8Array, y: number): readonly string[] =>
  textRuns(bytes)
    .filter((run) => run.page > 1 || run.y < y)
    .map(key);

/**
 * LETTERHEAD-2: every even-odd FILLED path (`f*`) — the master letterhead's traced mark —
 * as its points, per page. Nothing else this writer draws is filled even-odd.
 */
export const filledPaths = (bytes: Uint8Array): readonly { readonly page: number; readonly points: readonly { x: number; y: number }[] }[] => {
  const text = Buffer.from(bytes).toString('latin1');
  const objects = new Map<number, string>();
  for (const match of text.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/gu)) objects.set(Number(match[1]), match[2] ?? '');
  const kids = [...(/\/Kids \[(.*?)\]/u.exec(text)?.[1] ?? '').matchAll(/(\d+) 0 R/gu)].map((match) => Number(match[1]));
  return kids.flatMap((kid, index) => {
    const contents = /\/Contents (\d+) 0 R/u.exec(objects.get(kid) ?? '')?.[1];
    const stream = objects.get(Number(contents)) ?? '';
    return [...stream.matchAll(/rg ((?:[\d.-]+ [\d.-]+ [ml] |h )+)f\*/gu)].map((match) => ({
      page: index + 1,
      points: [...(match[1] ?? '').matchAll(/([\d.-]+) ([\d.-]+) [ml]/gu)].map((point) => ({ x: Number(point[1]), y: Number(point[2]) })),
    }));
  });
};

/**
 * LETTERHEAD-2: a document's text without the EJE master letterhead's own lines. The official
 * letterhead carries the company's VAT NUMBER ("VAT NO: 4950134991") — identity, not money — so
 * a test that a document carries no price reads the document below its letterhead. Only whole
 * lines that are exactly the letterhead's are removed.
 */
export const withoutMasterLetterhead = (text: string): string => {
  const lines = new Set(LETTERHEAD_LINES.map(letterheadLineText));
  return text
    .split('\n')
    .filter((line) => !lines.has(line))
    .join('\n');
};
