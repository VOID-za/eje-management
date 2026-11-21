import { fitSignatureBox, signatureFacsimile, SIGNATURE_INK } from '@/lib/signature';
import { buildJobCardModel, type ChargeRow, type JobCardModel, type LabelValue } from '@/lib/job-card/model';
import { A4_HEIGHT, PdfBuilder, textWidth } from '@/lib/pdf/writer';
import { SUBSTITUTION_ALLOWANCE } from '@/lib/pdf/metrics';
import { displaySize, type PreparedPhoto } from '@/lib/pdf/image';
import { DEFAULT_COMPANY_ID, SIMULATED_NOTICE_PRINT } from '@/domain';
import type { FinalDocumentSource, RenderedPdf } from '../ports';

/**
 * The EJE job card, rendered to PDF.
 *
 * Consumes `buildJobCardModel` — the same definition the on-screen job card
 * renders — so the two cannot carry different content, labels or section order.
 * What this file owns is only how that model is drawn on paper.
 *
 * The scale mirrors the on-screen document: it is 820px wide with 40px padding,
 * so 740px of content become 515pt here, a factor of about 0.7. Every size and
 * gap below is the screen's Tailwind value at that scale, which is what keeps
 * the printed document recognisably the same document rather than a denser
 * relative of it.
 */

import {
  BAND,
  BODY,
  CONTENT_WIDTH,
  FAINT,
  FOOTER_SPACE,
  GAP,
  INK,
  MARGIN,
  MUTED,
  RIGHT,
  RULE,
  RULE_SOFT,
  Sheet,
  SIZE,
  TRACK_HEADING,
  TRACK_TITLE,
  drawFullWidthLetterhead,
  drawLetterheadOverTitle,
} from './pdf-sheet';
import { isMasterLetterhead, type DocumentLetterhead } from '@/lib/branding/eje-letterhead';
import {
  JOB_CARD_2_RENDERER,
  JOB_CARD_3_RENDERER,
  JOB_CARD_LAYOUT_RENDERER,
  hasAlignedHeader,
  hasJobCard3Layout,
  type JobCardEdition,
} from '@/lib/job-card/layout-version';


const labelValueRows = (
  sheet: Sheet,
  rows: readonly LabelValue[],
  x: number,
  width: number,
): void => {
  /*
   * The label column is as wide as the widest label in THIS block, never
   * narrower than it has always been.
   *
   * It was a fixed 78pt, which every label fitted until the customer's machine
   * number arrived: "Machine number" measures wider than that, so the value was
   * printed hard against it — "Machine numberMID1" — on the document the
   * customer keeps. A fixed column cannot be right for labels that are data.
   * The floor keeps every block whose labels already fit laid out exactly as
   * before, so no document that renders correctly today moves.
   */
  const widest = rows.reduce(
    (max, row) => Math.max(max, textWidth(row.label, SIZE.body)),
    0,
  );
  const labelWidth = Math.max(78, Math.ceil(widest) + 6);
  for (const row of rows) {
    sheet.need(GAP.line);
    sheet.pdf.text(x, sheet.cursor, row.label, { size: SIZE.body, colour: MUTED });
    for (const [index, line] of PdfBuilder.wrap(
      row.value,
      width - labelWidth,
      SIZE.body,
      row.mono === true ? 'regular' : 'regular',
    ).entries()) {
      if (index > 0) sheet.move(GAP.line);
      sheet.pdf.text(x + labelWidth, sheet.cursor, line, { size: SIZE.body, colour: BODY });
    }
    sheet.move(GAP.line);
  }
};

const header = (
  sheet: Sheet,
  model: JobCardModel,
  letterhead: DocumentLetterhead | undefined,
  edition: JobCardEdition,
): void => {
  const top = sheet.cursor;

  /*
   * JOB-CARD-3: the EJE letterhead across the page's full width, the document's name and number in its
   * top-right corner (`drawFullWidthLetterhead`). The page below starts under its rule. An uploaded
   * letterhead (another company's) and the text header are unchanged.
   */
  if (hasJobCard3Layout(edition) && letterhead !== undefined && isMasterLetterhead(letterhead)) {
    // JOB-CARD-4: edition 8 aligned ("1465" on the Email line, the number inline with the company name).
    const ruleY = drawFullWidthLetterhead(sheet.pdf, model.documentTitle.toUpperCase(), model.jobNumber, hasAlignedHeader(edition));
    sheet.move(top - ruleY);
    sheet.rule(INK, 1.4);
    sheet.move(GAP.section);
    return;
  }

  /*
   * LETTERHEAD-1: the company's uploaded letterhead in place of the text
   * header — the tile, the name, the address, the contact and registration
   * lines are all ON it — with the document's name and number on one line
   * above the same rule. The cursor moves exactly as below, so the body
   * starts where it always has.
   */
  if (letterhead !== undefined) {
    drawLetterheadOverTitle(sheet.pdf, letterhead, top - 56, model.documentTitle.toUpperCase(), model.jobNumber);
    sheet.move(56);
    sheet.rule(INK, 1.4);
    sheet.move(GAP.section);
    return;
  }

  /*
   * The dark EJE tile, at the screen's size-11 (44px -> 31pt).
   *
   * MULTI-CO-1: the tile is EJE's own text mark, so it is drawn only on EJE's
   * documents. Another company's text header has no tile — never "EJE"
   * beside "WD Hearn JHB" — and its name stays where it always is, so the
   * layout is the same for both.
   */
  if (model.company.id === DEFAULT_COMPANY_ID) {
    sheet.pdf.rect(MARGIN, top - 24, 31, 31, INK);
    sheet.pdf.text(MARGIN + 6, top - 14, 'EJE', { font: 'bold', size: 9, colour: '#ffffff' });
  }

  sheet.pdf.text(MARGIN + 39, top - 6, model.company.name, {
    font: 'bold',
    size: SIZE.companyName,
    colour: INK,
  });
  sheet.pdf.text(MARGIN + 39, top - 17, model.company.address, {
    size: SIZE.small,
    colour: MUTED,
  });

  sheet.pdf.text(MARGIN, top - 40, model.company.contactLine, { size: SIZE.small, colour: MUTED });
  sheet.pdf.text(MARGIN, top - 50, model.company.registrationLine, {
    size: SIZE.small,
    colour: MUTED,
  });

  const title = model.documentTitle.toUpperCase();
  sheet.pdf.text(
    RIGHT - textWidth(title, SIZE.small, 'bold', TRACK_TITLE),
    top - 6,
    title,
    { font: 'bold', size: SIZE.small, colour: MUTED, tracking: TRACK_TITLE },
  );
  sheet.pdf.text(
    RIGHT - textWidth(model.jobNumber, SIZE.jobNumber, 'bold'),
    top - 24,
    model.jobNumber,
    { font: 'bold', size: SIZE.jobNumber, colour: INK },
  );
  /*
   * The header is the document's name and its number. Nothing else.
   *
   * It used to carry "Breakdown · Urgent" and "Status: Review" as well — EJE's
   * own workflow state, printed at the top of a page handed to a customer who
   * has no idea what Review means and no reason to. The job type and priority
   * are the job's own details and are printed with the rest of them.
   */
  // Below the registration line's descenders (its baseline is top - 50): at
  // 48 the rule was drawn THROUGH it (UX-TAB-1, seen on the rendered page).
  sheet.move(56);
  sheet.rule(INK, 1.4);
  sheet.move(GAP.section);
};

/** A small uppercase, letter-spaced label at `x` — the section titles' style. */
const smallHeading = (sheet: Sheet, x: number, label: string): void => {
  sheet.pdf.text(x, sheet.cursor, label.toUpperCase(), {
    font: 'bold',
    size: SIZE.small,
    colour: MUTED,
    tracking: TRACK_HEADING,
  });
  sheet.move(GAP.line);
};

/**
 * JOB-CARD-2 (the owner's annotated job card, 16 November 2026): the Machine and Job Details column
 * moved to the RIGHT ("Move Right") — a narrower column ending at the right margin — and the customer
 * column wider beside it.
 */
const DETAILS_COLUMN = 230;

const parties = (sheet: Sheet, model: JobCardModel): void => {
  const rightX = RIGHT - DETAILS_COLUMN;
  const leftWidth = rightX - MARGIN - 24;
  const top = sheet.cursor;

  // Left column: the customer and their site address…
  sheet.sectionTitle('Customer');
  sheet.paragraph(model.customer.name, { font: 'bold', colour: INK, width: leftWidth });
  for (const line of model.customer.addressLines) {
    sheet.paragraph(line, { colour: MUTED, width: leftWidth, leading: GAP.line });
  }
  /*
   * …then, apart from the address, the contact person, grouped under their own label ("Contact
   * details" on the owner's annotation): name, position, telephone and email, each on its own line.
   */
  if (model.customer.contact !== null) {
    const contact = model.customer.contact;
    sheet.move(7);
    smallHeading(sheet, MARGIN, 'Contact details');
    sheet.paragraph(contact.name, { font: 'bold', colour: BODY, width: leftWidth, leading: GAP.line });
    for (const line of [contact.position, contact.phone, contact.email]) {
      if (line.trim().length === 0) continue;
      sheet.paragraph(line, { colour: MUTED, width: leftWidth, leading: GAP.line });
    }
  }
  const leftBottom = sheet.cursor;
  const columnWidth = DETAILS_COLUMN;

  // Right column: the machine, then the job's own details. Laid out from the
  // same top as the left column, not from where the left column ended.
  sheet.setCursor(top);
  if (model.machine !== null) {
    sheet.pdf.text(rightX, sheet.cursor, 'MACHINE', {
      font: 'bold',
      size: SIZE.small,
      colour: MUTED,
      tracking: TRACK_HEADING,
    });
    sheet.move(GAP.line);
    // JOB-CARD-3: the machine's name is a labelled row of its own; the bold title line is not drawn.
    if (model.machine.title.length > 0) {
      sheet.paragraph(model.machine.title, {
        font: 'bold',
        colour: INK,
        width: columnWidth,
        x: rightX,
        leading: GAP.line,
      });
    }
    labelValueRows(sheet, model.machine.rows, rightX, columnWidth);
    sheet.move(6);
  }

  sheet.pdf.text(rightX, sheet.cursor, 'JOB DETAILS', {
    font: 'bold',
    size: SIZE.small,
    colour: MUTED,
    tracking: TRACK_HEADING,
  });
  sheet.move(GAP.line);
  labelValueRows(sheet, model.jobDetails, rightX, columnWidth);
  const rightBottom = sheet.cursor;

  // Continue below whichever column ran longer.
  sheet.setCursor(Math.min(leftBottom, rightBottom));
  sheet.move(GAP.section);
};

/** A section title over the screen's bordered, tinted box of text. */
const boxedText = (sheet: Sheet, title: string, text: string): void => {
  sheet.sectionTitle(title);
  const lines = PdfBuilder.wrap(text, CONTENT_WIDTH - 18, SIZE.body);
  const boxHeight = lines.length * GAP.line + 12;
  sheet.need(boxHeight + 6);

  // The screen's bordered, tinted box.
  sheet.pdf.rect(MARGIN, sheet.cursor - boxHeight + GAP.line, CONTENT_WIDTH, boxHeight, BAND);
  sheet.move(3);
  for (const line of lines) {
    sheet.pdf.text(MARGIN + 9, sheet.cursor, line, { size: SIZE.body, colour: BODY });
    sheet.move(GAP.line);
  }
  sheet.move(GAP.section - 3);
};

const fault = (sheet: Sheet, model: JobCardModel): void => {
  // Nothing to report, so no heading and no empty box. See the model.
  if (model.faultDescription === null) return;
  boxedText(sheet, 'Reported fault', model.faultDescription);
};

/**
 * PARTS RECEIVED, ITS OWN SECTION, DIRECTLY AFTER REPORTED FAULT. PDF-RECV-2
 * (the tester, 2 November 2026). Printed whether or not there is a reported
 * fault (a Test & Repair job need not have one), and once.
 */
const partsReceived = (sheet: Sheet, model: JobCardModel): void => {
  if (model.partsReceived === null) return;
  sheet.sectionTitle('Parts received');
  labelValueRows(sheet, model.partsReceived.rows, MARGIN, CONTENT_WIDTH);
  sheet.move(GAP.section - 4);
};

/*
 * WORK CARRIED OUT. JOB-CARD-2 (the owner's annotated job card, 16 November 2026).
 *
 * A clear hierarchy: "WORK CARRIED OUT" is the MAIN heading — larger and in the document's ink — the
 * five parts of the write-up are SUBHEADINGS — bold, a little stronger than the text — and the text
 * itself stays regular and subordinate. Nothing else is bold.
 *
 * "Next to each other": Fault findings and Diagnosis on the left, and Work performed,
 * Recommendations and General notes beside them on the right. When one side has nothing written (a
 * service job has no findings), or the two columns would not fit on one page, the blocks run down the
 * page in the same order instead — never a column split across pages.
 */
const MAIN_HEADING = 10;
const SUBHEADING = 8.5;
const WRITE_UP_LEADING = SIZE.body * 1.45;
const LEFT_WRITE_UP = new Set(['Fault findings', 'Diagnosis']);

type WorkBlock = JobCardModel['workBlocks'][number];

const MAIN_HEADING_HEIGHT = GAP.line + 4;

/** The main heading, on the same page as the `keepWith` points of content that follow it. */
const mainHeading = (sheet: Sheet, label: string, keepWith: number): void => {
  sheet.need(MAIN_HEADING_HEIGHT + keepWith);
  sheet.pdf.text(MARGIN, sheet.cursor, label.toUpperCase(), {
    font: 'bold',
    size: MAIN_HEADING,
    colour: INK,
    tracking: TRACK_HEADING,
  });
  sheet.move(GAP.line + 4);
};

const subheading = (sheet: Sheet, x: number, y: number, label: string): void => {
  sheet.pdf.text(x, y, label.toUpperCase(), { font: 'bold', size: SUBHEADING, colour: INK, tracking: 0.4 });
};

/** A column's height: each block's subheading, its wrapped text and the gap after it. */
const blocksHeight = (blocks: readonly WorkBlock[], width: number): number =>
  blocks.reduce((sum, block) => sum + GAP.line + PdfBuilder.wrap(block.value, width, SIZE.body).length * WRITE_UP_LEADING + 7, 0);

/** Draws a column from `top`; returns where it ended. The caller has made sure it fits. */
const drawBlocks = (sheet: Sheet, blocks: readonly WorkBlock[], x: number, width: number, top: number): number => {
  let y = top;
  for (const block of blocks) {
    subheading(sheet, x, y, block.label);
    y -= GAP.line;
    for (const line of PdfBuilder.wrap(block.value, width, SIZE.body)) {
      sheet.pdf.text(x, y, line, { size: SIZE.body, colour: BODY });
      y -= WRITE_UP_LEADING;
    }
    y -= 7;
  }
  return y;
};

const work = (sheet: Sheet, model: JobCardModel): void => {
  if (model.workBlocks.length === 0) return;
  // As in `JobCardDocument`: an unwritten field is not a block at all (DOC-1).
  const left = model.workBlocks.filter((block) => LEFT_WRITE_UP.has(block.label));
  const right = model.workBlocks.filter((block) => !LEFT_WRITE_UP.has(block.label));
  const columnWidth = (CONTENT_WIDTH - 24) / 2;
  const tallest = Math.max(blocksHeight(left, columnWidth), blocksHeight(right, columnWidth));
  const pageRoom = A4_HEIGHT - MARGIN * 2 - FOOTER_SPACE - MAIN_HEADING_HEIGHT;
  const remaining = sheet.cursor - (MARGIN + FOOTER_SPACE) - MAIN_HEADING_HEIGHT;
  /*
   * The heading is never left on its own (the independent review): it is kept with what follows it.
   * The two columns are drawn where they fit; when they do not, they go to the next page WITH the
   * heading — but only if little of this page would be lost. Otherwise the write-up runs down the page
   * in one column, so a long write-up leaves neither a lone heading nor half a page blank.
   */
  const twoColumns = left.length > 0 && right.length > 0 && tallest <= pageRoom && (tallest <= remaining || remaining < pageRoom * 0.4);
  if (twoColumns) {
    mainHeading(sheet, 'Work carried out', tallest);
    const top = sheet.cursor;
    const leftEnd = drawBlocks(sheet, left, MARGIN, columnWidth, top);
    const rightEnd = drawBlocks(sheet, right, MARGIN + columnWidth + 24, columnWidth, top);
    sheet.setCursor(Math.min(leftEnd, rightEnd));
  } else {
    // The heading with the first block's subheading and its first two lines.
    mainHeading(sheet, 'Work carried out', GAP.line + WRITE_UP_LEADING * 2);
    for (const block of model.workBlocks) {
      sheet.need(GAP.line * 2 + WRITE_UP_LEADING);
      subheading(sheet, MARGIN, sheet.cursor, block.label);
      sheet.move(GAP.line);
      sheet.paragraph(block.value, { colour: BODY, font: 'regular', leading: WRITE_UP_LEADING });
      sheet.move(7);
    }
  }
  sheet.move(GAP.section - 7);
};

const notes = (sheet: Sheet, model: JobCardModel): void => {
  if (model.notes.length === 0) return;
  sheet.sectionTitle('Job notes');
  for (const note of model.notes) {
    sheet.paragraph(note.body, { colour: BODY });
    sheet.paragraph(note.byline, { size: SIZE.tiny, colour: MUTED, leading: GAP.tight });
    sheet.move(5);
  }
  sheet.move(GAP.section - 5);
};

/*
 * THE LABOUR, TRAVEL AND PARTS TABLE. JOB-CARD-2 (the owner's layout drawing, 16 November 2026):
 *
 *   Date | Description | Qty | Rate | Amount
 *
 * The Date is the day the work or the travel was DONE, as recorded on that entry; a part, the
 * call-out fee and any other charge have no such day and leave it blank (never an invented date).
 * The header band has no line drawn through it under its labels ("Line removed"); the band's own
 * edge, the rows' hairlines and the rules that set off Subtotal, VAT and Total stay.
 *
 * Figures are right-aligned by their exact width, so every column's right edge is one straight line.
 */
const DATE_X = MARGIN;
const DESCRIPTION_X = MARGIN + 64;
// The figures' right edges, tighter than the old table's so the Date column costs the description little, and
// 14pt inside the margin: a reader whose font runs 16% wide (SUBSTITUTION_ALLOWANCE) still stays inside it.
const TABLE_QTY = RIGHT - 160;
const TABLE_RATE = RIGHT - 95;
const TABLE_AMOUNT = RIGHT - 14;
const DESCRIPTION_WIDTH = TABLE_QTY - 48 - DESCRIPTION_X;

/** A string's width as a PDF viewer advances it (no substitution allowance): for right alignment. */
const exactWidth = (value: string, size: number, font: 'regular' | 'bold' = 'regular'): number =>
  textWidth(value, size, font) / SUBSTITUTION_ALLOWANCE;

const rightAligned = (sheet: Sheet, x: number, y: number, value: string, size: number, font: 'regular' | 'bold', colour: string): void => {
  sheet.pdf.text(x - exactWidth(value, size, font), y, value, { size, font, colour });
};

/** The table's header band: its labels in it, its lower edge ruled — nothing drawn through it. */
const tableHeader = (sheet: Sheet): void => {
  sheet.pdf.rect(MARGIN, sheet.cursor - 5, CONTENT_WIDTH, 16, BAND);
  sheet.pdf.text(DATE_X, sheet.cursor, 'Date', { font: 'bold', size: SIZE.small, colour: BODY });
  sheet.pdf.text(DESCRIPTION_X, sheet.cursor, 'Description', { font: 'bold', size: SIZE.small, colour: BODY });
  for (const [x, label] of [
    [TABLE_QTY, 'Qty'],
    [TABLE_RATE, 'Rate'],
    [TABLE_AMOUNT, 'Amount'],
  ] as const) {
    rightAligned(sheet, x, sheet.cursor, label, SIZE.small, 'bold', BODY);
  }
  sheet.move(5);
  sheet.rule(RULE, 0.6);
  sheet.move(GAP.line + 4);
};

const chargeLine = (sheet: Sheet, row: ChargeRow): void => {
  const description =
    row.detail.length > 0 ? `${row.description} — ${row.detail}` : row.description;
  const lines = PdfBuilder.wrap(description, DESCRIPTION_WIDTH, SIZE.body);

  // A row that has to start a new page starts it under the column headings again.
  const height = lines.length * GAP.line + 8;
  if (sheet.wouldOverflow(height)) {
    sheet.need(height + 30);
    tableHeader(sheet);
  }
  const rowTop = sheet.cursor;

  if (row.date.length > 0) sheet.pdf.text(DATE_X, rowTop, row.date, { size: SIZE.body, colour: BODY });
  lines.forEach((line, index) => {
    sheet.pdf.text(DESCRIPTION_X, sheet.cursor, line, {
      size: SIZE.body,
      colour: index === 0 ? BODY : MUTED,
    });
    if (index < lines.length - 1) sheet.move(GAP.line);
  });

  // Figures align to the first line of a wrapped description.
  rightAligned(sheet, TABLE_QTY, rowTop, row.quantity, SIZE.body, 'regular', BODY);
  rightAligned(sheet, TABLE_RATE, rowTop, row.rate, SIZE.body, 'regular', BODY);
  rightAligned(sheet, TABLE_AMOUNT, rowTop, row.amount, SIZE.body, 'bold', INK);

  sheet.move(7);
  sheet.rule(RULE_SOFT, 0.5);
  sheet.move(GAP.line - 2);
};

type Charges = NonNullable<JobCardModel['charges']>;

/**
 * The lines above Total: Subtotal and VAT — and, when a discount was given, the subtotal before it and
 * the discount with its reason first, as the on-screen job card has always shown (COST-5). The PDF
 * printed only the discounted subtotal, so its lines did not add up to it; the figures are the model's
 * own, nothing is calculated here.
 */
const totalsLines = (charges: Charges): readonly (readonly [label: string, value: string, note: string])[] => [
  ...(charges.discount === null
    ? []
    : [
        ['Subtotal', charges.discount.grossSubtotal, ''] as const,
        // A hyphen-minus: the PDF's standard fonts have no U+2212 (it printed as "?").
        ['Discount', `-${charges.discount.amount}`, `Discount — ${charges.discount.reason}`] as const,
      ]),
  [charges.discount === null ? 'Subtotal' : 'Subtotal after discount', charges.subtotal, ''],
  [charges.vatLabel, charges.vat, ''],
];

/** A discount's reason, wrapped in full beside its row (never cut: the screen shows all of it too). */
const noteLines = (note: string): readonly string[] =>
  note.length === 0 ? [] : PdfBuilder.wrap(note, TABLE_QTY - DESCRIPTION_X, SIZE.body, 'italic');

/** The height of the totals, as `charges` draws them. */
const totalsHeight = (charges: Charges): number =>
  4 + totalsLines(charges).reduce((sum, [, , note]) => sum + GAP.line + 2 + Math.max(0, noteLines(note).length - 1) * GAP.line, 0) + GAP.line + 2 + SIZE.total;

const charges = (sheet: Sheet, model: JobCardModel): void => {
  if (model.charges === null && model.received === null) return;
  sheet.sectionTitle('Labour, travel and parts');

  /*
   * PDF-RECV-1 (the tester, 1 November 2026): the collection is printed HERE,
   * first, and not under Job details. A document without prices (a courier's
   * copy) still prints it. The parts booked in have their own section since
   * PDF-RECV-2 (`partsReceived`, after Reported fault).
   */
  if (model.received !== null) {
    labelValueRows(sheet, model.received.rows, MARGIN, CONTENT_WIDTH);
    sheet.move(GAP.line - 4);
  }
  if (model.charges === null) return;

  // Header band, as on screen, with room for a first row under it; repeated on every further page.
  sheet.need(30 + GAP.line * 2);
  tableHeader(sheet);

  for (const row of model.charges.rows) chargeLine(sheet, row);

  /*
   * JOB-CARD-2: the customer's acceptance sits directly under the totals, so the totals and the
   * whole acceptance block go onto the same page — never a signature a page away from its total.
   */
  sheet.need(totalsHeight(model.charges) + 8 + acceptanceHeight(model));
  sheet.move(4);
  for (const [label, value, note] of totalsLines(model.charges)) {
    rightAligned(sheet, TABLE_RATE, sheet.cursor, label, SIZE.body, 'regular', MUTED);
    rightAligned(sheet, TABLE_AMOUNT, sheet.cursor, value, SIZE.body, 'regular', BODY);
    noteLines(note).forEach((line, index) => {
      if (index > 0) sheet.move(GAP.line);
      sheet.pdf.text(DESCRIPTION_X, sheet.cursor, line, { size: SIZE.body, font: 'italic', colour: MUTED });
    });
    sheet.move(GAP.line + 2);
  }

  sheet.rule(INK, 1.2, ACCEPTANCE_X, RIGHT);
  sheet.move(GAP.line + 2);
  rightAligned(sheet, TABLE_RATE, sheet.cursor, 'Total', SIZE.total, 'bold', INK);
  rightAligned(sheet, TABLE_AMOUNT, sheet.cursor, model.charges.total, SIZE.total, 'bold', INK);
  sheet.move(SIZE.total + 8);
};

/**
 * The goods, on a document that carries no prices.
 *
 * A courier Delivery Note used to list nothing at all: the whole parts table
 * lived inside the charges block, and the charges block is withheld from a
 * courier's copy in full — correctly, since none of the driver's business is
 * what the customer paid. The consequence was a delivery note with no delivery
 * on it, which neither the driver nor the receiving store could check a load
 * against, and which disagreed with the note shown on screen.
 *
 * Part numbers and quantities, and nothing that is a price. The model decides
 * whether this block exists at all, so no renderer can put it on the wrong copy.
 */
/**
 * The price-less goods table: part, quantity, a count of items and the note
 * saying why there are no prices. Drawn for a courier's copy and, since
 * INSTALL-DN-1, for the items an Installation Delivery Note lists.
 */
const goodsTable = (sheet: Sheet, block: NonNullable<JobCardModel['collection']>): void => {
  sheet.sectionTitle(block.heading);

  sheet.need(30);
  sheet.pdf.rect(MARGIN, sheet.cursor - 5, CONTENT_WIDTH, 16, BAND);
  sheet.rule(RULE, 0.6);
  sheet.move(-1);
  sheet.pdf.text(MARGIN, sheet.cursor, 'Part', {
    font: 'bold',
    size: SIZE.small,
    colour: BODY,
  });
  sheet.pdf.text(
    TABLE_AMOUNT - textWidth('Quantity', SIZE.small, 'bold'),
    sheet.cursor,
    'Quantity',
    { font: 'bold', size: SIZE.small, colour: BODY },
  );
  sheet.move(11);
  sheet.rule(RULE, 0.6);
  sheet.move(GAP.line);

  for (const line of block.lines) {
    const width = TABLE_AMOUNT - MARGIN - 80;
    const text =
      line.description.length > 0 ? `${line.partNumber} — ${line.description}` : line.partNumber;
    const wrapped = PdfBuilder.wrap(text, width, SIZE.body);

    sheet.need(wrapped.length * GAP.line + 8);
    const rowTop = sheet.cursor;
    wrapped.forEach((part, index) => {
      sheet.pdf.text(MARGIN, sheet.cursor, part, {
        size: SIZE.body,
        colour: index === 0 ? BODY : MUTED,
      });
      if (index < wrapped.length - 1) sheet.move(GAP.line);
    });
    sheet.pdf.text(
      TABLE_AMOUNT - textWidth(line.quantity, SIZE.body, 'bold'),
      rowTop,
      line.quantity,
      { size: SIZE.body, font: 'bold', colour: INK },
    );

    sheet.move(7);
    sheet.rule(RULE_SOFT, 0.5);
    sheet.move(GAP.line - 2);
  }

  /*
   * "Items", never "Total".
   *
   * A count of goods is not a figure of money, and the word "Total" on a
   * document that deliberately carries no prices invites exactly the reading
   * the suppression exists to prevent.
   */
  sheet.need(20);
  sheet.pdf.text(MARGIN, sheet.cursor, block.totalLabel, {
    font: 'bold',
    size: SIZE.body,
    colour: INK,
  });
  sheet.pdf.text(
    TABLE_AMOUNT - textWidth(block.totalQuantity, SIZE.body, 'bold'),
    sheet.cursor,
    block.totalQuantity,
    { font: 'bold', size: SIZE.body, colour: INK },
  );
  sheet.move(GAP.line + 2);

  sheet.paragraph(block.priceNote, { size: SIZE.tiny, colour: MUTED });
  sheet.move(GAP.section - 6);
};

const collection = (sheet: Sheet, model: JobCardModel): void => {
  if (model.collection === null) return;
  goodsTable(sheet, model.collection);
};

/**
 * THE INSTALLATION DELIVERY NOTE'S OWN SECTIONS. INSTALL-DN-1.
 *
 * What was installed (the job's description, then the items it recorded, in
 * the courier note's price-less goods table), and the labour: each line's
 * technician, date, work and hours, the hours recorded, and when the work,
 * the checklist and the sign-off were completed. No column here is a price,
 * a rate or an amount — the model carries none to draw.
 */
const installationDelivered = (sheet: Sheet, model: JobCardModel): void => {
  const block = model.installation;
  if (block === undefined) return;
  if (block.description !== null) boxedText(sheet, 'Installation', block.description);
  if (block.items.length > 0) {
    goodsTable(sheet, {
      heading: 'Items delivered and installed',
      lines: block.items,
      totalLabel: 'Items',
      totalQuantity: block.itemCount,
      priceNote: block.priceNote,
    });
  }
};

const installationLabour = (sheet: Sheet, model: JobCardModel): void => {
  const block = model.installation;
  if (block === undefined) return;
  sheet.sectionTitle('Labour and completion');

  const TECH = MARGIN;
  const DATE = MARGIN + 130;
  const WORK = MARGIN + 205;
  const HOURS = RIGHT;
  const headings = () => {
    sheet.pdf.rect(MARGIN, sheet.cursor - 5, CONTENT_WIDTH, 16, BAND);
    sheet.rule(RULE, 0.6);
    sheet.move(-1);
    for (const [x, label] of [
      [TECH, 'Technician'],
      [DATE, 'Date'],
      [WORK, 'Work'],
    ] as const) {
      sheet.pdf.text(x, sheet.cursor, label, { font: 'bold', size: SIZE.small, colour: BODY });
    }
    sheet.pdf.text(HOURS - textWidth('Hours', SIZE.small, 'bold'), sheet.cursor, 'Hours', {
      font: 'bold',
      size: SIZE.small,
      colour: BODY,
    });
    sheet.move(11);
    sheet.rule(RULE, 0.6);
    sheet.move(GAP.line);
  };

  if (block.labour.length === 0) {
    sheet.paragraph('No labour is recorded on this job.', { colour: MUTED });
  } else {
    sheet.need(30);
    headings();
    for (const line of block.labour) {
      const work = PdfBuilder.wrap(line.work.length > 0 ? line.work : '—', HOURS - 50 - WORK, SIZE.body);
      const who = PdfBuilder.wrap(line.technician, DATE - TECH - 8, SIZE.body);
      const height = Math.max(work.length, who.length);
      if (sheet.wouldOverflow(height * GAP.line + 8)) {
        sheet.need(height * GAP.line + 8);
        headings();
      }
      const rowTop = sheet.cursor;
      sheet.pdf.text(DATE, rowTop, line.date, { size: SIZE.body, colour: BODY });
      sheet.pdf.text(HOURS - textWidth(line.hours, SIZE.body, 'bold'), rowTop, line.hours, {
        size: SIZE.body,
        font: 'bold',
        colour: INK,
      });
      for (let index = 0; index < height; index += 1) {
        if (index > 0) sheet.move(GAP.line);
        if (who[index] !== undefined) sheet.pdf.text(TECH, sheet.cursor, who[index]!, { size: SIZE.body, colour: BODY });
        if (work[index] !== undefined) sheet.pdf.text(WORK, sheet.cursor, work[index]!, { size: SIZE.body, colour: BODY });
      }
      sheet.move(7);
      sheet.rule(RULE_SOFT, 0.5);
      sheet.move(GAP.line - 2);
    }
    sheet.need(20);
    sheet.pdf.text(WORK, sheet.cursor, 'Hours recorded', { font: 'bold', size: SIZE.body, colour: INK });
    sheet.pdf.text(HOURS - textWidth(block.hoursRecorded, SIZE.body, 'bold'), sheet.cursor, block.hoursRecorded, {
      font: 'bold',
      size: SIZE.body,
      colour: INK,
    });
    sheet.move(GAP.line + 6);
  }

  labelValueRows(sheet, block.completion, MARGIN, CONTENT_WIDTH);
  sheet.move(4);
  // Said once: under the items when there are any, otherwise here.
  if (block.items.length === 0) sheet.paragraph(block.priceNote, { size: SIZE.tiny, colour: MUTED });
  sheet.move(GAP.section - 6);
};

const checklist = (sheet: Sheet, model: JobCardModel): void => {
  if (model.checklist === null) return;

  const list = model.checklist;
  sheet.sectionTitle(list.title);
  // CHK-SRC-1: the source document's own title, and the checklist chosen.
  if (list.documentTitle !== null) {
    sheet.paragraph(list.documentTitle, { size: SIZE.small, colour: INK, leading: GAP.line, font: 'bold' });
  }
  if (list.checklistType !== null) {
    sheet.paragraph(list.checklistType, { size: SIZE.small, colour: BODY, leading: GAP.line, font: 'bold' });
  }
  sheet.paragraph(list.summary, { size: SIZE.small, colour: MUTED, leading: GAP.line });
  sheet.move(5);

  // The source's header lines, filled from the job; a blank stays blank.
  for (const line of list.header) {
    sheet.need(GAP.line + 2);
    sheet.pdf.text(MARGIN, sheet.cursor, line.label, { font: 'bold', size: SIZE.small, colour: BODY });
    sheet.pdf.text(MARGIN + 110, sheet.cursor, line.value, { size: SIZE.small, colour: INK });
    sheet.move(GAP.line);
  }
  if (list.header.length > 0) sheet.move(4);

  const NUMBER_WIDTH = 18;
  for (const section of list.sections) {
    if (section.title.length > 0) {
      // A section heading alone at the foot of a page helps nobody.
      sheet.need(GAP.line * 3);
      sheet.pdf.text(MARGIN, sheet.cursor, section.title.toUpperCase(), {
        font: 'bold',
        size: SIZE.small,
        colour: BODY,
        tracking: 0.45,
      });
      sheet.move(6);
      sheet.rule(RULE, 0.6);
      sheet.move(GAP.line);
    }

    for (const item of section.items) {
      const answerWidth = textWidth(item.answer, SIZE.body, 'bold');
      // A long text answer gets its own line rather than colliding with the
      // question, which is what made the on-screen and PDF versions differ.
      const inline = answerWidth < 150;
      const questionWidth =
        (inline ? CONTENT_WIDTH - answerWidth - 18 : CONTENT_WIDTH) - NUMBER_WIDTH;
      // A line the source starts on its own stays on its own.
      const lines = item.text
        .split('\n')
        .flatMap((part) => PdfBuilder.wrap(part, questionWidth, SIZE.body));
      const extraLines = [
        ...(item.sourceNote.length > 0 ? [item.sourceNote] : []),
        ...(item.readings.length > 0 ? [item.readings] : []),
      ].flatMap((line) => PdfBuilder.wrap(line, CONTENT_WIDTH - NUMBER_WIDTH, SIZE.small));
      const noteLines =
        item.note.length > 0
          ? PdfBuilder.wrap(`Note: ${item.note}`, CONTENT_WIDTH - 12, SIZE.tiny)
          : [];

      sheet.need(
        (lines.length +
          extraLines.length +
          noteLines.length +
          (inline ? 0 : 1) +
          (item.groupHeading.length > 0 ? 1 : 0)) *
          GAP.line +
          8,
      );
      if (item.groupHeading.length > 0) {
        sheet.pdf.text(MARGIN, sheet.cursor, item.groupHeading, {
          font: 'bold',
          size: SIZE.body,
          colour: INK,
        });
        sheet.move(GAP.line);
      }
      const rowTop = sheet.cursor;

      if (item.number.length > 0) {
        sheet.pdf.text(MARGIN, rowTop, item.number, { size: SIZE.body, colour: MUTED });
      }
      lines.forEach((line, index) => {
        sheet.pdf.text(MARGIN + NUMBER_WIDTH, sheet.cursor, line, { size: SIZE.body, colour: BODY });
        if (index < lines.length - 1) sheet.move(GAP.line);
      });
      for (const line of extraLines) {
        sheet.move(GAP.line);
        sheet.pdf.text(MARGIN + NUMBER_WIDTH, sheet.cursor, line, { size: SIZE.small, colour: BODY });
      }

      if (inline) {
        sheet.pdf.text(RIGHT - answerWidth, rowTop, item.answer, {
          font: 'bold',
          size: SIZE.body,
          colour: INK,
        });
      } else {
        sheet.move(GAP.line);
        for (const line of PdfBuilder.wrap(item.answer, CONTENT_WIDTH - 12, SIZE.body, 'bold')) {
          sheet.pdf.text(MARGIN + 12, sheet.cursor, line, {
            font: 'bold',
            size: SIZE.body,
            colour: INK,
          });
          sheet.move(GAP.line);
        }
        sheet.move(-GAP.line);
      }

      for (const line of noteLines) {
        sheet.move(GAP.tight);
        sheet.pdf.text(MARGIN + 12, sheet.cursor, line, { size: SIZE.tiny, colour: MUTED });
      }

      sheet.move(6);
      sheet.rule(RULE_SOFT, 0.5);
      sheet.move(GAP.line - 2);
    }
    sheet.move(6);
  }

  for (const note of list.notes) {
    sheet.paragraph(note, { size: SIZE.small, colour: BODY, leading: GAP.line });
  }
  if (list.closing.length > 0) {
    sheet.need(GAP.line * 2);
    sheet.pdf.text(MARGIN, sheet.cursor, list.closing, { font: 'bold', size: SIZE.body, colour: INK });
    sheet.move(GAP.line + 2);
  }
  for (const line of list.signatures) {
    const value = line.value.length > 0 ? line.value : '—';
    const valueLines = PdfBuilder.wrap(value, CONTENT_WIDTH - 150, SIZE.small);
    sheet.need(valueLines.length * GAP.line + 2);
    sheet.pdf.text(MARGIN, sheet.cursor, line.label, { font: 'bold', size: SIZE.small, colour: BODY });
    valueLines.forEach((text, index) => {
      sheet.pdf.text(MARGIN + 150, sheet.cursor, text, { size: SIZE.small, colour: INK });
      if (index < valueLines.length - 1) sheet.move(GAP.line);
    });
    sheet.move(GAP.line);
  }
  sheet.move(GAP.section - 6);
};

/**
 * THE PHOTOGRAPHS THEMSELVES, NOT THEIR CAPTIONS.
 *
 * This printed a bullet list of captions — and the on-screen card a grey box
 * labelled "Photograph" — because the writer could not draw an image and the
 * model carried no pixels. Now each customer-facing photograph is drawn in the
 * on-screen card's own grid: three across, each in a 4:3 cell, the photograph
 * fitted inside it at its own proportions (never stretched, never cropped) and
 * centred, with its caption beneath.
 *
 * A photograph whose file cannot be drawn — not loaded, not in storage, a
 * format the writer cannot embed — gets the same cell with a plain statement
 * of why, so the document never shows an empty frame that reads as a picture.
 */
const PHOTO_GAP = 8.4; // gap-3
const PHOTO_CAPTION_LEADING = 9;

interface PhotoGrid {
  readonly columns: number;
  readonly width: number;
  readonly height: number;
}

const photoGrid = (columns: number): PhotoGrid => {
  const width = (CONTENT_WIDTH - PHOTO_GAP * (columns - 1)) / columns;
  return { columns, width, height: (width * 3) / 4 }; // aspect-4/3
};

/** The job card's grid: three across, as on screen. */
const JOB_CARD_PHOTOS = photoGrid(3);
/**
 * INSTALL-DN-1: the Installation Delivery Note's photographs are its evidence
 * of the installation, so they are drawn two across — half the content width
 * each, readable on paper. More photographs make more pages, never smaller
 * ones; a row is never split across a page.
 */
const INSTALLATION_PHOTOS = photoGrid(2);

const photoCell = (
  sheet: Sheet,
  photo: JobCardModel['photos'][number],
  prepared: PreparedPhoto | undefined,
  x: number,
  top: number,
  grid: PhotoGrid,
): void => {
  const bottom = top - grid.height;
  sheet.pdf.rect(x, bottom, grid.width, grid.height, BAND);

  if (prepared?.kind === 'image') {
    const natural = displaySize(prepared.image);
    const scale = Math.min(grid.width / natural.width, grid.height / natural.height);
    const width = natural.width * scale;
    const height = natural.height * scale;
    sheet.pdf.image(
      prepared.image,
      x + (grid.width - width) / 2,
      bottom + (grid.height - height) / 2,
      width,
      height,
    );
  } else {
    const reason =
      prepared?.reason ?? 'The image file was not available when this document was produced.';
    const inset = 8;
    let y = top - inset - SIZE.tiny;
    sheet.pdf.text(x + inset, y, 'Photograph not shown', {
      font: 'bold',
      size: SIZE.tiny,
      colour: MUTED,
    });
    for (const line of [
      ...PdfBuilder.wrap(reason, grid.width - inset * 2, SIZE.tiny),
      ...PdfBuilder.wrap(photo.fileName, grid.width - inset * 2, SIZE.tiny),
    ]) {
      y -= PHOTO_CAPTION_LEADING;
      if (y < bottom + inset) break;
      sheet.pdf.text(x + inset, y, line, { size: SIZE.tiny, colour: FAINT });
    }
  }
  // The cell's hairline, drawn last so the photograph sits inside it.
  sheet.pdf.line(x, top, x + grid.width, top, 0.5, RULE);
  sheet.pdf.line(x, bottom, x + grid.width, bottom, 0.5, RULE);
  sheet.pdf.line(x, bottom, x, top, 0.5, RULE);
  sheet.pdf.line(x + grid.width, bottom, x + grid.width, top, 0.5, RULE);
};

const photographs = (
  sheet: Sheet,
  model: JobCardModel,
  images: ReadonlyMap<string, PreparedPhoto> | undefined,
  grid: PhotoGrid = JOB_CARD_PHOTOS,
): void => {
  if (model.photos.length === 0) return;
  /*
   * JOB-CARD-2 (the owner: "Always on new page! Heading + image together."): the photographs begin
   * on a page of their own — after the acceptance and the checklist — so the heading is never left at
   * the foot of a page; the heading and the first row are drawn together at its top. No photographs,
   * no page.
   */
  sheet.newPage();
  sheet.sectionTitle('Photographs');
  for (let start = 0; start < model.photos.length; start += grid.columns) {
    const row = model.photos.slice(start, start + grid.columns);
    const captions = row.map((photo) =>
      photo.caption.trim().length === 0
        ? []
        : PdfBuilder.wrap(photo.caption, grid.width, SIZE.tiny),
    );
    const captionLines = Math.max(0, ...captions.map((lines) => lines.length));
    const rowHeight = grid.height + (captionLines === 0 ? 0 : 4 + captionLines * PHOTO_CAPTION_LEADING);
    // A row is never split across a page: a photograph cut in half is worse
    // than white space at the foot of a page.
    sheet.need(rowHeight + SIZE.small);
    const top = sheet.cursor + SIZE.small;
    row.forEach((photo, column) => {
      const x = MARGIN + column * (grid.width + PHOTO_GAP);
      photoCell(sheet, photo, images?.get(photo.id), x, top, grid);
      captions[column]!.forEach((line, index) => {
        sheet.pdf.text(
          x,
          top - grid.height - 4 - SIZE.tiny - index * PHOTO_CAPTION_LEADING,
          line,
          { size: SIZE.tiny, colour: MUTED },
        );
      });
    });
    sheet.move(rowHeight + PHOTO_GAP);
  }
  sheet.move(GAP.section);
};

/*
 * THE CUSTOMER'S ACCEPTANCE. JOB-CARD-2 (the owner's annotated job card, 16 November 2026): "Customer
 * acceptance block with signature should move to right under Subtotal, VAT, Total line." The WHOLE
 * block — its heading, the declaration, who signed and when, the signature and its caption — in the
 * right-hand column under the totals (the column the Total rule spans), kept together on one page,
 * and before the checklist and the photographs.
 *
 * A refusal takes the same place: it states what happened, why, who took it and when, and draws no
 * signature mark of any kind. A document with no totals (an Installation Delivery Note, a courier's
 * copy) has the block in the same column, where its sign-off comes.
 */
const ACCEPTANCE_X = RIGHT - 250;
const ACCEPTANCE_WIDTH = RIGHT - ACCEPTANCE_X;
const SIGNATURE_BOX = 62;
const PARAGRAPH_LEADING = SIZE.body * 1.45;

const acceptanceTitle = (model: JobCardModel): string =>
  model.acceptance === null
    ? 'Customer acceptance'
    // "Courier signature — given once, on the Delivery Note" titles as "Courier acceptance".
    : `${model.acceptance.caption.split(' signature')[0]} acceptance`;

const rowsHeight = (rows: readonly LabelValue[], width: number): number => {
  const widest = rows.reduce((max, row) => Math.max(max, textWidth(row.label, SIZE.body)), 0);
  const labelWidth = Math.max(78, Math.ceil(widest) + 6);
  return rows.reduce((sum, row) => sum + PdfBuilder.wrap(row.value, width - labelWidth, SIZE.body).length * GAP.line, 0);
};

/** The block's whole height, so the caller can keep it (and the totals above it) on one page. */
const acceptanceHeight = (model: JobCardModel): number => {
  const lines = (text: string, size: number = SIZE.body, font: 'regular' | 'bold' = 'regular') =>
    PdfBuilder.wrap(text, ACCEPTANCE_WIDTH, size, font).length;
  if (model.refusal !== null) {
    return GAP.section + GAP.line + lines(model.refusal.heading.toUpperCase(), SIZE.total, 'bold') * SIZE.total * 1.45 + 4
      + GAP.line + lines(model.refusal.reason) * PARAGRAPH_LEADING + 5 + rowsHeight(model.refusal.rows, ACCEPTANCE_WIDTH) + GAP.section;
  }
  if (model.acceptance === null) return GAP.section + GAP.line + PARAGRAPH_LEADING + GAP.section;
  return GAP.section + GAP.line + lines(model.acceptance.declaration) * PARAGRAPH_LEADING + 5
    + rowsHeight(model.acceptance.rows, ACCEPTANCE_WIDTH) + 16 + SIGNATURE_BOX + 14 + GAP.section;
};

const acceptance = (sheet: Sheet, model: JobCardModel): void => {
  const x = ACCEPTANCE_X;
  const width = ACCEPTANCE_WIDTH;
  // The whole block stays together: a signature on a different page from the declaration it
  // belongs to is not an acceptance. (Under the totals, `charges` has already made room for it.)
  sheet.need(acceptanceHeight(model));
  sheet.move(GAP.section);

  if (model.refusal !== null) {
    const block = model.refusal;
    smallHeading(sheet, x, 'Customer acceptance');
    sheet.paragraph(block.heading.toUpperCase(), { font: 'bold', size: SIZE.total, colour: INK, width, x });
    sheet.move(4);
    sheet.paragraph('Reason', { font: 'bold', size: SIZE.small, colour: MUTED, leading: GAP.line, width, x });
    sheet.paragraph(block.reason, { colour: BODY, width, x });
    sheet.move(5);
    labelValueRows(sheet, block.rows, x, width);
    sheet.move(GAP.section);
    return;
  }

  smallHeading(sheet, x, acceptanceTitle(model));
  if (model.acceptance === null) {
    sheet.paragraph('Not yet signed.', { font: 'italic', colour: MUTED, width, x });
    sheet.move(GAP.section);
    return;
  }

  // The declaration, then who signed and when…
  sheet.paragraph(model.acceptance.declaration, { colour: BODY, width, x });
  sheet.move(5);
  labelValueRows(sheet, model.acceptance.rows, x, width);

  // …then the signature itself, in the screen's bordered, tinted box, the full width of the column.
  const boxTop = sheet.cursor + 4;
  const boxBottom = boxTop - SIGNATURE_BOX;
  sheet.pdf.rect(x, boxBottom, width, SIGNATURE_BOX, BAND);
  sheet.pdf.line(x, boxTop, x + width, boxTop, 0.6, RULE);
  sheet.pdf.line(x, boxBottom, x + width, boxBottom, 0.6, RULE);
  sheet.pdf.line(x, boxTop, x, boxBottom, 0.6, RULE);
  sheet.pdf.line(x + width, boxTop, x + width, boxBottom, 0.6, RULE);

  const mark = signatureFacsimile(model.acceptance.signatureData);
  if (mark.kind === 'path') {
    // The customer's own geometry, in the same pure black the signature pad and
    // the on-screen job card use.
    sheet.pdf.normalisedPath(
      mark.path,
      // SIG-MOBILE-1: the stored 4:1 signature space, drawn at 4:1 inside the box.
      fitSignatureBox({ x: x + 10, y: boxBottom + 7, width: width - 20, height: SIGNATURE_BOX - 14 }),
      { colour: SIGNATURE_INK, width: 1.5 },
    );
  } else {
    // A seeded job stores a label rather than captured geometry, and the
    // on-screen card draws the name in a cursive face. Matched here, or the two
    // documents would show different things in the same box.
    const centred = x + width / 2 - textWidth(mark.text, SIZE.signature, 'script') / 2;
    sheet.pdf.text(centred, boxBottom + SIGNATURE_BOX / 2 - 5, mark.text, {
      font: 'script',
      size: SIZE.signature,
      colour: SIGNATURE_INK,
    });
  }

  sheet.pdf.text(x, boxBottom - 11, model.acceptance.caption, { size: SIZE.tiny, colour: MUTED });
  sheet.setCursor(boxBottom - 11);
  sheet.move(GAP.section);
};

/**
 * THE STAMP ON A DEMONSTRATION DOCUMENT. October mandate §1.1.
 *
 * On EVERY PAGE, and in the file itself rather than only on the screen that
 * produced it: a PDF is downloaded, emailed, printed and filed, and by then
 * the screen's badge is long gone. A demonstration job card that reaches
 * somebody's desk looking exactly like an issued one is the single most
 * expensive confusion this system could create — it is the document a customer
 * signs and a dispute is settled by.
 *
 * Drawn in the footer band, where there is always room on every page, and in
 * the strongest ink the document uses rather than the faint grey the rest of
 * the band is in. Nothing is drawn for a genuine document: the absence of this
 * line is what makes its presence mean something.
 */
const simulatedStamp = (sheet: Sheet): void => {
  const width = textWidth(SIMULATED_NOTICE_PRINT, SIZE.small);
  sheet.pdf.rect(MARGIN, MARGIN + 29, CONTENT_WIDTH, 14, BAND);
  sheet.pdf.text(MARGIN + (CONTENT_WIDTH - width) / 2, MARGIN + 33, SIMULATED_NOTICE_PRINT, {
    size: SIZE.small,
    colour: INK,
  });
};

const footers = (
  sheet: Sheet,
  model: JobCardModel,
  fileName: string,
  simulated: boolean,
): void => {
  const total = sheet.pdf.pageCount;
  for (let index = 0; index < total; index += 1) {
    sheet.pdf.selectPage(index);
    if (simulated) simulatedStamp(sheet);
    sheet.pdf.line(MARGIN, MARGIN + 26, RIGHT, MARGIN + 26, 0.5, RULE);

    model.footerLines.forEach((line, lineIndex) => {
      sheet.pdf.text(MARGIN, MARGIN + 16 - lineIndex * 9, line, {
        size: SIZE.tiny,
        colour: FAINT,
      });
    });

    const page = `Page ${index + 1} of ${total}`;
    sheet.pdf.text(RIGHT - textWidth(page, SIZE.tiny), MARGIN + 16, page, {
      size: SIZE.tiny,
      colour: FAINT,
    });
    sheet.pdf.text(
      RIGHT - textWidth(fileName, SIZE.tiny),
      MARGIN + 7,
      fileName,
      { size: SIZE.tiny, colour: FAINT },
    );
  }
};

/** Renders the final document for a job, returning the bytes and page count. */
export const renderJobCardPdf = (
  source: FinalDocumentSource,
  fileName: string,
  generatedAt: string,
): RenderedPdf => {
  // JOB-CARD-3/-4: editions 6 and 7 redraw a job card issued in v1.15.0 / v1.16.0 exactly as it was; anything else is 8.
  const edition: JobCardEdition =
    source.layout === JOB_CARD_2_RENDERER || source.layout === JOB_CARD_3_RENDERER ? source.layout : JOB_CARD_LAYOUT_RENDERER;
  const model = buildJobCardModel({ ...source, generatedAt, edition });
  const sheet = new Sheet();

  if (model.installation !== undefined) {
    /*
     * THE INSTALLATION DELIVERY NOTE. INSTALL-DN-1: the same letterhead,
     * parties, write-up, checklist, photographs and acceptance as the job
     * card, drawn by the same functions, in the delivery note's order — what
     * was installed, the work, the labour, the checklist, the photographs,
     * the sign-off — and with no charges block, because the model has none.
     */
    header(sheet, model, source.letterhead, edition);
    parties(sheet, model);
    installationDelivered(sheet, model);
    work(sheet, model);
    installationLabour(sheet, model);
    notes(sheet, model);
    // JOB-CARD-2: the sign-off, then the supporting sections, then the photographs on their own page.
    acceptance(sheet, model);
    checklist(sheet, model);
    photographs(sheet, model, source.photoImages, INSTALLATION_PHOTOS);
    footers(sheet, model, fileName, source.job.finalDocument?.provenance === 'simulated');
    return { bytes: sheet.pdf.toBytes(), pageCount: sheet.pdf.pageCount };
  }

  header(sheet, model, source.letterhead, edition);
  parties(sheet, model);
  fault(sheet, model);
  partsReceived(sheet, model);
  work(sheet, model);
  notes(sheet, model);
  charges(sheet, model);
  collection(sheet, model);
  /*
   * JOB-CARD-2: the customer's acceptance directly under the totals, on the right; then the
   * supporting sections (the checklist); then the photographs, on a page of their own.
   */
  acceptance(sheet, model);
  checklist(sheet, model);
  photographs(sheet, model, source.photoImages);
  /*
   * WHETHER THIS IS A DEMONSTRATION DOCUMENT, taken from the JOB'S OWN RECORD.
   *
   * `finalDocument.provenance` is what the seed wrote for the six demonstration
   * job cards; a document being issued for the first time has no record yet and
   * is therefore genuine, which is the right default — a preview of a real job
   * must not be stamped.
   */
  footers(sheet, model, fileName, source.job.finalDocument?.provenance === 'simulated');

  return { bytes: sheet.pdf.toBytes(), pageCount: sheet.pdf.pageCount };
};
