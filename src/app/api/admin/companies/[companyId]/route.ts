import { z } from 'zod';
import { writeRoute } from '@/server/api/handler';
import { updateCompany } from '@/application/company-operations';

/**
 * One company's details, notification sender, numbering and rates.
 * MULTI-CO-1. The same people as the settings (`settings.rates`), enforced by
 * `updateCompany`; every change audited from → to.
 *
 * NOT HERE, deliberately: the company's id, short code and whether it is the
 * default (fixed), the next job number (only ever moved by the start rule) and
 * the letterhead (uploaded, stage D). `.strict()` refuses them rather than
 * ignoring them, so a client cannot believe it set one.
 */
const cents = z.number().int().nonnegative().max(100_000_000);
const text = (max: number) => z.string().max(max);

const updateCompanySchema = z
  .object({
    details: z
      .object({
        name: z.string().min(1).max(200),
        registration: text(60),
        vatNumber: text(60),
        physicalAddress: text(500),
        postalAddress: text(500),
        phone: text(60),
        fax: text(60),
        email: text(320),
      })
      .partial()
      .strict()
      .optional(),
    notifications: z
      .object({ senderName: text(200), replyTo: text(320) })
      .partial()
      .strict()
      .optional(),
    numbering: z
      .object({
        jobNumberPrefix: text(20),
        jobNumberStart: z.number().int().min(1).max(2_147_483_647),
      })
      .partial()
      .strict()
      .optional(),
    rates: z
      .object({
        labourRates: z.object({ normal: cents, overtime: cents, double: cents }).strict(),
        calloutRate: cents,
        testBenchFee: cents,
        kilometreRate: cents,
        vatPercentage: z.number().nonnegative().max(100),
      })
      .strict()
      .optional(),
  })
  .strict();

export const PATCH = writeRoute({
  operation: 'companies.update',
  schema: updateCompanySchema,
  handler: (context) => updateCompany(context.operation, context.params.companyId ?? '', context.input),
});
