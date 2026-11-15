-- 0058 — two companies, EJE and WD Hearn JHB (MULTI-CO-1), 15 November 2026.
--
-- The owner's requirement: the system serves two companies, "EJE" (everything
-- that exists today, and the default) and "WD Hearn JHB" (new). Every job
-- belongs to exactly one company, fixed when it is raised. A customer belongs
-- to one company or to both; its sites, contacts and machines are shared within
-- the customer. Each company numbers its own jobs — EJE-, WDJ- — from its own
-- sequence, and has its own details, letterhead, notification sender and rates.
--
-- ADDITIVE. Two new tables, one new column with a default, one index swapped,
-- three triggers, one function. No existing row is rewritten except to record
-- what is already true: every existing job and every existing customer is
-- EJE's. No column is dropped: `system_settings` keeps its company and rate
-- columns, because the live release reads them (see ROLLBACK).
--
-- NOTHING ABOUT WD HEARN IS INVENTED. It is created with its name, its prefix
-- and a start of 1, and EMPTY registration, VAT number, addresses, telephone,
-- fax, email and letterhead: the office captures those. Its rates are a COPY
-- of EJE's current rates — an editable starting point the office must confirm,
-- not WD Hearn's agreed rates.
--
-- JOB NUMBERS STAY GLOBALLY UNIQUE. `job_number` is the URL, the storage key of
-- every issued document, the tablet's offline key and the audit trail's key, so
-- `jobs_job_number_key` is kept, and two companies' prefixes may never be
-- equal or one a prefix of the other (enforced below, in the database). What
-- changes is the SEQUENCE: `job_number_seq` is now unique per company, because
-- EJE-0001 and WDJ-0001 are both sequence 1.
--
-- EJE KEEPS ITS SEQUENCE. `allocate_company_job_number('eje')` draws from
-- `eje_job_number_seq`, exactly the sequence `allocate_job_number()` draws
-- from, so the live release and this one can never hand out the same EJE
-- number whichever of them is running. Another company counts in its own row
-- (`next_job_sequence`), incremented by one UPDATE whose row lock is the
-- concurrency protection: a second person raising a WD Hearn job waits for the
-- first transaction and is handed the next number, never the same one. Because
-- the counter rolls back with the transaction, WD Hearn's numbers have no gaps.
--
-- ROLLBACK. The live release (8eb6aa4, v1.11.0) has never heard of companies:
--   - it inserts jobs without `company_id`; the DEFAULT 'eje' makes every such
--     job EJE's, which is the only company it knows;
--   - it inserts customers without a company link; `customers_link_default_
--     company` links every new customer to EJE, so none is ever left with no
--     company;
--   - it calls `allocate_job_number()`, unchanged, which still reads the prefix
--     from `system_settings` and draws from `eje_job_number_seq`. Its numbers
--     are unpadded (EJE-2121), which is the same text for any number of four
--     digits or more — every EJE number already issued;
--   - it saves company details and rates into `system_settings`; the
--     `system_settings_mirror_to_eje` trigger copies them onto the EJE company,
--     so nothing it saves is lost when the release is rolled forward, and this
--     release mirrors EJE's details back the other way;
--   - it orders jobs by `job_number_seq`, which still works, and reads a WD
--     Hearn job as an ordinary job (it shows EJE's letterhead on it, which is
--     the cosmetic cost of a rollback and is recorded as such).

CREATE TABLE IF NOT EXISTS "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"registration" text DEFAULT '' NOT NULL,
	"vat_number" text DEFAULT '' NOT NULL,
	"physical_address" text DEFAULT '' NOT NULL,
	"postal_address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"fax" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"notification_sender_name" text DEFAULT '' NOT NULL,
	"notification_reply_to" text DEFAULT '' NOT NULL,
	"letterhead_storage_key" text,
	"letterhead_content_type" text,
	"letterhead_sha256" text,
	"letterhead_uploaded_at" timestamp with time zone,
	"letterhead_uploaded_by" uuid,
	"job_number_prefix" text NOT NULL,
	"job_number_start" integer NOT NULL,
	"next_job_sequence" integer,
	"last_issued_job_sequence" integer,
	"labour_normal_cents" bigint DEFAULT 0 NOT NULL,
	"labour_overtime_cents" bigint DEFAULT 0 NOT NULL,
	"labour_double_cents" bigint DEFAULT 0 NOT NULL,
	"callout_rate_cents" bigint DEFAULT 0 NOT NULL,
	"test_bench_fee_cents" bigint DEFAULT 0 NOT NULL,
	"kilometre_rate_cents" bigint DEFAULT 0 NOT NULL,
	"vat_percent_basis_points" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "companies_letterhead_uploaded_by_fk" FOREIGN KEY ("letterhead_uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "companies_updated_by_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action,
	-- 1–8 capitals or digits and a closing hyphen: EJE-, WDJ-. The hyphen is what
	-- keeps the number readable as a number (the repository reads the trailing
	-- digits as the sequence), and capitals only make the prefix comparison exact.
	CONSTRAINT "companies_job_number_prefix_shape" CHECK ("job_number_prefix" ~ '^[A-Z0-9]{1,8}-$'),
	CONSTRAINT "companies_job_number_start_positive" CHECK ("job_number_start" >= 1),
	-- EJE counts in `eje_job_number_seq` and has no counter here; every other
	-- company counts here, never below its start, and remembers the last number
	-- it handed out — what stops the start ever being moved back over issued
	-- numbers, even once the jobs that carried them have been deleted.
	CONSTRAINT "companies_counter_where_it_belongs" CHECK (
		("id" = 'eje' AND "next_job_sequence" IS NULL AND "last_issued_job_sequence" IS NULL)
		OR ("id" <> 'eje' AND "next_job_sequence" IS NOT NULL AND "next_job_sequence" >= "job_number_start"
			AND ("last_issued_job_sequence" IS NULL OR "last_issued_job_sequence" < "next_job_sequence"))
	),
	-- A letterhead is a stored file or nothing: never a key without its type and checksum.
	CONSTRAINT "companies_letterhead_complete" CHECK (
		("letterhead_storage_key" IS NULL AND "letterhead_content_type" IS NULL AND "letterhead_sha256" IS NULL AND "letterhead_uploaded_at" IS NULL)
		OR ("letterhead_storage_key" IS NOT NULL AND "letterhead_content_type" IS NOT NULL AND "letterhead_sha256" ~ '^[0-9a-f]{64}$' AND "letterhead_uploaded_at" IS NOT NULL)
	),
	CONSTRAINT "companies_rates_non_negative" CHECK ("labour_normal_cents" >= 0 AND "labour_overtime_cents" >= 0 AND "labour_double_cents" >= 0 AND "callout_rate_cents" >= 0 AND "test_bench_fee_cents" >= 0 AND "kilometre_rate_cents" >= 0 AND "vat_percent_basis_points" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "companies_code_key" ON "companies" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "companies_job_number_prefix_key" ON "companies" USING btree ("job_number_prefix");--> statement-breakpoint
-- Exactly one default: at most one by this index, at least one because the
-- repository never clears the flag and EJE is created holding it.
CREATE UNIQUE INDEX IF NOT EXISTS "companies_one_default" ON "companies" USING btree ("is_default") WHERE "is_default";--> statement-breakpoint

-- EJE, FROM WHAT THE SETTINGS ROW ALREADY SAYS. A database with no settings row
-- yet (a fresh test database, before its seed) still gets the company, because
-- every job needs one: its name reads "EJE" and its rates 0 until the settings
-- row is written, at which point the mirror trigger below fills them in.
-- `job_number_start` for EJE is where its sequence stands now: EJE was numbering
-- long before companies existed, and the number its next job will carry is the
-- only start that cannot reset anything.
INSERT INTO "companies" (
	"id", "code", "name", "registration", "vat_number", "physical_address", "phone", "email",
	"job_number_prefix", "job_number_start", "next_job_sequence",
	"labour_normal_cents", "labour_overtime_cents", "labour_double_cents", "callout_rate_cents",
	"test_bench_fee_cents", "kilometre_rate_cents", "vat_percent_basis_points", "is_default"
)
SELECT
	'eje', 'EJE', COALESCE(s."company_name", 'EJE'), COALESCE(s."company_registration", ''),
	COALESCE(s."company_vat_number", ''), COALESCE(s."company_address", ''),
	COALESCE(s."company_phone", ''), COALESCE(s."company_email", ''),
	COALESCE(s."job_number_prefix", 'EJE-'),
	(SELECT CASE WHEN q."is_called" THEN q."last_value" + 1 ELSE q."last_value" END FROM "eje_job_number_seq" q)::integer,
	NULL,
	COALESCE(s."labour_normal_cents", 0), COALESCE(s."labour_overtime_cents", 0), COALESCE(s."labour_double_cents", 0),
	COALESCE(s."callout_rate_cents", 0), COALESCE(s."test_bench_fee_cents", 0), COALESCE(s."kilometre_rate_cents", 0),
	COALESCE(s."vat_percent_basis_points", 0), true
FROM (SELECT 1) AS one
LEFT JOIN "system_settings" s ON s."id" = 1
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- WD HEARN JHB, with nothing invented. The rates are EJE's, COPIED as an
-- editable starting point the office must confirm.
INSERT INTO "companies" (
	"id", "code", "name", "job_number_prefix", "job_number_start", "next_job_sequence",
	"labour_normal_cents", "labour_overtime_cents", "labour_double_cents", "callout_rate_cents",
	"test_bench_fee_cents", "kilometre_rate_cents", "vat_percent_basis_points", "is_default"
)
SELECT
	'wd-hearn-jhb', 'WDJ', 'WD Hearn JHB', 'WDJ-', 1, 1,
	e."labour_normal_cents", e."labour_overtime_cents", e."labour_double_cents", e."callout_rate_cents",
	e."test_bench_fee_cents", e."kilometre_rate_cents", e."vat_percent_basis_points", false
FROM "companies" e
WHERE e."id" = 'eje'
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

-- WHICH COMPANIES A CUSTOMER BELONGS TO: one or both. Its sites, contacts and
-- machines are the customer's and are shared between them.
CREATE TABLE IF NOT EXISTS "customer_companies" (
	"customer_id" uuid NOT NULL,
	"company_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_companies_pkey" PRIMARY KEY ("customer_id", "company_id"),
	CONSTRAINT "customer_companies_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "customer_companies_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_companies_company_idx" ON "customer_companies" USING btree ("company_id");--> statement-breakpoint
-- Every existing customer is EJE's: nobody else's existed.
INSERT INTO "customer_companies" ("customer_id", "company_id")
SELECT c."id", 'eje' FROM "customers" c
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- A customer inserted by code that does not name a company — the live release,
-- after a rollback — is EJE's, the only company that code knows. This release
-- writes the customer's links straight after the insert, in the same
-- transaction, so a WD Hearn-only customer loses this EJE link before anything
-- can read it.
CREATE OR REPLACE FUNCTION "customers_link_default_company"() RETURNS trigger AS $$
BEGIN
  INSERT INTO "customer_companies" ("customer_id", "company_id")
  VALUES (NEW."id", 'eje')
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "customers_link_default_company" ON "customers";--> statement-breakpoint
CREATE TRIGGER "customers_link_default_company"
  AFTER INSERT ON "customers"
  FOR EACH ROW EXECUTE FUNCTION "customers_link_default_company"();
--> statement-breakpoint

-- EVERY JOB'S COMPANY. The constant default fills every existing row (they are
-- all EJE's) without rewriting the table, and keeps the live release's inserts
-- working.
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "company_id" text DEFAULT 'eje' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_company_idx" ON "jobs" USING btree ("company_id");--> statement-breakpoint
-- The sequence is unique per company now; the job number stays unique overall.
DROP INDEX IF EXISTS "jobs_job_number_seq_key";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "jobs_company_job_number_seq_key" ON "jobs" USING btree ("company_id", "job_number_seq");--> statement-breakpoint

-- A JOB'S COMPANY IS FIXED WHEN IT IS RAISED. Its number, its letterhead and
-- its rates all follow from it, so moving a job to the other company would
-- leave an EJE- number on a WD Hearn job card. Refused here, whatever the
-- caller, rather than remembered by every caller.
CREATE OR REPLACE FUNCTION "jobs_company_immutable"() RETURNS trigger AS $$
BEGIN
  IF NEW."company_id" IS DISTINCT FROM OLD."company_id" THEN
    RAISE EXCEPTION 'job % belongs to company % and cannot be moved to %: a job''s company is fixed when it is raised',
      OLD."job_number", OLD."company_id", NEW."company_id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "jobs_company_immutable" ON "jobs";--> statement-breakpoint
CREATE TRIGGER "jobs_company_immutable"
  BEFORE UPDATE OF "company_id" ON "jobs"
  FOR EACH ROW EXECUTE FUNCTION "jobs_company_immutable"();
--> statement-breakpoint

-- NO TWO COMPANIES' NUMBERS CAN EVER LOOK ALIKE. A prefix equal to another
-- company's, or one that is a prefix of it (or it of this), is refused; so is
-- one that another company's EXISTING job numbers already begin with — a
-- prefix changed after its jobs were issued still owns those numbers.
CREATE OR REPLACE FUNCTION "companies_prefix_distinct"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "companies" other
    WHERE other."id" <> NEW."id"
      AND (left(other."job_number_prefix", length(NEW."job_number_prefix")) = NEW."job_number_prefix"
        OR left(NEW."job_number_prefix", length(other."job_number_prefix")) = other."job_number_prefix")
  ) THEN
    RAISE EXCEPTION 'job number prefix % conflicts with another company''s prefix', NEW."job_number_prefix"
      USING ERRCODE = 'unique_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "jobs" j
    WHERE j."company_id" <> NEW."id"
      AND upper(left(j."job_number", length(NEW."job_number_prefix"))) = NEW."job_number_prefix"
  ) THEN
    RAISE EXCEPTION 'job number prefix % is already used by another company''s job numbers', NEW."job_number_prefix"
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "companies_prefix_distinct" ON "companies";--> statement-breakpoint
CREATE TRIGGER "companies_prefix_distinct"
  BEFORE INSERT OR UPDATE OF "job_number_prefix" ON "companies"
  FOR EACH ROW EXECUTE FUNCTION "companies_prefix_distinct"();
--> statement-breakpoint

-- WHAT THE SETTINGS ROW SAYS ABOUT EJE, THE EJE COMPANY SAYS TOO. The live
-- release (and, until the company screens exist, this one's settings screen)
-- writes EJE's details and rates into `system_settings`; this copies them onto
-- the EJE company so the two never disagree. A second writer of the row, so it
-- bumps `version`: a company editor holding the old values loses, as it should.
-- Only when something differs, so this release's own mirror the other way —
-- the company saved, then the settings row — comes back as a no-op.
CREATE OR REPLACE FUNCTION "system_settings_mirror_to_eje"() RETURNS trigger AS $$
BEGIN
  UPDATE "companies" c SET
    "name" = NEW."company_name",
    "registration" = NEW."company_registration",
    "vat_number" = NEW."company_vat_number",
    "physical_address" = NEW."company_address",
    "phone" = NEW."company_phone",
    "email" = NEW."company_email",
    "job_number_prefix" = NEW."job_number_prefix",
    "labour_normal_cents" = NEW."labour_normal_cents",
    "labour_overtime_cents" = NEW."labour_overtime_cents",
    "labour_double_cents" = NEW."labour_double_cents",
    "callout_rate_cents" = NEW."callout_rate_cents",
    "test_bench_fee_cents" = NEW."test_bench_fee_cents",
    "kilometre_rate_cents" = NEW."kilometre_rate_cents",
    "vat_percent_basis_points" = NEW."vat_percent_basis_points",
    "updated_at" = now(),
    "version" = c."version" + 1
  WHERE c."id" = 'eje'
    AND (c."name", c."registration", c."vat_number", c."physical_address", c."phone", c."email",
         c."job_number_prefix", c."labour_normal_cents", c."labour_overtime_cents", c."labour_double_cents",
         c."callout_rate_cents", c."test_bench_fee_cents", c."kilometre_rate_cents", c."vat_percent_basis_points")
        IS DISTINCT FROM
        (NEW."company_name", NEW."company_registration", NEW."company_vat_number", NEW."company_address",
         NEW."company_phone", NEW."company_email", NEW."job_number_prefix", NEW."labour_normal_cents"::bigint,
         NEW."labour_overtime_cents"::bigint, NEW."labour_double_cents"::bigint, NEW."callout_rate_cents"::bigint,
         NEW."test_bench_fee_cents"::bigint, NEW."kilometre_rate_cents"::bigint, NEW."vat_percent_basis_points");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "system_settings_mirror_to_eje" ON "system_settings";--> statement-breakpoint
CREATE TRIGGER "system_settings_mirror_to_eje"
  AFTER INSERT OR UPDATE ON "system_settings"
  FOR EACH ROW EXECUTE FUNCTION "system_settings_mirror_to_eje"();
--> statement-breakpoint

-- THE NEXT JOB NUMBER FOR A COMPANY, zero-padded to at least four digits
-- (WDJ-0001; EJE-2121 is unchanged, and EJE-12345 keeps all five).
--
-- EJE draws from `eje_job_number_seq` — the very sequence `allocate_job_number()`
-- draws from, so the live release and this one never collide. Any other
-- company increments its own row: the UPDATE takes the row lock, so two
-- callers are served one after the other and never handed the same number.
-- An unknown company is refused rather than given EJE's numbering.
CREATE OR REPLACE FUNCTION "allocate_company_job_number"(p_company text, OUT seq integer, OUT job_number text)
LANGUAGE plpgsql
AS $$
DECLARE
  prefix text;
  digits text;
BEGIN
  IF p_company = 'eje' THEN
    SELECT c."job_number_prefix" INTO prefix FROM "companies" c WHERE c."id" = 'eje';
    IF prefix IS NULL THEN
      RAISE EXCEPTION 'the EJE company is missing; migration 0058 has not run' USING ERRCODE = 'no_data_found';
    END IF;
    seq := nextval('eje_job_number_seq');
  ELSE
    UPDATE "companies" c
       SET "next_job_sequence" = c."next_job_sequence" + 1,
           "last_issued_job_sequence" = c."next_job_sequence"
     WHERE c."id" = p_company
    RETURNING c."next_job_sequence" - 1, c."job_number_prefix" INTO seq, prefix;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'there is no company %', p_company USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  digits := seq::text;
  IF length(digits) < 4 THEN
    digits := lpad(digits, 4, '0');
  END IF;
  job_number := prefix || digits;
END;
$$;
