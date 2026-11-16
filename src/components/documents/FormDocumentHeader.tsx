import type { CSSProperties, ReactNode } from 'react';
import { carriesMasterLetterhead } from '@/lib/branding/eje-letterhead';
import { FORM_LETTERHEAD_SHARE } from '@/services/simulated/pdf-sheet';
import { EjeLetterhead } from './EjeLetterhead';

/**
 * THE ATTENDANCE AND TIMESHEET HEADER, ON SCREEN. LETTERHEAD-3 (the owner, 16 November 2026).
 *
 * The screen's copy of the PDF's `drawFormHeader`: the EJE master letterhead cropped to its ink
 * and given the SAME share of the width as on the PDF (`FORM_LETTERHEAD_SHARE`), the title smaller
 * than before on the right, centred on the letterhead's height, and a fine rule before the fields —
 * so the preview, the PDF and the print are one design. On a phone the letterhead takes the whole
 * width and the title goes under it, on the right. Where the row is narrow (a small tablet) the letterhead
 * gives way to the title, never the other way round.
 *
 * A company without the master letterhead keeps its text heading (`fallback`) beside the title, as before.
 */
export const FormDocumentHeader = ({
  companyId,
  title,
  fallback,
}: {
  readonly companyId: string;
  readonly title: string;
  readonly fallback: ReactNode;
}) => {
  if (!carriesMasterLetterhead(companyId)) {
    return (
      <header className="flex flex-wrap items-start justify-between gap-4 sm:flex-nowrap">
        {fallback}
        <p className="text-xl font-bold tracking-[0.15em]">{title}</p>
      </header>
    );
  }
  return (
    <header
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-steel-200 pb-3 sm:flex-nowrap"
      data-testid="form-document-header"
    >
      <div
        className="w-full min-w-0 sm:w-[var(--form-letterhead-share)] sm:shrink"
        style={{ '--form-letterhead-share': `${(FORM_LETTERHEAD_SHARE * 100).toFixed(2)}%` } as CSSProperties}
      >
        <EjeLetterhead fit="ink" />
      </div>
      <p className="ml-auto shrink-0 text-[18px] font-bold tracking-[0.1em] whitespace-nowrap" data-testid="form-document-title">
        {title}
      </p>
    </header>
  );
};
