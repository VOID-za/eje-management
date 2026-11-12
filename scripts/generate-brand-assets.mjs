/**
 * EJE's branding, cut from the official logo. BRAND-1.
 *
 * THE SOURCE IS THE OWNER'S ARTWORK, UNCHANGED. `public/branding/eje-logo-original.jpg`
 * is a byte-for-byte copy of the file EJE supplied ("EJE Icon.jpg", 1536 × 1024, the
 * cyan metallic EJE lettering on the dark hexagon background). Nothing here redraws,
 * recolours or re-letters it: every asset below is that image, cropped and scaled
 * with its proportions kept. The script refuses to run if the copy has changed.
 *
 * WHAT IT WRITES
 *   public/branding/eje-logo-{960,480}.webp  the whole logo, 3:2 — the sign-in screen
 *   public/branding/eje-mark-{192,96}.webp   the lettering, square — header, sidebar, menu
 *   public/icons/icon-{192,512}.png          the installed app's icons (same paths as before,
 *   public/icons/icon-maskable-512.png       so the manifest and the service worker are unchanged)
 *   public/icons/apple-touch-icon.png        180 × 180, for iOS
 *   public/icons/icon-64.png                 the browser-tab favicon (named first in app/layout.tsx)
 *
 * THE APPLICATION ONLY, NEVER A DOCUMENT (the owner, 12 November 2026). The logo brands the
 * application's interface. No job card, delivery note, timesheet, attendance form, report or
 * any other generated or printed document carries it, and the interface logo is hidden when a
 * page is printed. `src/lib/branding/branding.test.ts` enforces both.
 *
 * WHY THE SQUARE ICONS ARE A CROP, NOT THE WHOLE IMAGE. The logo is wide and the lettering
 * fills about a third of it; shrunk whole to 32 px the letters are a smudge. The square
 * crop is centred on the lettering, so it stays readable down to a browser tab. The
 * maskable icon is cropped wider so the lettering sits inside Android's 80% safe circle.
 *
 * `sharp` is used HERE ONLY, at authoring time — it is already installed as Next's own
 * image dependency. The application never loads it: what it serves are the files this
 * writes, which are committed.
 *
 *   node scripts/generate-brand-assets.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const SOURCE = join(ROOT, 'public', 'branding', 'eje-logo-original.jpg');
/** SHA-256 of the file EJE supplied. A different file is not the official logo. */
const SOURCE_SHA256 = 'be5eff04aeef909daef918c3c3a2723bfec05a846ef69cbb8010fd5a05fa6d45';

/*
 * Crops, in the source's own pixels (1536 × 1024). The lettering spans roughly
 * x 465–1070, y 285–725, centred near (767, 505).
 */
const MARK = { left: 388, top: 125, width: 760, height: 760 };
const MASKABLE = { left: 300, top: 38, width: 936, height: 936 };

const source = readFileSync(SOURCE);
const digest = createHash('sha256').update(source).digest('hex');
if (digest !== SOURCE_SHA256) {
  console.error(`${SOURCE} is not the official EJE logo (sha256 ${digest}). Nothing was written.`);
  process.exit(1);
}
const meta = await sharp(source).metadata();
if (meta.width !== 1536 || meta.height !== 1024) {
  console.error(`Expected the 1536 × 1024 logo, found ${meta.width} × ${meta.height}. Nothing was written.`);
  process.exit(1);
}

const out = (path) => {
  const full = join(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  return full;
};
const written = [];
const save = async (path, pipeline) => {
  const info = await pipeline.toFile(out(path));
  written.push(`${path}  ${info.width}×${info.height}  ${info.size} bytes`);
};

// The whole logo, aspect kept (3:2).
for (const width of [960, 480]) {
  await save(`public/branding/eje-logo-${width}.webp`, sharp(source).resize({ width }).webp({ quality: 82 }));
}
// The lettering, square.
for (const size of [192, 96]) {
  await save(`public/branding/eje-mark-${size}.webp`, sharp(source).extract(MARK).resize(size, size).webp({ quality: 85 }));
}
// The installed application's icons, at the paths the manifest and service worker already use.
for (const size of [192, 512]) {
  await save(`public/icons/icon-${size}.png`, sharp(source).extract(MARK).resize(size, size).png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 }));
}
await save('public/icons/icon-maskable-512.png', sharp(source).extract(MASKABLE).resize(512, 512).png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 }));
await save('public/icons/apple-touch-icon.png', sharp(source).extract(MARK).resize(180, 180).png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 }));
// The browser tab — listed first in the root layout's `icons` (which, being explicit, is what Next links).
await save('public/icons/icon-64.png', sharp(source).extract(MARK).resize(64, 64).png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 }));

console.log(written.join('\n'));
