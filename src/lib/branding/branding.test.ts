import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brandMark } from './pdf-brand';
import { PDF_MARK_SIZE } from './pdf-mark';
import { renderDeliveryNotePdf } from '@/services/simulated/delivery-note-pdf';
import { renderTimesheetPdf } from '@/services/simulated/timesheet-pdf';
import type { TimesheetDocument } from '@/application/timesheets';
import { CACHEABLE_PREFIXES, PRECACHE_PATHS, isCacheablePath } from '@/lib/pwa/shell';
import manifest from '@/app/manifest';

/**
 * BRAND-1: EJE's official logo, and only that, throughout.
 *
 * The source is the owner's file, unchanged; every asset is a crop or a scale of it with
 * its proportions kept; every referenced file exists; and each kind of generated PDF
 * carries the mark exactly once.
 */

const ROOT = process.cwd();
const file = (path: string) => readFileSync(join(ROOT, path));

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

/** How many times the brand mark's exact JPEG stream is embedded in a PDF. */
const markCount = (pdf: Uint8Array): number => {
  const haystack = Buffer.from(pdf);
  const needle = Buffer.from(brandMark().data);
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) count += 1;
  return count;
};

describe('the official logo', () => {
  it('is the file EJE supplied, unchanged: 1536 × 1024 JPEG', () => {
    const source = file('public/branding/eje-logo-original.jpg');
    expect(createHash('sha256').update(source).digest('hex')).toBe(OFFICIAL_SHA256);
    expect(jpegSize(source)).toEqual({ width: 1536, height: 1024 });
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

  it('every branding file a page names exists', () => {
    const present = new Set(readdirSync(join(ROOT, 'public', 'branding')));
    const named = [
      ...[...file('src/components/layout/Logo.tsx').toString('utf8').matchAll(/\/branding\/([\w.-]+)/gu)].map((match) => match[1]!),
      ...PRECACHE_PATHS.filter((path) => path.startsWith('/branding/')).map((path) => path.slice('/branding/'.length)),
    ];
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) expect(present, name).toContain(name);
    for (const icon of manifest().icons ?? []) expect(() => file(join('public', icon.src))).not.toThrow();
  });

  it('the service worker keeps the mark for offline use', () => {
    expect(CACHEABLE_PREFIXES).toContain('/branding/');
    expect(isCacheablePath('/branding/eje-mark-96.webp')).toBe(true);
    expect(PRECACHE_PATHS).toContain('/branding/eje-mark-96.webp');
  });
});

describe('the mark on generated PDFs', () => {
  it('is the square crop, embedded as the JPEG it is', () => {
    const mark = brandMark();
    expect({ width: mark.width, height: mark.height }).toEqual({ width: PDF_MARK_SIZE, height: PDF_MARK_SIZE });
    expect(mark.filter).toBe('DCTDecode');
    expect(mark.colorSpace).toBe('DeviceRGB');
  });

  it('the delivery note carries it once, and still names the company', () => {
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
    expect(markCount(bytes)).toBe(1);
    expect(Buffer.from(bytes).toString('latin1')).toContain('EJE Industrial Electronics');
  });

  it('a timesheet carries it once on one page, and once (shared) across several', () => {
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
    expect(markCount(one.bytes)).toBe(1);
    const many = renderTimesheetPdf(doc(400), { generatedAt: '2026-10-31T16:00:00.000Z' });
    expect(many.pageCount).toBeGreaterThan(1);
    expect(markCount(many.bytes)).toBe(1);
  });
});
