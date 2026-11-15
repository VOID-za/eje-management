'use client';

import { useRef, useState } from 'react';
import type { CompanyAdminView } from '@/application/company-operations';
import { Button, Card, CardHeader, ConfirmDialog } from '@/components/ui';
import { RuleViolationNotice } from '@/components/jobs/RuleViolationNotice';
import { companies as companiesApi } from '@/api/endpoints';
import { useOperation } from '@/hooks/useOperation';
import { formatDateTime } from '@/lib/format';

/**
 * A COMPANY'S OFFICIAL LETTERHEAD, IN ADMINISTRATION. LETTERHEAD-1.
 *
 * The office uploads the letterhead image exactly as the company supplied it —
 * nothing is drawn or adjusted here — and new documents of that company carry
 * it across the top in place of the text header. What is on file is shown as
 * the image itself, so the office sees what will be printed. Replacing or
 * removing it reaches new documents only; a removal is confirmed first.
 *
 * The server decides what the file is (`uploadCompanyLetterhead`): a PNG or a
 * JPEG the documents can embed, at most 2 MB. `accept` only narrows the
 * picker; it is not the rule.
 */
export const CompanyLetterheadCard = ({
  company,
  onChanged,
}: {
  readonly company: CompanyAdminView;
  readonly onChanged: () => void;
}) => {
  const operation = useOperation();
  const input = useRef<HTMLInputElement>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const letterhead = company.letterhead;

  const upload = async (file: File) => {
    if (await operation.run(() => companiesApi.uploadLetterhead(company.id, file))) onChanged();
  };

  return (
    <Card data-testid="company-letterhead-card">
      <CardHeader
        title="Letterhead"
        description="PNG or JPEG, the full letterhead as supplied; it is printed across the top of new documents only."
      />
      {operation.error !== null && (
        <div className="mt-3">
          <RuleViolationNotice
            title={`${company.name}’s letterhead was not changed`}
            message={operation.error}
            violations={operation.violations}
          />
        </div>
      )}
      {letterhead === null ? (
        <p className="mt-3 text-sm text-steel-500" data-testid="company-letterhead">
          No letterhead uploaded. {company.name}’s documents carry the text header with the company details above.
        </p>
      ) : (
        <div className="mt-3 space-y-2" data-testid="company-letterhead">
          {/* The stored image itself, through the authorised route — what new documents will carry. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- an authorised API image, not a static asset */}
          <img
            src={companiesApi.letterheadUrl(company.id, letterhead.sha256)}
            alt={`${company.name} letterhead`}
            className="max-h-32 w-full rounded-[var(--radius-control)] border border-steel-200 bg-white object-contain object-left"
            data-testid="company-letterhead-preview"
          />
          <p className="text-sm text-steel-700">
            Uploaded {formatDateTime(letterhead.uploadedAt)} ({letterhead.contentType}).
          </p>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        data-testid="company-letterhead-file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so choosing the same file again still fires.
          event.target.value = '';
          if (file !== undefined) void upload(file);
        }}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          loading={operation.running && !confirmRemove}
          onClick={() => input.current?.click()}
          data-testid="company-letterhead-upload"
        >
          {letterhead === null ? 'Upload letterhead' : 'Replace letterhead'}
        </Button>
        {letterhead !== null && (
          <Button type="button" variant="ghost" onClick={() => setConfirmRemove(true)} data-testid="company-letterhead-remove">
            Remove
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmRemove}
        title={`Remove ${company.name}’s letterhead?`}
        message={`New documents of ${company.name} will carry the text header instead. Documents already issued keep the letterhead they were printed with.`}
        confirmLabel="Remove letterhead"
        confirmVariant="danger"
        busy={operation.running}
        onConfirm={async () => {
          const ok = await operation.run(() => companiesApi.removeLetterhead(company.id));
          setConfirmRemove(false);
          if (ok) onChanged();
        }}
        onCancel={() => setConfirmRemove(false)}
      />
    </Card>
  );
};
