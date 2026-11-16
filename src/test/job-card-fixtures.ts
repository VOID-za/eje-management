import type {
  AdditionalChargeEntry,
  Attachment,
  IsoDate,
  IsoDateTime,
  Job,
  LabourEntry,
  LabourRateType,
  PartEntry,
  TravelEntry,
} from '@/domain';
import type { PreparedPhoto } from '@/lib/pdf/image';
import { preparePdfImage } from '@/lib/pdf/image';
import { documentPhotos } from '@/lib/job-card/model';
import type { FinalDocumentSource } from '@/services/ports';
import { letterheadPng } from './letterhead-fixture';

/**
 * JOB-CARD-2: job cards with the work a real month produces — labour on several days at several rates,
 * several trips, several parts, the call-out, other charges, a discount, photographs — built on a
 * seeded job, so the redesigned table, the acceptance block and the photographs page can be tested
 * against what the records actually say. Test-only.
 */
export interface WorkLines {
  readonly labour?: readonly { readonly date: string; readonly rateType: LabourRateType; readonly hours: number; readonly description: string }[];
  readonly travel?: readonly { readonly date: string; readonly kilometres: number; readonly description: string }[];
  readonly parts?: readonly { readonly partNumber: string; readonly description: string; readonly quantity: number; readonly unitPriceCents: number }[];
  readonly additional?: readonly { readonly description: string; readonly amountCents: number }[];
  readonly callout?: boolean;
  readonly discount?: { readonly amountCents: number; readonly reason: string };
  /** How many customer-facing photographs (copies of a seeded one), or keep the job's own. */
  readonly photos?: number;
}

const CAPTURED_AT = '2026-11-14T15:00:00.000Z' as IsoDateTime;

export const withWork = (source: FinalDocumentSource, lines: WorkLines, photoTemplate?: Attachment): FinalDocumentSource => {
  const job = source.job;
  const technician = job.primaryTechnicianId ?? job.labour[0]?.technicianId ?? source.users[0]!.id;
  const capturedBy = technician as LabourEntry['capturedBy'];
  const labour: LabourEntry[] = (lines.labour ?? []).map((entry, index) => ({
    id: `fixture-labour-${index}` as LabourEntry['id'],
    technicianId: technician as LabourEntry['technicianId'],
    date: entry.date as IsoDate,
    rateType: entry.rateType,
    hours: entry.hours,
    description: entry.description,
    capturedAt: CAPTURED_AT,
    capturedBy,
  }));
  const travel: TravelEntry[] = (lines.travel ?? []).map((entry, index) => ({
    id: `fixture-travel-${index}` as TravelEntry['id'],
    technicianId: technician as TravelEntry['technicianId'],
    date: entry.date as IsoDate,
    kilometres: entry.kilometres,
    description: entry.description,
    capturedAt: CAPTURED_AT,
    capturedBy,
  }));
  const parts: PartEntry[] = (lines.parts ?? []).map((entry, index) => ({
    id: `fixture-part-${index}` as PartEntry['id'],
    partNumber: entry.partNumber,
    description: entry.description,
    quantity: entry.quantity,
    unitPrice: entry.unitPriceCents as PartEntry['unitPrice'],
  }) as PartEntry);
  const additionalCharges: AdditionalChargeEntry[] = (lines.additional ?? []).map((entry, index) => ({
    id: `fixture-charge-${index}` as AdditionalChargeEntry['id'],
    description: entry.description,
    amount: entry.amountCents as AdditionalChargeEntry['amount'],
    capturedAt: CAPTURED_AT,
    capturedBy: capturedBy as AdditionalChargeEntry['capturedBy'],
  }));
  const template = photoTemplate ?? documentPhotos(job)[0];
  const photos: Job['photos'] =
    lines.photos === undefined || template === undefined
      ? job.photos
      : Array.from({ length: lines.photos }, (_, index) => ({
          ...template,
          id: `fixture-photo-${index}` as Attachment['id'],
          caption: `Photograph ${index + 1} of ${lines.photos} — ${['before the repair', 'the faulty component', 'after the repair', 'the cabinet', 'the nameplate'][index % 5]}`,
        }));
  const discount: Job['discount'] =
    lines.discount === undefined
      ? job.discount
      : {
          amount: lines.discount.amountCents as NonNullable<Job['discount']>['amount'],
          reason: lines.discount.reason,
          authorisedBy: capturedBy as NonNullable<Job['discount']>['authorisedBy'],
          authorisedAt: CAPTURED_AT,
        };
  return {
    ...source,
    job: {
      ...job,
      labour,
      travel,
      parts,
      additionalCharges,
      calloutApplied: lines.callout ?? job.calloutApplied,
      discount,
      photos,
    },
  };
};

/** Real, drawable images behind each customer-facing photograph (alternating landscape and portrait). */
export const photoImagesFor = async (job: Job): Promise<ReadonlyMap<string, PreparedPhoto>> => {
  const colours: [number, number, number][] = [[200, 60, 40], [40, 140, 60], [40, 80, 180], [190, 160, 30]];
  const images = new Map<string, PreparedPhoto>();
  let index = 0;
  for (const photo of documentPhotos(job)) {
    images.set(photo.id, await preparePdfImage(letterheadPng(index % 2 ? 480 : 640, index % 2 ? 640 : 480, colours[index % 4])));
    index += 1;
  }
  return images;
};
