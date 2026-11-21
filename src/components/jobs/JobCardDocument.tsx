import type { JobView } from "@/application/job-view";
import { DEFAULT_COMPANY_ID } from "@/domain";
import {
  buildJobCardModel,
  type ChargeRow,
  type LabelValue,
} from "@/lib/job-card/model";
import { SignatureDisplay } from "./SignaturePad";
import { DocumentPhoto } from "./DocumentPhoto";
import { DocumentLetterhead, FullWidthLetterheadHeader } from "@/components/documents/EjeLetterhead";
import { jobCardEditionOf, showsCurrentJobCardLayout, hasAlignedHeader, hasJobCard3Layout } from "@/lib/job-card/layout-version";
import { carriesMasterLetterhead } from "@/lib/branding/eje-letterhead";
import { JobCardDocumentV5 } from "./JobCardDocumentV5";

/**
 * The EJE job card document, on screen.
 *
 * Content, order and labels come from `buildJobCardModel` — the single
 * definition this and the PDF renderer share, so the file a customer keeps and
 * the document they were shown cannot say different things. This file decides
 * only how to draw that model in HTML.
 *
 * JOB-CARD-2 (the owner, 16 November 2026): the redesigned layout, as the PDF draws it — the contact
 * details grouped, Machine and Job details to the right, WORK CARRIED OUT as a main heading over its
 * subheadings in two columns, a Date column in the table, the customer's acceptance on the right
 * under the totals, then the checklist, then the photographs (a new page when printed). A job ISSUED
 * before the redesign is shown as it was issued (`JobCardDocumentV5`), beside its stored PDF.
 */
export const JobCardDocument = ({ view }: { readonly view: JobView }) =>
  showsCurrentJobCardLayout(view.job.finalDocument) ? <CurrentJobCard view={view} /> : <JobCardDocumentV5 view={view} />;

const CurrentJobCard = ({ view }: { readonly view: JobView }) => {
  // JOB-CARD-3: the edition the document is (or will be) issued in — 6 only for one issued in v1.15.0.
  const edition = jobCardEditionOf(view.job.finalDocument);
  const fullWidthHeader = hasJobCard3Layout(edition) && carriesMasterLetterhead(view.job.companyId);
  const model = buildJobCardModel({
    edition,
    job: view.job,
    customer: view.customer,
    site: view.site,
    contact: view.contact,
    machine: view.machine,
    settings: view.settings,
    company: view.company,
    checklistTemplate: view.checklistTemplate,
    users: view.users,
    // A closed job's document was produced when it was issued; anything else is
    // a live preview, generated now.
    generatedAt:
      view.job.finalDocument?.generatedAt ?? new Date().toISOString(),
  });

  return (
    <article
      // Pinned to the light palette in both themes: this is a preview of the
      // document the customer receives, and it must look the way it will print.
      data-theme="light"
      className="eje-document mx-auto max-w-[820px] bg-white p-8 text-[13px] leading-relaxed text-steel-800 shadow-[var(--shadow-card)] sm:p-10"
    >
      {fullWidthHeader ? (
        <FullWidthLetterheadHeader title={model.documentTitle} number={model.jobNumber} aligned={hasAlignedHeader(edition)} />
      ) : (
      <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-steel-900 pb-5">
        {/*
          LETTERHEAD-2: the document's letterhead, chosen as the PDF chooses it — EJE's
          master letterhead, another company's uploaded one, or this text header as before.
          Chosen by the job's company, as the PDF is (`job.companyId`). An issued job shows the
          header its stored PDF has: the master only when it was issued with it. On a phone the
          master takes the document's whole width (into its padding), the title below it.
        */}
        <DocumentLetterhead
          companyId={view.job.companyId}
          companyName={model.company.name}
          letterhead={view.companyLetterhead}
          // Shown only for a job not yet issued or issued in this layout — always on the master letterhead.
          master
          className="min-w-0 flex-1 basis-[22rem]"
          masterClassName="-mx-6 min-w-0 basis-[calc(100%+3rem)] sm:mx-0 sm:flex-1 sm:basis-[22rem]"
          fallback={
            <div>
              <div className="flex items-center gap-3">
                {/*
                  MULTI-CO-1: the dark tile is EJE's own text mark, shown only on
                  EJE's documents. Another company's keeps an empty space of the
                  same size, so its name sits exactly where it does on the PDF.
                */}
                {model.company.id === DEFAULT_COMPANY_ID ? (
                  <span className="flex size-11 items-center justify-center rounded-[0.55rem] bg-steel-900 text-[13px] font-black tracking-tighter text-white">
                    EJE
                  </span>
                ) : (
                  <span aria-hidden="true" className="size-11 shrink-0" data-testid="no-company-tile" />
                )}
                <div>
                  <p className="text-lg leading-tight font-bold text-steel-900">
                    {model.company.name}
                  </p>
                  <p className="text-xs text-steel-500">{model.company.address}</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-steel-500">
                {model.company.contactLine}
                <br />
                {model.company.registrationLine}
              </p>
            </div>
          }
        />

        <div className="text-right">
          <p className="text-xs font-semibold tracking-[0.18em] text-steel-500 uppercase">
            {model.documentTitle}
          </p>
          <p className="font-mono text-2xl font-bold text-steel-900">
            {model.jobNumber}
          </p>
        </div>
      </header>
      )}

      {/* JOB-CARD-2: Machine and Job details in a narrower column at the right ("Move Right"). */}
      <section className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-[minmax(0,1fr)_21rem] sm:gap-8" data-testid="job-card-parties">
        <div className="min-w-0">
          <SectionTitle>Customer</SectionTitle>
          <p className="font-semibold text-steel-900">{model.customer.name}</p>
          <p className="text-steel-600">
            {model.customer.addressLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </p>
          {/* JOB-CARD-2: the contact person, apart from the address, under their own label. */}
          {model.customer.contact !== null && (
            <div className="mt-3" data-testid="job-card-contact">
              <SectionTitle>Contact details</SectionTitle>
              <p className="font-semibold text-steel-800">{model.customer.contact.name}</p>
              <p className="text-steel-600">
                {[model.customer.contact.position, model.customer.contact.phone, model.customer.contact.email]
                  .filter((line) => line.trim().length > 0)
                  .map((line) => (
                    <span key={line} className="block break-words">
                      {line}
                    </span>
                  ))}
              </p>
            </div>
          )}
        </div>

        <div className="min-w-0" data-testid="job-card-details-column">
          {model.machine !== null && (
            <>
              <SectionTitle>Machine</SectionTitle>
              {/* JOB-CARD-3: the machine's name is a labelled row; there is no title line. */}
              {model.machine.title.length > 0 && (
                <p className="font-semibold text-steel-900">
                  {model.machine.title}
                </p>
              )}
              <dl className="mt-1 space-y-0.5 text-steel-600">
                {model.machine.rows.map((row) => (
                  <Row key={row.label} {...row} />
                ))}
              </dl>
            </>
          )}

          <div className="mt-4">
            <SectionTitle>Job details</SectionTitle>
            <dl className="space-y-0.5 text-steel-600">
              {model.jobDetails.map((row) => (
                <Row key={row.label} {...row} />
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* Every field job has one — creation refuses it without one — so this
          only ever hides the section on a job type that collects none. */}
      {model.faultDescription !== null && (
        <section className="mt-6">
          <SectionTitle>Reported fault</SectionTitle>
          <p className="rounded border border-steel-200 bg-steel-50 p-3 text-steel-700">
            {model.faultDescription}
          </p>
        </section>
      )}

      {/* PDF-RECV-2: the parts booked in, their own section directly after Reported fault. */}
      {model.partsReceived !== null && (
        <section className="mt-6" data-testid="job-card-parts-received">
          <SectionTitle>Parts received</SectionTitle>
          <dl className="space-y-0.5 text-xs text-steel-600">
            {model.partsReceived.rows.map((row) => (
              <Row key={row.label} {...row} />
            ))}
          </dl>
        </section>
      )}

      {/* INSTALL-DN-1: what an Installation Delivery Note says was installed — no prices. */}
      {model.installation !== undefined && model.installation.description !== null && (
        <section className="mt-6" data-testid="installation-description">
          <SectionTitle>Installation</SectionTitle>
          <p className="rounded border border-steel-200 bg-steel-50 p-3 text-steel-700">
            {model.installation.description}
          </p>
        </section>
      )}
      {model.installation !== undefined && model.installation.items.length > 0 && (
        <section className="mt-6" data-testid="installation-items">
          <SectionTitle>Items delivered and installed</SectionTitle>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-y border-steel-300 bg-steel-50 text-left">
                <th className="py-2 pr-2 font-semibold">Part</th>
                <th className="w-20 py-2 text-right font-semibold">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {model.installation.items.map((item, index) => (
                <tr key={`${item.partNumber}-${index}`} className="border-b border-steel-100">
                  <td className="py-2 pr-2">
                    <span className="font-mono">{item.partNumber}</span>
                    {item.description.length > 0 && (
                      <span className="text-steel-500"> — {item.description}</span>
                    )}
                  </td>
                  <td className="tabular py-2 text-right font-medium">{item.quantity}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="py-1.5 font-bold text-steel-900">Items</td>
                <td className="tabular py-1.5 text-right font-bold text-steel-900">
                  {model.installation.itemCount}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      {model.workBlocks.length > 0 && <WorkCarriedOut blocks={model.workBlocks} />}

      {/* INSTALL-DN-1: the labour — technician, date, work, hours — and never a rate or an amount. */}
      {model.installation !== undefined && (
        <section className="mt-6" data-testid="installation-labour">
          <SectionTitle>Labour and completion</SectionTitle>
          {model.installation.labour.length === 0 ? (
            <p className="text-steel-500">No labour is recorded on this job.</p>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-y border-steel-300 bg-steel-50 text-left">
                  <th className="py-2 pr-2 font-semibold">Technician</th>
                  <th className="py-2 pr-2 font-semibold">Date</th>
                  <th className="py-2 pr-2 font-semibold">Work</th>
                  <th className="w-20 py-2 text-right font-semibold">Hours</th>
                </tr>
              </thead>
              <tbody>
                {model.installation.labour.map((line, index) => (
                  <tr key={`${line.technician}-${index}`} className="border-b border-steel-100">
                    <td className="py-2 pr-2">{line.technician}</td>
                    <td className="py-2 pr-2">{line.date}</td>
                    <td className="py-2 pr-2">{line.work}</td>
                    <td className="tabular py-2 text-right font-medium">{line.hours}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="py-1.5 text-right font-bold text-steel-900">
                    Hours recorded
                  </td>
                  <td className="tabular py-1.5 text-right font-bold text-steel-900">
                    {model.installation.hoursRecorded}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
          <dl className="mt-3 space-y-0.5 text-steel-600">
            {model.installation.completion.map((row) => (
              <Row key={row.label} {...row} />
            ))}
          </dl>
          <p className="mt-2 text-xs text-steel-500">{model.installation.priceNote}</p>
        </section>
      )}

      {model.notes.length > 0 && (
        <section className="mt-6">
          <SectionTitle>Job notes</SectionTitle>
          <ul className="space-y-2">
            {model.notes.map((note) => (
              <li
                key={note.byline}
                className="border-b border-steel-100 pb-2 last:border-b-0"
              >
                <p className="whitespace-pre-line text-steel-700">
                  {note.body}
                </p>
                <p className="mt-0.5 text-xs text-steel-500">
                  {note.byline}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(model.charges !== null || model.received !== null) && (
        <section className="mt-6">
          <SectionTitle>Labour, travel and parts</SectionTitle>
          {/* PDF-RECV-1: the collection, here and not under Job details. */}
          {model.received !== null && (
            <dl className="mb-3 space-y-0.5 text-xs text-steel-600" data-testid="job-card-received">
              {model.received.rows.map((row) => (
                <Row key={row.label} {...row} />
              ))}
            </dl>
          )}
          {model.charges !== null && (
          // JOB-CARD-2: Date | Description | Qty | Rate | Amount; no line drawn above the header band.
          <table className="w-full border-collapse text-xs" data-testid="job-card-charges">
            <thead>
              <tr className="border-b border-steel-300 bg-steel-50 text-left">
                <th className="w-[5.5rem] py-2 pr-2 font-semibold">Date</th>
                <th className="py-2 pr-2 font-semibold">Description</th>
                <th className="w-16 py-2 text-right font-semibold">Qty</th>
                <th className="w-24 py-2 text-right font-semibold">Rate</th>
                <th className="w-28 py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {model.charges.rows.map((row, index) => (
                <ChargeLine key={`${row.description}-${index}`} row={row} />
              ))}
            </tbody>
            <tfoot>
              {/*
                COST-5. THE DISCOUNT, WITH ITS REASON, ON THE CUSTOMER'S OWN
                COPY. Printed between the two subtotals so the paper answers
                "what was it before you came down" without anybody adding the
                lines back up. The reason is required when the discount is
                applied precisely so it can be shown here.
              */}
              {model.charges.discount !== null && (
                <>
                  <tr>
                    <td colSpan={3} />
                    <td className="py-1.5 text-right text-steel-600">Subtotal</td>
                    <td className="tabular py-1.5 text-right">
                      {model.charges.discount.grossSubtotal}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="py-1.5 pr-2 text-steel-600 italic">
                      Discount — {model.charges.discount.reason}
                    </td>
                    <td className="py-1.5 text-right text-steel-600">Discount</td>
                    <td className="tabular py-1.5 text-right font-medium">
                      −{model.charges.discount.amount}
                    </td>
                  </tr>
                </>
              )}
              <tr>
                <td colSpan={3} />
                <td className="py-1.5 text-right text-steel-600">
                  {model.charges.discount === null ? 'Subtotal' : 'Subtotal after discount'}
                </td>
                <td className="tabular py-1.5 text-right font-medium">
                  {model.charges.subtotal}
                </td>
              </tr>
              <tr>
                <td colSpan={3} />
                <td className="py-1.5 text-right text-steel-600">
                  {model.charges.vatLabel}
                </td>
                <td className="tabular py-1.5 text-right">
                  {model.charges.vat}
                </td>
              </tr>
              <tr>
                <td colSpan={3} />
                <td className="border-t-2 border-steel-900 py-2 text-right font-bold text-steel-900">
                  Total
                </td>
                <td className="tabular border-t-2 border-steel-900 py-2 text-right text-base font-bold text-steel-900">
                  {model.charges.total}
                </td>
              </tr>
            </tfoot>
          </table>
          )}
        </section>
      )}

      {/*
        JOB-CARD-2 (the owner: "Customer acceptance block with signature should move to right under
        Subtotal, VAT, Total"): the WHOLE block — heading, declaration, who signed and when, the
        signature and its caption — on the right under the totals, kept together, before the
        checklist and the photographs. A refusal replaces it outright, in the same place: no
        signature box, because there is no signature.
      */}
      <section
        className="mt-6 break-inside-avoid sm:ml-auto sm:w-[22.5rem]"
        data-testid="job-card-acceptance"
      >
        <SectionTitle>
          {model.acceptance === null ? "Customer acceptance" : `${model.acceptance.caption.split(" signature")[0]} acceptance`}
        </SectionTitle>
        {model.refusal !== null ? (
          <div>
            <p className="text-sm font-bold tracking-wide text-steel-900 uppercase">
              {model.refusal.heading}
            </p>
            <p className="mt-2 text-xs font-bold tracking-[0.12em] text-steel-500 uppercase">
              Reason
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-steel-800">{model.refusal.reason}</p>
            <dl className="mt-2 space-y-0.5 text-steel-600">
              {model.refusal.rows.map((row) => (
                <Row key={row.label} {...row} />
              ))}
            </dl>
          </div>
        ) : model.acceptance === null ? (
          <p className="text-steel-500 italic">Not yet signed.</p>
        ) : (
          <div>
            <p className="mb-2 text-steel-700">{model.acceptance.declaration}</p>
            <dl className="mb-2 space-y-0.5 text-steel-600">
              {model.acceptance.rows.map((row) => (
                <Row key={row.label} {...row} />
              ))}
            </dl>
            <SignatureDisplay pathData={model.acceptance.signatureData} />
            <p className="mt-1 border-t border-steel-300 pt-1 text-xs text-steel-500">
              {model.acceptance.caption}
            </p>
          </div>
        )}
      </section>

      {model.checklist !== null && (
        <section className="mt-6">
          <SectionTitle>{model.checklist.title}</SectionTitle>
          {model.checklist.documentTitle !== null && (
            <p className="text-xs font-bold tracking-wide text-steel-800">
              {model.checklist.documentTitle}
            </p>
          )}
          {model.checklist.checklistType !== null && (
            <p
              className="text-xs font-semibold text-steel-700"
              data-testid="job-card-checklist-type"
            >
              {model.checklist.checklistType}
            </p>
          )}
          <p className="mb-2 text-xs text-steel-500">
            {model.checklist.summary}
          </p>

          {model.checklist.header.length > 0 && (
            <dl className="mb-3 grid grid-cols-1 gap-x-6 gap-y-0.5 text-xs sm:grid-cols-2">
              {model.checklist.header.map((line) => (
                <div key={line.label} className="flex gap-2">
                  <dt className="shrink-0 font-semibold text-steel-600">
                    {line.label}
                  </dt>
                  <dd className="text-steel-800">{line.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {model.checklist.sections.map((section, sectionIndex) => (
            <div key={`${sectionIndex}-${section.title}`} className="mb-3">
              {section.title.length > 0 && (
                <p className="border-b border-steel-200 pb-1 text-xs font-bold tracking-wide text-steel-700 uppercase">
                  {section.title}
                </p>
              )}
              <ul className="mt-1">
                {section.items.map((item, itemIndex) => (
                  <li
                    key={`${itemIndex}-${item.text}`}
                    className="border-b border-steel-100 py-1.5 text-xs"
                  >
                    {item.groupHeading.length > 0 && (
                      <p className="mb-1 font-semibold text-steel-800">
                        {item.groupHeading}
                      </p>
                    )}
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex flex-1 gap-2 text-steel-700">
                        <span className="tabular w-5 shrink-0 text-steel-500">
                          {item.number}
                        </span>
                        <span className="whitespace-pre-line">{item.text}</span>
                      </span>
                      <span className="shrink-0 font-semibold">
                        {item.answer}
                      </span>
                    </div>
                    {item.sourceNote.length > 0 && (
                      <p className="mt-0.5 pl-7 text-xs text-amber-eje-800 italic">
                        {item.sourceNote}
                      </p>
                    )}
                    {item.readings.length > 0 && (
                      <p className="mt-0.5 pl-7 text-xs text-steel-700">
                        {item.readings}
                      </p>
                    )}
                    {item.note.length > 0 && (
                      <p className="mt-0.5 pl-7 text-xs text-steel-500">
                        Note: {item.note}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {model.checklist.notes.map((note) => (
            <p key={note} className="mt-1 text-xs text-steel-700">
              {note}
            </p>
          ))}
          {model.checklist.closing.length > 0 && (
            <p className="mt-2 text-xs font-bold tracking-wide text-steel-900">
              {model.checklist.closing}
            </p>
          )}
          {model.checklist.signatures.length > 0 && (
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-0.5 text-xs sm:grid-cols-2">
              {model.checklist.signatures.map((line) => (
                <div key={line.label} className="flex gap-2">
                  <dt className="shrink-0 font-semibold text-steel-600">
                    {line.label}
                  </dt>
                  <dd className="text-steel-800">{line.value || "—"}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      )}

      {/* JOB-CARD-2: the photographs last, on a page of their own when printed, heading with them. */}
      {model.photos.length > 0 && (
        <section className="mt-6 break-before-page" data-testid="job-card-photographs">
          <SectionTitle>Photographs</SectionTitle>
          {/* INSTALL-DN-1: two across on the Installation Delivery Note, as on its PDF. */}
          <ul className={`grid grid-cols-2 gap-3 ${model.installation !== undefined ? "" : "sm:grid-cols-3"}`}>
            {model.photos.map((photo) => (
              <li key={photo.id}>
                <DocumentPhoto
                  jobId={view.job.id}
                  photo={photo}
                  simulated={
                    view.job.photos.find((candidate) => candidate.id === photo.id)
                      ?.provenance === "simulated"
                  }
                />
                <p className="mt-1 text-xs text-steel-600">
                  {photo.caption}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-8 border-t border-steel-200 pt-3 text-xs text-steel-400">
        {model.footerLines.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </footer>
    </article>
  );
};

/*
 * WORK CARRIED OUT, as the PDF draws it (JOB-CARD-2): the main heading, then the subheadings — bold,
 * a little stronger than the text — with Fault findings and Diagnosis beside Work performed,
 * Recommendations and General notes. One column when a side has nothing written. Every block here was
 * written by somebody: the model drops an empty field (DOC-1).
 */
const LEFT_WRITE_UP = new Set(["Fault findings", "Diagnosis"]);

type WorkBlock = ReturnType<typeof buildJobCardModel>["workBlocks"][number];

const WorkBlocks = ({ blocks }: { readonly blocks: readonly WorkBlock[] }) => (
  <div className="space-y-3">
    {blocks.map((block) => (
      <div key={block.label}>
        <p className="text-[12px] font-bold tracking-[0.04em] text-steel-900 uppercase" data-testid="job-card-subheading">
          {block.label}
        </p>
        <p className="mt-0.5 whitespace-pre-line text-steel-700">{block.value}</p>
      </div>
    ))}
  </div>
);

const WorkCarriedOut = ({ blocks }: { readonly blocks: readonly WorkBlock[] }) => {
  const left = blocks.filter((block) => LEFT_WRITE_UP.has(block.label));
  const right = blocks.filter((block) => !LEFT_WRITE_UP.has(block.label));
  return (
    <section className="mt-6" data-testid="job-card-work">
      <h3 className="mb-3 text-[14px] font-bold tracking-[0.12em] text-steel-900 uppercase" data-testid="job-card-main-heading">
        Work carried out
      </h3>
      {left.length > 0 && right.length > 0 ? (
        <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          <WorkBlocks blocks={left} />
          <WorkBlocks blocks={right} />
        </div>
      ) : (
        <WorkBlocks blocks={blocks} />
      )}
    </section>
  );
};

const SectionTitle = ({ children }: { readonly children: React.ReactNode }) => (
  <h3 className="mb-2 text-xs font-bold tracking-[0.12em] text-steel-500 uppercase">
    {children}
  </h3>
);

const Row = ({ label, value, mono = false }: LabelValue) => (
  <div className="flex gap-2">
    <dt className="w-28 shrink-0 text-steel-500">{label}</dt>
    <dd className={mono ? "font-mono text-steel-800" : "text-steel-800"}>
      {value}
    </dd>
  </div>
);

const ChargeLine = ({ row }: { readonly row: ChargeRow }) => (
  <tr className="border-b border-steel-100">
    {/* The day the work or travel was done, as recorded; blank for a part or a fee (JOB-CARD-2). */}
    <td className="tabular py-2 pr-2 align-top whitespace-nowrap" data-testid="job-card-charge-date">{row.date}</td>
    <td className="py-2 pr-2">
      <span className={row.mono === true ? "font-mono" : undefined}>
        {row.description}
      </span>
      {row.detail.length > 0 && (
        <span className="text-steel-500"> — {row.detail}</span>
      )}
    </td>
    <td className="tabular py-2 text-right">{row.quantity}</td>
    <td className="tabular py-2 text-right">{row.rate}</td>
    <td className="tabular py-2 text-right font-medium">{row.amount}</td>
  </tr>
);
