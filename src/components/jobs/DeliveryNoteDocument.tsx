import type { DeliveryNoteModel } from '@/lib/job-card/delivery-note';
import type { LetterheadReference } from '@/domain';
import { DocumentLetterhead } from '@/components/documents/EjeLetterhead';
import { showsMasterLetterhead } from '@/lib/branding/eje-letterhead';
import { SignatureDisplay } from './SignaturePad';

/**
 * THE DELIVERY NOTE, DRAWN BY THE BROWSER. PARTS-04.
 *
 * The same `DeliveryNoteModel` the PDF is drawn from — no price exists in it to
 * show. Used where the browser cannot display a PDF (the tablets), and printed
 * from there.
 *
 * LETTERHEAD-2: its header is the job company's letterhead, chosen as the PDF
 * chooses it — EJE's master letterhead, another company's uploaded image, or
 * the text header as before. The model names the company only in words, so
 * the caller passes the job's company (`job.companyId`, the field the PDF is chosen by —
 * required, so a caller cannot silently fall back to the old header) and its letterhead
 * reference. An issued job's note shows the header its stored PDF has: the master only when
 * the job's document was issued with it (a courier's note is issued with its job card).
 */
export const DeliveryNoteDocument = ({
  model,
  companyId,
  letterhead,
  finalDocument,
}: {
  readonly model: DeliveryNoteModel;
  /** The job's company (`job.companyId`). */
  readonly companyId: string;
  readonly letterhead?: LetterheadReference | null;
  /** The job's issued document, or null while nothing is issued. */
  readonly finalDocument: { readonly renderer: number | null } | null;
}) => (
  <article className="eje-document mx-auto max-w-[210mm] bg-white p-6 text-[12px] text-steel-900 shadow-sm" data-testid="delivery-note-document">
    <header className="flex flex-wrap items-start justify-between gap-4 sm:flex-nowrap">
      <DocumentLetterhead
        companyId={companyId}
        companyName={model.company.name}
        letterhead={letterhead}
        master={showsMasterLetterhead(finalDocument)}
        className="min-w-0 flex-1"
        masterClassName="-mx-4 min-w-0 basis-[calc(100%+2rem)] sm:mx-0 sm:flex-1"
        fallback={
          <div>
            <p className="text-base font-bold">{model.company.name}</p>
            <p className="text-xs text-steel-500">{model.company.address}</p>
            <p className="text-xs text-steel-500">{model.company.contactLine}</p>
          </div>
        }
      />
      <div className="text-right">
        <p className="text-xl font-bold tracking-[0.15em]">DELIVERY NOTE</p>
        <p className="text-base font-bold">{model.jobNumber}</p>
      </div>
    </header>
    <section className="mt-5">
      <p className="text-xs font-bold tracking-wide text-steel-500 uppercase">Deliver to</p>
      {model.deliverTo.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </section>
    <dl className="mt-4 grid grid-cols-[13rem_1fr] gap-y-1">
      {model.details.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-steel-500">{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
    <table className="mt-4 w-full border-collapse">
      <thead>
        <tr className="bg-steel-50 text-left">
          <th className="px-1.5 py-1">Item</th>
          <th className="px-1.5 py-1">Part number</th>
          <th className="px-1.5 py-1">Description</th>
          <th className="px-1.5 py-1 text-right">Quantity</th>
        </tr>
      </thead>
      <tbody>
        {model.items.map((item, index) => (
          <tr key={`${item.partNumber}-${index}`} className="border-t border-steel-100" data-testid="delivery-note-item">
            <td className="px-1.5 py-1 text-steel-500">{item.kind}</td>
            <td className="px-1.5 py-1 font-mono">{item.partNumber}</td>
            <td className="px-1.5 py-1">
              {item.description}
              {/* DELIVERY-NOTE-1: the line's comment. */}
              {(item.comment ?? '').length > 0 && <span className="block text-xs text-steel-600">Comment: {item.comment}</span>}
            </td>
            <td className="px-1.5 py-1 text-right tabular-nums">{item.quantity}</td>
          </tr>
        ))}
        <tr className="border-t-2 border-steel-300 font-bold">
          <td colSpan={3} className="px-1.5 py-1 text-right">Total items</td>
          <td className="px-1.5 py-1 text-right tabular-nums">{model.totalQuantity}</td>
        </tr>
      </tbody>
    </table>
    <p className="mt-3 text-xs text-steel-500">{model.priceNote}</p>
    {model.signature !== null ? (
      <section className="mt-6" data-testid="delivery-note-signature">
        <p className="text-xs font-bold tracking-wide text-steel-500 uppercase">Courier acceptance</p>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <p>{model.signature.declaration}</p>
            <p><span className="text-steel-500">Name </span>{model.signature.name}</p>
            <p><span className="text-steel-500">Signed </span>{model.signature.signedAt}</p>
            <p><span className="text-steel-500">Signature reference </span>{model.signature.reference}</p>
          </div>
          <div>
            <SignatureDisplay pathData={model.signature.signatureData} />
            <p className="mt-1 text-xs text-steel-500">Courier signature — the same signature is on the priced job card</p>
          </div>
        </div>
      </section>
    ) : (
      <div className="mt-10 grid grid-cols-2 gap-8 text-xs text-steel-500">
        <p className="border-t border-steel-300 pt-1">Collected by (courier) — name, signature, date</p>
        {/* MULTI-CO-1: released by the job's company, by its short code. */}
        <p className="border-t border-steel-300 pt-1">Released by ({model.company.code ?? 'EJE'}) — name, signature, date</p>
      </div>
    )}
  </article>
);
