import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { cents, createdAt, instant, rowVersion, updatedAt } from './columns';
import { customers } from './customers';
import { users } from './identity';

/**
 * The companies the system serves: EJE and WD Hearn JHB. MULTI-CO-1, migration
 * `0058_multi_company.sql`, which is where the triggers that hold the rules
 * live — the job number prefix distinct from every other company's, EJE's
 * details mirrored from `system_settings`, a job's company fixed.
 *
 * `next_job_sequence` IS A COUNTER IN A MUTABLE ROW, and that is safe here
 * where it was not in the demo's settings: it is only ever advanced by
 * `allocate_company_job_number()`, whose single `UPDATE … RETURNING` takes the
 * row lock, so two allocations are served one after the other. EJE has none —
 * it keeps `eje_job_number_seq`, which the release before this one shares.
 */
export const companies = pgTable(
  'companies',
  {
    /** Stable text ids: `eje`, `wd-hearn-jhb`. */
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    registration: text('registration').notNull().default(''),
    vatNumber: text('vat_number').notNull().default(''),
    physicalAddress: text('physical_address').notNull().default(''),
    postalAddress: text('postal_address').notNull().default(''),
    phone: text('phone').notNull().default(''),
    fax: text('fax').notNull().default(''),
    email: text('email').notNull().default(''),
    notificationSenderName: text('notification_sender_name').notNull().default(''),
    notificationReplyTo: text('notification_reply_to').notNull().default(''),

    /* The uploaded letterhead: all four, or none (database check). */
    letterheadStorageKey: text('letterhead_storage_key'),
    letterheadContentType: text('letterhead_content_type'),
    letterheadSha256: text('letterhead_sha256'),
    letterheadUploadedAt: instant('letterhead_uploaded_at'),
    letterheadUploadedBy: uuid('letterhead_uploaded_by').references(() => users.id),

    jobNumberPrefix: text('job_number_prefix').notNull(),
    jobNumberStart: integer('job_number_start').notNull(),
    /** Null for EJE, whose counter is `eje_job_number_seq`. */
    nextJobSequence: integer('next_job_sequence'),
    /** The last number handed out; null until the first. Null for EJE. */
    lastIssuedJobSequence: integer('last_issued_job_sequence'),

    /* Charge-out rates, in cents, as `system_settings` carries EJE's. */
    labourNormalCents: cents('labour_normal_cents').notNull().default(0),
    labourOvertimeCents: cents('labour_overtime_cents').notNull().default(0),
    labourDoubleCents: cents('labour_double_cents').notNull().default(0),
    calloutRateCents: cents('callout_rate_cents').notNull().default(0),
    testBenchFeeCents: cents('test_bench_fee_cents').notNull().default(0),
    kilometreRateCents: cents('kilometre_rate_cents').notNull().default(0),
    vatPercentBasisPoints: integer('vat_percent_basis_points').notNull().default(0),

    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    updatedBy: uuid('updated_by').references(() => users.id),
    version: rowVersion(),
  },
  (table) => [
    uniqueIndex('companies_code_key').on(table.code),
    uniqueIndex('companies_job_number_prefix_key').on(table.jobNumberPrefix),
    uniqueIndex('companies_one_default').on(table.isDefault).where(sql`${table.isDefault}`),
    check('companies_job_number_prefix_shape', sql`${table.jobNumberPrefix} ~ '^[A-Z0-9]{1,8}-$'`),
    check('companies_job_number_start_positive', sql`${table.jobNumberStart} >= 1`),
  ],
);

/** Which companies a customer belongs to: one or both. MULTI-CO-1. */
export const customerCompanies = pgTable(
  'customer_companies',
  {
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ name: 'customer_companies_pkey', columns: [table.customerId, table.companyId] }),
    index('customer_companies_company_idx').on(table.companyId),
  ],
);
