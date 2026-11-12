import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderDeliveryNotePdf } from '@/services/simulated/delivery-note-pdf';
import { renderTimesheetPdf } from '@/services/simulated/timesheet-pdf';
import { renderAttendancePdf } from '@/services/simulated/attendance-pdf';
import { buildAttendanceRows, type AttendanceDocument } from '@/application/attendance-document';
import type { TimesheetDocument } from '@/application/timesheets';
import { loadFinalDocumentFile } from '@/application/final-document';
import { buildHarness, seedUser } from '@/application/test-harness';
import { CACHEABLE_PREFIXES, PRECACHE_PATHS, isCacheablePath } from '@/lib/pwa/shell';
import manifest from '@/app/manifest';

/**
 * BRAND-1: EJE's official logo — in the APPLICATION, and NEVER on a document.
 *
 * The owner (12 November 2026): the logo brands the application's interface only. No job
 * card, delivery note, timesheet, attendance form, report or any other generated or
 * printable document carries it. So this proves both halves:
 *
 *   - the interface: the source is the owner's file unchanged; every asset is a crop or a
 *     scale of it with its proportions kept; the sign-in screen, sidebar and top bar use it;
 *     every referenced file exists; it is kept for offline use; it is hidden when printing.
 *   - the documents: only the interface's own files may name the logo, and each kind of
 *     generated PDF, rendered here, embeds no image at all (none of these has a photograph).
 */

const ROOT = process.cwd();
const file = (path: string) => readFileSync(join(ROOT, path));
const source = (path: string) => file(path).toString('utf8');

/** The SHA-256 of "EJE Icon.jpg" as EJE supplied it. */
const OFFICIAL_SHA256 = 'be5eff04aeef909daef918c3c3a2723bfec05a846ef69cbb8010fd5a05fa6d45';

const jpegSize = (bytes: Buffer): { width: number; height: number } => {
  let offset = 2;
  while (offset < bytes.length) {
    const marker = bytes[offset + 1]!;
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error('no frame header');
};
const pngSize = (bytes: Buffer) => {
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};
const webpSize = (bytes: Buffer) => {
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF');
  expect(bytes.subarray(8, 12).toString('latin1')).toBe('WEBP');
  const chunk = bytes.subarray(12, 16).toString('latin1');
  if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  if (chunk === 'VP8L') {
    const bits = bytes.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  throw new Error(`unexpected WebP chunk ${chunk}`);
};

/** Every source file under `dir`, tests excluded. */
const sourcesUnder = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return sourcesUnder(path);
    return /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|css|html)$/u.test(name) && !/\.test\.|\.browser\.test\./u.test(name) ? [path] : [];
  });

/**
 * How a file can show the logo: ANY module path ending in `/Logo` (alias, relative, with an extension, static or
 * dynamic import), the logo's own files, or the icons — which are now cut from it.
 */
const NAMES_THE_LOGO = /['"`][^'"`]*\/Logo(\.[cm]?[jt]sx?)?['"`]|\/branding\/|\/icons\/|eje-logo|eje-mark/u;

/**
 * The ONLY files allowed to show the logo — the application's own furniture. A document, a
 * PDF renderer, a print layout or a job card component appearing here is the failure this
 * test exists to catch.
 */
const INTERFACE_FILES = new Set(
  [
    'src/components/layout/Logo.tsx', // the logo components themselves
    'src/components/layout/Sidebar.tsx', // sidebar and the phone menu drawer
    'src/components/layout/SignInGate.tsx', // the sign-in screen
    'src/components/layout/TopBar.tsx', // the top bar on a tablet
    'src/app/not-found.tsx', // the application's 404 page
    'src/app/layout.tsx', // the favicon and home-screen icons (metadata)
    'src/app/manifest.ts', // the installed application's icons
    'src/lib/pwa/shell.ts', // offline caching of the logo files and icons
    'src/lib/branding/branding.test.ts',
  ],
);
/** For COMPARING only, the same on Windows and Linux: forward slashes. Files are always read by their own path. */
const normalise = (path: string) => path.replaceAll('\\', '/');

/** Image objects in a PDF. */
const imageObjects = (pdf: Uint8Array): number => [...Buffer.from(pdf).toString('latin1').matchAll(/\/Subtype \/Image\b/gu)].length;

describe('the official logo', () => {
  it('is the file EJE supplied, unchanged: 1536 × 1024 JPEG', () => {
    const original = file('public/branding/eje-logo-original.jpg');
    expect(createHash('sha256').update(original).digest('hex')).toBe(OFFICIAL_SHA256);
    expect(jpegSize(original)).toEqual({ width: 1536, height: 1024 });
  });

  it('is cut, never stretched: the full logo keeps 3:2, every mark and icon is square', () => {
    for (const [path, width] of [['public/branding/eje-logo-960.webp', 960], ['public/branding/eje-logo-480.webp', 480]] as const) {
      expect(webpSize(file(path))).toEqual({ width, height: (width * 2) / 3 });
    }
    for (const [path, size] of [['public/branding/eje-mark-192.webp', 192], ['public/branding/eje-mark-96.webp', 96]] as const) {
      expect(webpSize(file(path))).toEqual({ width: size, height: size });
    }
    for (const [path, size] of [
      ['public/icons/icon-192.png', 192],
      ['public/icons/icon-512.png', 512],
      ['public/icons/icon-maskable-512.png', 512],
      ['public/icons/apple-touch-icon.png', 180],
      ['public/icons/icon-64.png', 64],
    ] as const) {
      expect(pngSize(file(path))).toEqual({ width: size, height: size });
    }
  });
});

describe('the logo in the application', () => {
  it('the sign-in screen, the sidebar (and phone menu) and the top bar show it', () => {
    expect(source('src/components/layout/SignInGate.tsx')).toMatch(/<LogoFull\b/u);
    expect(source('src/components/layout/SignInGate.tsx')).toMatch(/<Logo\b/u);
    expect(source('src/components/layout/Sidebar.tsx')).toMatch(/<Logo\b/u);
    expect(source('src/components/layout/TopBar.tsx')).toMatch(/<LogoMark\b/u);
  });

  it('every logo file the interface names exists', () => {
    const present = new Set(readdirSync(join(ROOT, 'public', 'branding')));
    const named = [
      ...[...source('src/components/layout/Logo.tsx').matchAll(/\/branding\/([\w.-]+)/gu)].map((match) => match[1]!),
      ...PRECACHE_PATHS.filter((path) => path.startsWith('/branding/')).map((path) => path.slice('/branding/'.length)),
    ];
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) expect(present, name).toContain(name);
    for (const icon of manifest().icons ?? []) expect(() => file(join('public', icon.src))).not.toThrow();
    expect(source('src/app/layout.tsx')).toContain("url: '/icons/icon-64.png'");
  });

  it('is kept for offline use', () => {
    expect(CACHEABLE_PREFIXES).toContain('/branding/');
    expect(isCacheablePath('/branding/eje-mark-96.webp')).toBe(true);
    expect(PRECACHE_PATHS).toContain('/branding/eje-mark-96.webp');
  });

  it('is hidden when a page is printed: both logo images carry print:hidden', () => {
    const images = [...source('src/components/layout/Logo.tsx').matchAll(/<img[\s\S]*?\/>/gu)].map((match) => match[0]);
    expect(images).toHaveLength(2);
    for (const image of images) expect(image).toContain('print:hidden');
  });
});

describe('the logo is never on a document', () => {
  it('only the interface files name it — no document, PDF renderer, print layout, route or job card component', () => {
    const scanned = ['src', 'scripts'].flatMap(sourcesUnder);
    // Not vacuous: the scan reaches the renderers and the document components it guards.
    for (const guarded of ['src/services/simulated/job-card-pdf.ts', 'src/components/jobs/JobCardDocument.tsx']) {
      expect(scanned.map(normalise)).toContain(guarded);
    }
    const offenders = scanned
      .filter((path) => normalise(path) !== 'scripts/generate-brand-assets.mjs')
      .filter((path) => NAMES_THE_LOGO.test(source(path)))
      .filter((path) => !INTERFACE_FILES.has(normalise(path)));
    expect(offenders.map((path) => normalise(relative('.', path)))).toEqual([]);
  });

  it('the PDF code has no image of its own: nothing under the renderers embeds a logo', () => {
    for (const path of [...sourcesUnder('src/services'), ...sourcesUnder('src/lib/pdf'), ...sourcesUnder('src/lib/job-card')]) {
      expect(source(path), path).not.toMatch(/branding|BrandMark|LogoMark|eje-logo|eje-mark|EJE Icon/u);
    }
  });

  it('an issued job card embeds no image (EJE-1044 has no photograph)', async () => {
    const card = await loadFinalDocumentFile(buildHarness().as(seedUser('user-master-elmarie')), 'EJE-1044');
    expect(imageObjects(card.bytes)).toBe(0);
  });

  it('a delivery note embeds no image', () => {
    const { bytes } = renderDeliveryNotePdf({
      title: 'Delivery Note',
      company: { name: 'EJE Industrial Electronics', address: '1 Test Road, Vereeniging', contactLine: '016 000 0000 · office@example.test' },
      jobNumber: 'EJE-9001',
      deliverTo: ['Customer (Pty) Ltd', '2 Plant Road'],
      details: [{ label: 'Job number', value: 'EJE-9001' }],
      items: [{ kind: 'Part', partNumber: 'P-1', description: 'Relay', quantity: '1' }],
      totalQuantity: '1',
      priceNote: 'No prices on this copy.',
      signature: null,
      footer: 'EJE Industrial Electronics · Delivery Note',
    });
    expect(imageObjects(bytes)).toBe(0);
  });

  it('a timesheet — one page and several — embeds no image', () => {
    const doc = (rows: number): TimesheetDocument => ({
      companyName: 'EJE Industrial Electronics',
      technicianName: 'Test Technician',
      fileName: 'TEST.pdf',
      from: '2026-10-01',
      to: '2026-10-31',
      periodLabel: 'Oct 2026',
      rows: Array.from({ length: rows }, (_, index) => ({
        date: `2026-10-${String((index % 28) + 1).padStart(2, '0')}`,
        weekday: 'Mon',
        customer: 'Customer',
        recorded: true,
        overtimeHours: 1,
        doubleHours: 0,
        calloutAmount: 0,
        calloutShared: false,
        internalKm: 0,
        customerKm: 0,
        historicalNormalHours: 0,
        historicalCallouts: 0,
      })),
      comment: '',
      totals: { overtimeHours: rows, doubleHours: 0, calloutAmount: 0, internalKm: 0, customerKm: 0, historicalNormalHours: 0, historicalCallouts: 0 },
      submittedAt: '2026-10-31T15:00:00.000Z',
      submittedByName: 'Test Technician',
      versionLabel: 'Original',
      inForce: true,
      absences: [],
    });
    const one = renderTimesheetPdf(doc(10), { generatedAt: '2026-10-31T16:00:00.000Z' });
    expect(one.pageCount).toBe(1);
    expect(imageObjects(one.bytes)).toBe(0);
    const many = renderTimesheetPdf(doc(400), { generatedAt: '2026-10-31T16:00:00.000Z' });
    expect(many.pageCount).toBeGreaterThan(1);
    expect(imageObjects(many.bytes)).toBe(0);
  });

  it('an attendance form embeds no image', () => {
    const month = Array.from({ length: 31 }, (_, index) => ({
      date: `2026-10-${String(index + 1).padStart(2, '0')}`,
      status: index % 7 === 6 ? null : ('present' as const),
      absenceReason: null,
      note: '',
    }));
    const doc: AttendanceDocument = {
      companyName: 'EJE Industrial Electronics',
      technicianName: 'Test Technician',
      fileName: 'TEST ATTEN OCTOBER.pdf',
      month: '2026-10',
      monthLabel: 'October 2026',
      ...buildAttendanceRows(month, '2026-10-31'),
      submittedAt: '2026-10-31T15:00:00.000Z',
      submittedByName: 'Test Technician',
      versionLabel: 'Original',
      inForce: true,
      changedAfterSubmission: [],
    };
    expect(imageObjects(renderAttendancePdf(doc, { generatedAt: '2026-10-31T16:00:00.000Z' }).bytes)).toBe(0);
  });
});
