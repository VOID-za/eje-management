-- 0059 — blank account numbers, and who released the parts. 17 November 2026.
--
-- CUST-ACCT-1. `customers.account_number` is NOT NULL and '' means "no account number", but the
-- unique index counted '' as a value: once one customer had no account number, every later customer
-- created without one was refused by the database ("Something went wrong"). The index becomes PARTIAL —
-- unique only where there is a number — so any number of customers may have none, and two customers can
-- still never share a real number. NO ROW IS REWRITTEN: the column, its NOT NULL and its '' stay as they
-- are, and every existing non-blank number was already unique under the old index, so the new one is
-- built over the same rows without a conflict.
--
-- JOB-CARD-3. `jobs.parts_released_by`: the member of staff who handed the goods over at the counter,
-- printed as "Released by" on a Parts Collection Note. NULLABLE and ADDITIVE: every existing job reads
-- null ("Not recorded") — no releaser is guessed for history.
--
-- ROLLBACK (to v1.15.0, dcdcb84): the live code never reads parts_released_by, and its customer insert
-- works against the partial index (it only succeeds MORE often). Nothing here needs to be undone for the
-- previous release to run. To reverse it by hand: drop the column, and recreate the full index — which
-- would fail while two customers have a blank number, exactly the state that index could not allow.

DROP INDEX "customers_account_number_key";--> statement-breakpoint
CREATE UNIQUE INDEX "customers_account_number_key" ON "customers" USING btree ("account_number") WHERE btrim("account_number") <> '';--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "parts_released_by" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_parts_released_by_users_id_fk" FOREIGN KEY ("parts_released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
