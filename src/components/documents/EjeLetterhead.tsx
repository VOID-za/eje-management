import { useId, type ReactNode } from 'react';
import { companies } from '@/api/endpoints';
import type { LetterheadReference } from '@/domain';
import { textWidth } from '@/lib/pdf/writer';
import {
  LETTERHEAD_REFERENCE,
  carriesMasterLetterhead,
  fullWidthHeaderGeometry,
  type FullWidthHeaderStyle,
  type FullWidthTitleSlot,
  type LetterheadLine,
  layoutLetterhead,
  letterheadLineGlyphs,
  letterheadLineMatrix,
  letterheadLineText,
  markPathData,
} from '@/lib/branding/eje-letterhead';

/**
 * THE EJE MASTER LETTERHEAD, ON SCREEN. LETTERHEAD-2 (15 November 2026), LETTERHEAD-4.
 *
 * The owner: one master header for every EJE document, identical in the in-app preview and
 * the PDF. So this draws the SAME `layoutLetterhead`, the SAME glyph outlines and the SAME
 * traced mark the PDF draws (`drawEjeLetterhead`), as inline SVG in the layout's own
 * coordinate space: crisp at any size, scaled to the width it is given and never stretched
 * (its height follows its width).
 *
 * LETTERHEAD-4: the lettering is the paper's own faces (Verdana Bold Italic, Georgia Bold,
 * Georgia Bold Italic) as OUTLINES, not text in whatever font the device has — so it is the
 * same artwork on a phone, a tablet and the PDF. Each distinct glyph is defined once and each
 * line places its glyphs with the line's matrix (`letterheadLineMatrix`), exactly as the PDF
 * does. The words are the image's accessible name.
 */

/** The reference box: the SVG's viewBox, so its coordinates are the layout's own. */
const REFERENCE_BOX = { left: 0, top: 0, width: LETTERHEAD_REFERENCE.width, height: LETTERHEAD_REFERENCE.height };

const number = (value: number): string => Number(value.toFixed(6)).toString();

export const EjeLetterhead = ({ className, lineSet }: { readonly className?: string; readonly lineSet?: readonly LetterheadLine[] }) => {
  // Each instance's glyph ids are its own, so two letterheads on one page never share a definition.
  const prefix = `eje-lh-${useId().replace(/[^A-Za-z0-9_-]/gu, '')}`;
  const placed = layoutLetterhead(REFERENCE_BOX, lineSet === undefined ? {} : { lines: lineSet });
  const lines = placed.lines.map((line) => ({ line, glyphs: letterheadLineGlyphs(line) }));
  const definitions = new Map<string, { readonly id: string; readonly path: string }>();
  for (const { glyphs } of lines) {
    for (const glyph of glyphs) {
      if (!definitions.has(glyph.key)) definitions.set(glyph.key, { id: `${prefix}-${definitions.size}`, path: glyph.path });
    }
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${LETTERHEAD_REFERENCE.width} ${LETTERHEAD_REFERENCE.height}`}
      preserveAspectRatio="xMinYMid meet"
      role="img"
      aria-label={placed.lines.map(letterheadLineText).join(', ')}
      data-letterhead="eje-master"
      className={className ?? 'block h-auto w-full'}
    >
      <defs>
        {[...definitions.values()].map((definition) => (
          <path key={definition.id} id={definition.id} d={definition.path} />
        ))}
      </defs>
      <path d={markPathData(placed.mark, placed.markPolygons)} fill={placed.lines[0]?.ink} fillRule="evenodd" />
      {lines.map(({ line, glyphs }) => (
        <g
          key={letterheadLineText(line)}
          data-line={letterheadLineText(line)}
          transform={`matrix(${letterheadLineMatrix(line).map(number).join(' ')})`}
          fill={line.ink}
        >
          {glyphs.map((glyph, index) => (
            <use key={index} href={`#${definitions.get(glyph.key)!.id}`} x={glyph.pen} />
          ))}
        </g>
      ))}
    </svg>
  );
};

/** Where the PDF starts the label of a one-line title (JOB-CARD-5): `gap` before the number, both measured alike. */
const inlineLabelX = (slot: FullWidthTitleSlot, title: string, number: string): number =>
  slot.right - textWidth(number, slot.numberSize, 'bold') - (slot.gap ?? 0) - textWidth(title, slot.labelSize, 'bold', slot.labelTracking);

/**
 * THE EJE LETTERHEAD ACROSS THE DOCUMENT'S FULL WIDTH, ITS NAME AND NUMBER IN THE TOP-RIGHT CORNER.
 * JOB-CARD-3 (the owner, 17 November 2026) — the screen's copy of `drawFullWidthLetterhead`.
 *
 * The letterhead takes the document's whole width and the label and number are drawn over it in the
 * letterhead's own coordinates (`LETTERHEAD_TITLE_SLOT`), so they sit exactly where the PDF puts them
 * and scale with the artwork. On a phone the whole document is a few hundred pixels wide and that
 * corner would be unreadably small, so there the title is set under the letterhead at a readable size
 * instead; on a wider screen the same words stay in the page for a screen reader.
 */
export const FullWidthLetterheadHeader = ({
  title,
  number,
  headerStyle = 7,
}: {
  readonly title: string;
  readonly number: string;
  /**
   * The header's edition: 7 (v1.16.0); 8 (JOB-CARD-4: "1465" on the Email line, the number on the
   * company name's line); 9 (JOB-CARD-5: the P.O. Box block moved down whole, the name and number on one line).
   */
  readonly headerStyle?: FullWidthHeaderStyle;
}) => {
  const { lines, slot } = fullWidthHeaderGeometry(headerStyle);
  const text = { fontFamily: 'Helvetica, Arial, sans-serif', fontWeight: 700 } as const;
  return (
    <header className="border-b-2 border-steel-900 pb-4" data-testid="document-header" data-header="full-width">
      <div className="relative -mx-6 sm:mx-0">
        <EjeLetterhead lineSet={headerStyle === 7 ? undefined : lines} />
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox={`0 0 ${LETTERHEAD_REFERENCE.width} ${LETTERHEAD_REFERENCE.height}`}
          preserveAspectRatio="xMinYMid meet"
          aria-hidden="true"
          data-testid="letterhead-title-overlay"
          className="pointer-events-none absolute inset-0 hidden h-full w-full sm:block"
        >
          {slot.inline === true ? (
            // JOB-CARD-5: one heading on one baseline — the label, a gap, the number — placed at exactly the
            // x the PDF places them (`drawFullWidthLetterhead`), in the letterhead's own units.
            <>
              <text x={inlineLabelX(slot, title.toUpperCase(), number)} y={slot.labelBaseline} fontSize={slot.labelSize} letterSpacing={slot.labelTracking} fill="#6b7481" {...text}>
                {title.toUpperCase()}
              </text>
              <text x={slot.right - textWidth(number, slot.numberSize, 'bold')} y={slot.numberBaseline} fontSize={slot.numberSize} fill="#1b2434" {...text}>
                {number}
              </text>
            </>
          ) : (
            <>
              <text x={slot.right} y={slot.labelBaseline} textAnchor="end" fontSize={slot.labelSize} letterSpacing={slot.labelTracking} fill="#6b7481" {...text}>
                {title.toUpperCase()}
              </text>
              <text x={slot.right} y={slot.numberBaseline} textAnchor="end" fontSize={slot.numberSize} fill="#1b2434" {...text}>
                {number}
              </text>
            </>
          )}
        </svg>
      </div>
      <div className="mt-3 text-right sm:sr-only" data-testid="document-title">
        <p className="text-xs font-semibold tracking-[0.18em] text-steel-500 uppercase">{title}</p>
        <p className="font-mono text-xl font-bold text-steel-900">{number}</p>
      </div>
    </header>
  );
};

/**
 * THE HEADER OF A DOCUMENT ON SCREEN — the same choice the PDF makes (LETTERHEAD-1, -2):
 *
 *   - EJE: the master letterhead above;
 *   - another company with an uploaded letterhead: that image, as the office supplied it;
 *   - otherwise: the document's own text header (`fallback`), exactly as it was.
 *
 * An EJE document ISSUED before the master letterhead (`master={false}`, from
 * `showsMasterLetterhead`) shows its text header — the header its stored PDF has.
 */
export const DocumentLetterhead = ({
  companyId,
  companyName,
  letterhead,
  fallback,
  className,
  masterClassName,
  master = true,
}: {
  readonly companyId: string;
  readonly companyName: string;
  readonly letterhead?: LetterheadReference | null;
  readonly fallback: ReactNode;
  /** The box the letterhead takes in the document's header (the fallback brings its own). */
  readonly className?: string;
  /** The master letterhead's own box, when it differs (on a phone it takes the document's full width). */
  readonly masterClassName?: string;
  /** False for an EJE document issued before the master letterhead: its text header, as its PDF has. */
  readonly master?: boolean;
}) => {
  if (carriesMasterLetterhead(companyId)) {
    if (!master) return <>{fallback}</>;
    return (
      <div className={masterClassName ?? className}>
        <EjeLetterhead />
      </div>
    );
  }
  if (letterhead !== undefined && letterhead !== null) {
    return (
      <div className={className}>
        {/* eslint-disable-next-line @next/next/no-img-element -- an authorised API image, not a static asset */}
        <img
          src={companies.letterheadUrl(letterhead.companyId, letterhead.sha256)}
          alt={`${companyName} letterhead`}
          data-letterhead="uploaded"
          className="block h-auto max-h-28 w-auto max-w-full"
        />
      </div>
    );
  }
  return <>{fallback}</>;
};
