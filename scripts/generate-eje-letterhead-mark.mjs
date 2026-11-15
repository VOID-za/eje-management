/**
 * THE EJE MARK OF THE MASTER LETTERHEAD, TRACED FROM THE OWNER'S PHOTO. LETTERHEAD-2.
 *
 * The owner (15 November 2026): the official letterhead is recreated as a proper header —
 * crisp vector text and a clean logo, not a pasted picture. The logo is the EJE mark exactly
 * as it is printed on the company's paper, so it is TAKEN FROM THE PHOTO of that paper, never
 * redrawn by hand:
 *
 *   1. the same crop, flat-field and threshold that made the approved digital letterhead (v3):
 *      the photo's mark is cropped, greyscaled and doubled in size; the paper's uneven light is
 *      modelled as a plane fitted to paper pixels only and divided out; a smooth ramp turns the
 *      result into ink coverage (0 = paper, 1 = ink);
 *   2. its outline is traced by marching squares at the 0.5 level of that coverage, at twice
 *      the photo's resolution, every hole kept (the counters of the letters);
 *   3. each closed outline is simplified by Ramer–Douglas–Peucker at a tolerance small enough
 *      that the slab serifs keep their corners;
 *   4. the outlines are written as polygons in normalised units (0..1 across the mark's own
 *      box) with the box's aspect ratio, filled even-odd by both renderers.
 *
 * It then rasterises the traced outline and compares it with the cleaned mask (IoU), and
 * writes both images beside the output for a person to LOOK at.
 *
 * `sharp` is used HERE ONLY, at authoring time (as in generate-brand-assets.mjs). The photo
 * is the owner's and is not committed; pass its path:
 *
 *   node scripts/generate-eje-letterhead-mark.mjs "<photo.jpg>" [<check-images-dir>]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const [photo, checkDir] = process.argv.slice(2);
if (photo === undefined) {
  console.error('usage: node scripts/generate-eje-letterhead-mark.mjs <photo.jpg> [<check-images-dir>]');
  process.exit(1);
}
const OUT = join(process.cwd(), 'src', 'lib', 'branding', 'eje-letterhead-mark.ts');

// ---- 1. The cleaned mark, exactly as make-letterhead (v3) made it. ----------------------------
const crop = { left: 0, top: 318, width: 660, height: 450 };
const scale = 2;
const grey = await sharp(photo)
  .extract(crop)
  .greyscale()
  .resize(crop.width * scale, crop.height * scale, { kernel: 'lanczos3' })
  .blur(1.2)
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width: W, height: H } = grey.info;

// The paper's light as a plane a + b·x + c·y, least squares over paper pixels only.
let n = 0, sx = 0, sy = 0, sv = 0, sxx = 0, syy = 0, sxy = 0, sxv = 0, syv = 0;
for (let y = 0; y < H; y += 2) {
  for (let x = 0; x < W; x += 2) {
    const v = grey.data[y * W + x];
    if (v < 120) continue;
    n += 1; sx += x; sy += y; sv += v; sxx += x * x; syy += y * y; sxy += x * y; sxv += x * v; syv += y * v;
  }
}
const M = [[n, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]];
const R = [sv, sxv, syv];
const det = (m) =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
  m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
  m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
const D = det(M);
const column = (k) => M.map((row, i) => row.map((v, j) => (j === k ? R[i] : v)));
const [pa, pb, pc] = [det(column(0)) / D, det(column(1)) / D, det(column(2)) / D];

// Ink coverage 0..1 per pixel — the alpha v3 used.
const coverage = new Float64Array(W * H);
for (let i = 0; i < W * H; i += 1) {
  const paper = pa + pb * (i % W) + pc * Math.floor(i / W);
  const v = Math.min(255, (grey.data[i] / Math.max(1, paper)) * 205);
  coverage[i] = Math.max(0, Math.min(1, (150 - v) / 45));
}

// The mark's box: what v3's `trim()` kept — every pixel with any ink.
let minX = W, minY = H, maxX = -1, maxY = -1;
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    if (coverage[y * W + x] <= 0) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
}
const boxW = maxX - minX + 1;
const boxH = maxY - minY + 1;

// ---- 2. Marching squares at the 0.5 level. ----------------------------------------------------
// Pixel centres sit at integer coordinates; a one-pixel border of paper around the grid closes
// every outline. Each crossing lies on a grid edge, and each grid edge is shared by exactly two
// cells, so outlines are linked by the edge they cross.
const ISO = 0.5;
const value = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : coverage[y * W + x]);
const crossings = new Map(); // edge key -> { point, ends: segment ids }
const segments = []; // [keyA, keyB]
const pointOn = (x1, y1, x2, y2) => {
  const v1 = value(x1, y1), v2 = value(x2, y2);
  const t = (ISO - v1) / (v2 - v1);
  return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
};
const edge = (kind, x, y) => {
  const key = `${kind}${x},${y}`;
  if (!crossings.has(key)) {
    const point = kind === 'h' ? pointOn(x, y, x + 1, y) : pointOn(x, y, x, y + 1);
    crossings.set(key, { point, ends: [] });
  }
  return key;
};
const link = (a, b) => {
  const id = segments.length;
  segments.push([a, b]);
  crossings.get(a).ends.push(id);
  crossings.get(b).ends.push(id);
};
for (let y = -1; y < H; y += 1) {
  for (let x = -1; x < W; x += 1) {
    const a = value(x, y) >= ISO, b = value(x + 1, y) >= ISO;
    const c = value(x + 1, y + 1) >= ISO, d = value(x, y + 1) >= ISO;
    const top = a !== b ? edge('h', x, y) : null;
    const right = b !== c ? edge('v', x + 1, y) : null;
    const bottom = d !== c ? edge('h', x, y + 1) : null;
    const left = a !== d ? edge('v', x, y) : null;
    const present = [top, right, bottom, left].filter((key) => key !== null);
    if (present.length === 2) {
      link(present[0], present[1]);
    } else if (present.length === 4) {
      // A saddle: the cell's centre decides which diagonal is joined.
      const centreInside = (value(x, y) + value(x + 1, y) + value(x + 1, y + 1) + value(x, y + 1)) / 4 >= ISO;
      // Cut off the corners that are NOT of the centre's kind.
      const cutA = a !== centreInside; // corner a sits between left and top
      if (cutA) {
        link(left, top);
        link(right, bottom);
      } else {
        link(top, right);
        link(bottom, left);
      }
    }
  }
}

// Chain the segments into closed loops.
const used = new Uint8Array(segments.length);
const loops = [];
for (let start = 0; start < segments.length; start += 1) {
  if (used[start]) continue;
  used[start] = 1;
  const first = segments[start][0];
  let current = segments[start][1];
  const loop = [crossings.get(first).point];
  while (current !== first) {
    loop.push(crossings.get(current).point);
    const next = crossings.get(current).ends.find((id) => !used[id]);
    if (next === undefined) break;
    used[next] = 1;
    const [ka, kb] = segments[next];
    current = ka === current ? kb : ka;
  }
  loops.push(loop);
}

// ---- 3. Ramer–Douglas–Peucker, per closed loop. -----------------------------------------------
// 0.35 px at twice the photo's resolution: under a fifth of a photo pixel, so a serif's corner
// is never rounded off, while the staircase of single pixels is.
const TOLERANCE = 0.35;
const rdp = (points, tolerance) => {
  if (points.length < 3) return points;
  const [x1, y1] = points[0];
  const [x2, y2] = points[points.length - 1];
  const dx = x2 - x1, dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  let worst = -1, at = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i];
    const distance = length === 0 ? Math.hypot(px - x1, py - y1) : Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / length;
    if (distance > worst) { worst = distance; at = i; }
  }
  if (worst <= tolerance) return [points[0], points[points.length - 1]];
  return [...rdp(points.slice(0, at + 1), tolerance).slice(0, -1), ...rdp(points.slice(at), tolerance)];
};
const simplifyClosed = (loop) => {
  // Split at the point farthest from the first, so both halves are open polylines.
  const [x0, y0] = loop[0];
  let far = 0, farDistance = -1;
  loop.forEach(([x, y], i) => {
    const distance = Math.hypot(x - x0, y - y0);
    if (distance > farDistance) { farDistance = distance; far = i; }
  });
  const first = rdp(loop.slice(0, far + 1), TOLERANCE);
  const second = rdp([...loop.slice(far), loop[0]], TOLERANCE);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
};

const traced = loops.filter((loop) => loop.length >= 3).map(simplifyClosed).filter((loop) => loop.length >= 3);
const toUnit = ([x, y]) => [(x - minX + 0.5) / boxW, (y - minY + 0.5) / boxH];
const rounded = (v) => Math.round(v * 100000) / 100000;
const polygons = traced.map((loop) => loop.map(toUnit).flatMap(([x, y]) => [rounded(x), rounded(y)]));

// ---- 4. Check: rasterise the trace and compare it with the cleaned mask. ----------------------
const d = traced
  .map((loop) => `M${loop.map(([x, y]) => `${(x + 0.5).toFixed(3)},${(y + 0.5).toFixed(3)}`).join('L')}Z`)
  .join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/><path d="${d}" fill="#000" fill-rule="evenodd"/></svg>`;
const raster = await sharp(Buffer.from(svg)).greyscale().raw().toBuffer();
let both = 0, either = 0;
const maskPixels = Buffer.alloc(W * H);
for (let i = 0; i < W * H; i += 1) {
  const inMask = coverage[i] >= ISO;
  const inTrace = raster[i] < 128;
  maskPixels[i] = inMask ? 0 : 255;
  if (inMask && inTrace) both += 1;
  if (inMask || inTrace) either += 1;
}
const iou = both / either;
if (checkDir !== undefined) {
  mkdirSync(checkDir, { recursive: true });
  await sharp(maskPixels, { raw: { width: W, height: H, channels: 1 } }).png().toFile(join(checkDir, 'mark-mask.png'));
  await sharp(Buffer.from(svg)).png().toFile(join(checkDir, 'mark-traced.png'));
}

const vertexCount = polygons.reduce((sum, polygon) => sum + polygon.length / 2, 0);
const aspect = boxW / boxH;
const body = `/**
 * THE EJE MARK OF THE MASTER LETTERHEAD, AS VECTOR OUTLINES. LETTERHEAD-2.
 *
 * GENERATED by scripts/generate-eje-letterhead-mark.mjs from the owner's photograph of the
 * official letterhead — traced, never drawn by hand. Do not edit; run the script again.
 *
 * ${polygons.length} closed outline${polygons.length === 1 ? '' : 's'} (${vertexCount} points; a hole, where the mark has one, is an
 * outline of its own), in
 * normalised units: x and y run 0..1 across the mark's own box (y downwards), which is
 * EJE_MARK_ASPECT times as wide as it is high. Fill them EVEN-ODD.
 *
 * Traced at ${W} × ${H} (twice the photo's crop); the traced outline covers the cleaned mask
 * with an IoU of ${iou.toFixed(4)}.
 */

/** The mark's box, width ÷ height (${boxW} × ${boxH} traced pixels). */
export const EJE_MARK_ASPECT = ${aspect};

/** Each outline as a flat list x0, y0, x1, y1, … — closed (the last point joins the first). */
export const EJE_MARK_POLYGONS: readonly (readonly number[])[] = [
${polygons.map((polygon) => `  [${polygon.join(',')}],`).join('\n')}
];
`;
writeFileSync(OUT, body);
console.log(
  `mark ${boxW} x ${boxH} (aspect ${aspect.toFixed(4)}), ${loops.length} loops -> ${polygons.length} outlines, ` +
    `${vertexCount} points, IoU ${iou.toFixed(4)}; wrote ${OUT}`,
);
