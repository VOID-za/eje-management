import type { ReactNode } from 'react';
import { companies } from '@/api/endpoints';
import type { LetterheadReference } from '@/domain';
import {
  LETTERHEAD_REFERENCE,
  carriesMasterLetterhead,
  layoutLetterhead,
  letterheadLineText,
  letterheadLineWidth,
  markPathData,
  type LetterheadFontRole,
} from '@/lib/branding/eje-letterhead';

/**
 * THE EJE MASTER LETTERHEAD, ON SCREEN. LETTERHEAD-2 (15 November 2026).
 *
 * The owner: one master header for every EJE document, identical in the in-app preview and
 * the PDF. So this draws the SAME `layoutLetterhead` and the SAME traced mark the PDF draws
 * (`drawEjeLetterhead`), as inline SVG in the layout's own coordinate space: crisp at any
 * size, scaled to the width it is given and never stretched (its height follows its width).
 *
 * The faces are the PDF's: Helvetica bold italic for the name block, Times bold and bold
 * italic for the columns — with the usual stand-ins where a device lacks them. Spaces are
 * kept as written (the paper's double spaces), as the PDF keeps them.
 *
 * EVERY LINE IS ITS PDF LENGTH (LETTERHEAD-2 review): a stand-in face can be ~15 % wider (an
 * Android tablet's Roboto and Noto Serif), which made the address and contact columns touch.
 * So each line is set to exactly the width the PDF's metrics give it (`textLength`, glyphs and
 * spacing adjusted together) and centred on the same x — the same length on every device.
 */
const FACE: Record<LetterheadFontRole, { readonly fontFamily: string; readonly fontStyle: 'italic' | 'normal' }> = {
  sansBoldItalic: { fontFamily: 'Helvetica, Arial, sans-serif', fontStyle: 'italic' },
  serifBold: { fontFamily: "'Times New Roman', Times, serif", fontStyle: 'normal' },
  serifBoldItalic: { fontFamily: "'Times New Roman', Times, serif", fontStyle: 'italic' },
};

/** The reference box: the SVG's viewBox, so its coordinates are the layout's own. */
const REFERENCE_BOX = { left: 0, top: 0, width: LETTERHEAD_REFERENCE.width, height: LETTERHEAD_REFERENCE.height };

export const EjeLetterhead = ({ className }: { readonly className?: string }) => {
  const placed = layoutLetterhead(REFERENCE_BOX);
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
      <path d={markPathData(placed.mark, placed.markPolygons)} fill={placed.lines[0]?.ink} fillRule="evenodd" />
      {placed.lines.map((line) => (
        <text
          key={`${line.x},${line.baseline}`}
          x={line.x}
          y={line.baseline}
          textAnchor="middle"
          fill={line.ink}
          fontFamily={FACE[line.role].fontFamily}
          fontStyle={FACE[line.role].fontStyle}
          fontWeight="bold"
          textLength={Number(letterheadLineWidth(line).toFixed(2))}
          lengthAdjust="spacingAndGlyphs"
          xmlSpace="preserve"
          style={{ whiteSpace: 'pre' }}
        >
          {line.runs.map((part) => (
            <tspan key={part.text} fontSize={part.size}>
              {part.text}
            </tspan>
          ))}
        </text>
      ))}
    </svg>
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
