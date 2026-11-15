'use client';

import { COMPANY_CHOICES, toggleCompany } from '@/lib/companies';

/**
 * WHICH COMPANIES THE CUSTOMER IS A CUSTOMER OF. MULTI-CO-1.
 *
 * EJE, WD Hearn JHB, or both (the owner's answer). A fieldset with a legend,
 * so a screen reader announces the question with each box, and boxes a finger
 * can hit on a tablet. The rule that one at least is chosen is shown here, in
 * the form; the server applies it again (`customer_company_required`).
 */
export const CompanyCheckboxes = ({
  value,
  onChange,
  error,
  hint,
}: {
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  readonly error?: string | null;
  readonly hint?: string;
}) => (
  <fieldset data-testid="customer-companies" aria-describedby="customer-companies-note">
    <legend className="text-sm font-semibold text-steel-700">
      Customer of
      <span className="ml-1 text-signal-600">*</span>
    </legend>
    <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
      {COMPANY_CHOICES.map((choice) => (
        <label
          key={choice.id}
          className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-steel-800"
        >
          <input
            type="checkbox"
            checked={value.includes(choice.id)}
            onChange={(event) => onChange(toggleCompany(value, choice.id, event.target.checked))}
            className="size-5 rounded border-steel-300 text-eje-600 focus:ring-eje-500"
            data-testid={`customer-company-${choice.id}`}
          />
          {choice.label}
        </label>
      ))}
    </div>
    <p
      id="customer-companies-note"
      role={error === null || error === undefined ? undefined : 'alert'}
      className={
        error === null || error === undefined
          ? 'text-xs text-steel-500'
          : 'text-xs font-medium text-signal-600'
      }
      data-testid={error === null || error === undefined ? undefined : 'customer-companies-error'}
    >
      {error ?? hint ?? 'Its jobs can be raised only for the companies ticked here.'}
    </p>
  </fieldset>
);
