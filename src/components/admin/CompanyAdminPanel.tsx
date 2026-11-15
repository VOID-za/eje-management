'use client';

import { useState } from 'react';
import { labourRateLabel, type LabourRateType } from '@/domain';
import type { CompanyAdminView } from '@/application/company-operations';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  LoadingPanel,
  QueryFailure,
  Tabs,
  TextAreaField,
  TextField,
} from '@/components/ui';
import { AdminNotice } from '@/components/admin/AdminNotice';
import { CompanyLetterheadCard } from '@/components/admin/CompanyLetterheadCard';
import { RuleViolationNotice } from '@/components/jobs/RuleViolationNotice';
import { companies as companiesApi, reads } from '@/api/endpoints';
import { useOperation } from '@/hooks/useOperation';
import { useQuery } from '@/hooks/useQuery';
import { formatCurrency } from '@/lib/format';
import {
  RATE_FIELDS,
  companyFormFrom,
  companyFormProblems,
  companyLabel,
  companyUpdateFrom,
  fieldForRefusal,
  nextJobNumberOf,
  type CompanyForm,
  type CompanyFormField,
  type CompanyFormProblems,
} from '@/lib/companies';

/**
 * THE COMPANIES, ADMINISTERED. MULTI-CO-1 (stage C).
 *
 * EJE and WD Hearn JHB are configured independently: each its own details (the
 * letterhead's lines), notification sender, job numbering and charge-out rates.
 * Every save goes through `companies.update` (PATCH /api/admin/companies/[id]),
 * which applies the numbering and email rules again and mirrors EJE into the
 * legacy settings row — the settings PATCH no longer carries any of it from
 * these screens.
 *
 * ONE EDITOR PER VALUE. `section="details"` (System → Company details) edits
 * the details, notifications and numbering and SHOWS the rates;
 * `section="rates"` (Rates & VAT) is the one place a company's rates are
 * edited. Both read the same companies list, so neither can show a stale copy
 * the other has changed.
 */
type Section = 'details' | 'rates';

export const CompanyAdminPanel = ({
  section,
  companyId,
  onCompanyChange,
  onOpenRates,
}: {
  readonly section: Section;
  /** Which company is shown — held by the page, so both tabs open on the same one. */
  readonly companyId: string;
  readonly onCompanyChange: (companyId: string) => void;
  /** Details only: takes the office to this company's rates. */
  readonly onOpenRates?: () => void;
}) => {
  const query = useQuery('admin:companies', () => reads.companies());
  const [savedFor, setSavedFor] = useState<string | null>(null);

  if (query.error !== null) {
    return <QueryFailure code={query.errorCode} message={query.error} onRetry={query.refetch} />;
  }
  const list = query.data;
  if (query.loading || list === null || list === undefined) {
    return <LoadingPanel rows={4} label="Loading the companies" />;
  }
  const company = list.find((candidate) => candidate.id === companyId) ?? list[0];
  if (company === undefined) return null;

  return (
    <div className="space-y-5" data-testid={`company-admin-${section}`}>
      <Tabs
        tabs={list.map((candidate) => ({ id: candidate.id, label: companyLabel(candidate.id) }))}
        activeId={company.id}
        onChange={(id) => {
          setSavedFor(null);
          onCompanyChange(id);
        }}
      />
      {/* Re-mounted per company and per save, so the form always starts from what the server holds. */}
      <CompanyEditor
        key={`${company.id}:${company.updatedAt}`}
        section={section}
        company={company}
        companies={list}
        saved={savedFor === `${section}:${company.id}`}
        onSaved={() => {
          setSavedFor(`${section}:${company.id}`);
          query.refetch();
        }}
        onEdited={() => setSavedFor(null)}
        onLetterheadChanged={() => query.refetch()}
        onOpenRates={onOpenRates}
      />
    </div>
  );
};

const DETAIL_FIELDS: readonly { readonly field: CompanyFormField; readonly label: string; readonly multiline?: boolean; readonly type?: string }[] = [
  { field: 'name', label: 'Company name' },
  { field: 'registration', label: 'Registration number' },
  { field: 'vatNumber', label: 'VAT number' },
  { field: 'phone', label: 'Telephone', type: 'tel' },
  { field: 'fax', label: 'Fax', type: 'tel' },
  { field: 'email', label: 'Email', type: 'email' },
  { field: 'physicalAddress', label: 'Physical address', multiline: true },
  { field: 'postalAddress', label: 'Postal address', multiline: true },
];

const MONEY_HINTS: Readonly<Record<string, (company: CompanyAdminView) => string>> = {
  callout: (company) => `Currently ${formatCurrency(company.rates.calloutRate)}. Charged once, on jobs where the office applies it.`,
  testBench: (company) =>
    `Currently ${formatCurrency(company.rates.testBenchFee)}. Charged once, on jobs where the test bench box is ticked. A signed job keeps the fee it was signed at.`,
  kilometre: (company) => `Currently ${formatCurrency(company.rates.kilometreRate)} per km. Travel is charged on distance only.`,
};

const CompanyEditor = ({
  section,
  company,
  companies,
  saved,
  onSaved,
  onEdited,
  onLetterheadChanged,
  onOpenRates,
}: {
  readonly section: Section;
  readonly company: CompanyAdminView;
  readonly companies: readonly CompanyAdminView[];
  readonly saved: boolean;
  readonly onSaved: () => void;
  readonly onEdited: () => void;
  readonly onLetterheadChanged: () => void;
  readonly onOpenRates?: () => void;
}) => {
  const operation = useOperation();
  const [form, setForm] = useState<CompanyForm>(() => companyFormFrom(company));
  const [shown, setShown] = useState<CompanyFormProblems>({});
  const [confirmRates, setConfirmRates] = useState(false);

  const set = (field: CompanyFormField, value: string) => {
    onEdited();
    setShown((current) => ({ ...current, [field]: undefined }));
    setForm((current) => ({ ...current, [field]: value }));
  };

  /** The fields this section saves; a problem in the other section's fields is not this save's. */
  const inSection = (field: CompanyFormField) => (section === 'rates') === RATE_FIELDS.includes(field);
  const problemsNow = (): CompanyFormProblems =>
    Object.fromEntries(
      Object.entries(companyFormProblems(form, company, companies)).filter(([field]) => inSection(field as CompanyFormField)),
    );

  /*
   * A SERVER REFUSAL BESIDE ITS FIELD. The prefix overlap, a start that would
   * rewind, an email address: the server's own sentence, placed where the
   * office is looking. Anything without a field stays in the notice above.
   */
  const refusal = operation.violations[0];
  const refusedField = refusal === undefined ? null : fieldForRefusal(refusal.code);
  const errorFor = (field: CompanyFormField): string | undefined =>
    shown[field] ?? (refusedField === field ? refusal?.message : undefined);

  const save = async (): Promise<boolean> => {
    const problems = problemsNow();
    setShown(problems);
    if (Object.keys(problems).length > 0) return false;
    const ok = await operation.run(() =>
      companiesApi.update(company.id, companyUpdateFrom(form, { details: section === 'details', rates: section === 'rates' })),
    );
    if (ok) onSaved();
    return ok;
  };

  const text = (field: CompanyFormField, label: string, extra: { readonly hint?: string; readonly type?: string; readonly multiline?: boolean } = {}) =>
    extra.multiline === true ? (
      <TextAreaField
        key={field}
        label={label}
        rows={3}
        value={form[field]}
        onChange={(event) => set(field, event.target.value)}
        error={errorFor(field)}
        hint={extra.hint}
        data-testid={`company-${field}`}
      />
    ) : (
      <TextField
        key={field}
        label={label}
        type={extra.type ?? 'text'}
        value={form[field]}
        onChange={(event) => set(field, event.target.value)}
        error={errorFor(field)}
        hint={extra.hint}
        data-testid={`company-${field}`}
      />
    );

  const notice =
    operation.error !== null && refusedField === null ? (
      <RuleViolationNotice
        title={`${company.name} could not be saved`}
        message={operation.error}
        violations={operation.violations}
      />
    ) : operation.error !== null ? (
      <p role="alert" className="text-sm font-medium text-signal-600" data-testid="company-save-refused">
        {operation.error} {refusal?.message}
      </p>
    ) : null;

  if (section === 'rates') {
    const money = (field: 'normal' | 'overtime' | 'double' | 'callout' | 'testBench' | 'kilometre', label: string, hint: string) => (
      <TextField
        key={field}
        label={label}
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        value={form[field]}
        onChange={(event) => set(field, event.target.value)}
        error={errorFor(field)}
        hint={hint}
        data-testid={field === 'testBench' ? 'test-bench-fee' : `company-${field}`}
      />
    );
    return (
      <div className="space-y-5">
        {notice}
        <AdminNotice
          title={`${company.name}: changing rates affects its open jobs`}
          body={`A rate change re-prices ${company.name}’s open work immediately, and no other company’s. It cannot reach a job the customer has already signed: every job freezes a full copy of the rates at signature and is priced from that copy for the rest of its life.`}
        />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Labour rates" description="Charged per hour, excluding VAT." />
            <div className="mt-4 space-y-4">
              {(['normal', 'overtime', 'double'] as const).map((key) =>
                money(key, labourRateLabel(key as LabourRateType), `Currently ${formatCurrency(company.rates.labourRates[key])} per hour`),
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Call-out, test bench, travel and VAT" />
            <div className="mt-4 space-y-4">
              {money('callout', 'Call-out fee', MONEY_HINTS.callout!(company))}
              {money('testBench', 'Test bench fee', MONEY_HINTS.testBench!(company))}
              {money('kilometre', 'Kilometre rate', MONEY_HINTS.kilometre!(company))}
              <TextField
                label="VAT percentage"
                type="number"
                min="0"
                max="100"
                step="0.5"
                inputMode="decimal"
                value={form.vat}
                onChange={(event) => set('vat', event.target.value)}
                error={errorFor('vat')}
                hint={`Currently ${company.rates.vatPercentage}%`}
                data-testid="company-vat"
              />
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-steel-100 pt-4">
              {saved && (
                <Badge tone="green" size="sm">
                  Saved
                </Badge>
              )}
              <Button
                onClick={() => {
                  const problems = problemsNow();
                  setShown(problems);
                  if (Object.keys(problems).length === 0) setConfirmRates(true);
                }}
                data-testid="save-company-rates"
              >
                Save rates
              </Button>
            </div>
          </Card>
        </div>
        <ConfirmDialog
          open={confirmRates}
          title={`Update ${company.name}’s charge-out rates?`}
          message={`${company.name}’s open jobs will be re-priced at the new rates. Jobs the customer has already signed keep the rates that were frozen onto them at signature, so signed job cards and their totals do not move.`}
          confirmLabel="Update rates"
          busy={operation.running}
          onConfirm={async () => {
            await save();
            setConfirmRates(false);
          }}
          onCancel={() => setConfirmRates(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {notice}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card data-testid="company-details-card">
          <CardHeader
            title="Company details"
            description={`Printed on ${company.name}’s job cards, delivery notes and letters. An empty line is left off — nothing is invented.`}
          />
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {DETAIL_FIELDS.map((entry) => (
              <div key={entry.field} className={entry.multiline === true || entry.field === 'name' ? 'sm:col-span-2' : undefined}>
                {text(entry.field, entry.label, entry)}
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-5">
          <Card data-testid="company-numbering-card">
            <CardHeader title="Job numbering" />
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                label="Job number prefix"
                value={form.jobNumberPrefix}
                onChange={(event) => set('jobNumberPrefix', event.target.value.toUpperCase())}
                error={errorFor('jobNumberPrefix')}
                hint="Capital letters or digits and a hyphen, e.g. WDJ-. Never the same as, or the start of, another company’s."
                autoCapitalize="characters"
                data-testid="company-jobNumberPrefix"
              />
              <TextField
                label="Job number start"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={form.jobNumberStart}
                onChange={(event) => set('jobNumberStart', event.target.value)}
                error={errorFor('jobNumberStart')}
                data-testid="company-jobNumberStart"
              />
            </div>
            <p className="mt-3 text-xs text-steel-500">
              The start sets the first number of a new sequence. Once numbers have been issued it cannot
              rewind an active one: it can only move the numbering forward, so no job number is ever
              handed out twice.
            </p>
            <dl className="mt-3 flex flex-wrap justify-between gap-2 rounded-[var(--radius-control)] border border-steel-200 bg-steel-50 px-3 py-2.5 text-sm">
              <dt className="text-steel-500">Next job number</dt>
              <dd className="font-mono font-semibold text-steel-900" data-testid="company-next-number">
                {nextJobNumberOf(company)}
              </dd>
            </dl>
          </Card>

          <Card>
            <CardHeader
              title="Notifications"
              description={`The customer emails for ${company.name}’s jobs are sent as this name, and replies go to this address. Empty: not configured.`}
            />
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {text('senderName', 'Sender display name')}
              {text('replyTo', 'Reply-to email', { type: 'email' })}
            </div>
          </Card>

          {/* LETTERHEAD-1: uploaded, replaced and removed on its own, never through the details save. */}
          <CompanyLetterheadCard company={company} onChanged={onLetterheadChanged} />
        </div>
      </div>

      <Card>
        <CardHeader
          title="Rates"
          description="Edited on the Rates & VAT tab — the one place a company’s rates are changed."
          action={
            onOpenRates === undefined ? undefined : (
              <Button variant="secondary" size="sm" onClick={onOpenRates} data-testid="company-open-rates">
                Edit rates
              </Button>
            )
          }
        />
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {[
            [labourRateLabel('normal'), formatCurrency(company.rates.labourRates.normal)],
            [labourRateLabel('overtime'), formatCurrency(company.rates.labourRates.overtime)],
            [labourRateLabel('double'), formatCurrency(company.rates.labourRates.double)],
            ['Call-out fee', formatCurrency(company.rates.calloutRate)],
            ['Test bench fee', formatCurrency(company.rates.testBenchFee)],
            ['Kilometre rate', formatCurrency(company.rates.kilometreRate)],
            ['VAT', `${company.rates.vatPercentage}%`],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-steel-100 pb-2">
              <dt className="text-steel-500">{label}</dt>
              <dd className="text-right font-medium text-steel-800 tabular">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {saved && (
          <Badge tone="green" size="sm">
            Saved
          </Badge>
        )}
        <Button onClick={() => void save()} loading={operation.running} data-testid="save-company-details">
          Save {company.name} details
        </Button>
      </div>
    </div>
  );
};
