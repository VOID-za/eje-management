/**
 * Vector paths for the PDF writer: move, line, curve, close. LETTERHEAD-4.
 *
 * The master letterhead's lettering is glyph outlines (TrueType: straight segments and
 * quadratic curves). PDF has only CUBIC curves (`c`), so a quadratic is raised to the cubic
 * that traces exactly the same curve — no flattening into points, which would multiply the
 * bytes of every document that carries the letterhead.
 *
 * Pure: no DOM, no Node APIs.
 */

export type PathCommand =
  | { readonly op: 'M'; readonly x: number; readonly y: number }
  | { readonly op: 'L'; readonly x: number; readonly y: number }
  | { readonly op: 'Q'; readonly x1: number; readonly y1: number; readonly x: number; readonly y: number }
  | {
      readonly op: 'C';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly op: 'Z' };

const ARITY = { M: 2, L: 2, Q: 4, C: 6, Z: 0 } as const;

/**
 * An SVG path of ABSOLUTE M, L, Q, C and Z commands (what the letterhead's generated glyph data
 * holds) as commands. Throws on anything else, rather than drawing a wrong shape.
 */
export const parseSvgPath = (d: string): PathCommand[] => {
  const commands: PathCommand[] = [];
  for (const match of d.matchAll(/([A-Za-z])([^A-Za-z]*)/gu)) {
    const op = match[1] as keyof typeof ARITY;
    if (!(op in ARITY)) throw new Error(`Unsupported path command "${op}"`);
    const n = (match[2] ?? '').match(/-?\d*\.?\d+(?:e-?\d+)?/giu)?.map(Number) ?? [];
    if (n.length !== ARITY[op]) throw new Error(`Path command "${op}" takes ${ARITY[op]} numbers, got ${n.length}`);
    const [a = 0, b = 0, c = 0, e = 0, f = 0, g = 0] = n;
    if (op === 'M' || op === 'L') commands.push({ op, x: a, y: b });
    else if (op === 'Q') commands.push({ op, x1: a, y1: b, x: c, y: e });
    else if (op === 'C') commands.push({ op, x1: a, y1: b, x2: c, y2: e, x: f, y: g });
    else commands.push({ op: 'Z' });
  }
  return commands;
};

/** Every point a path passes through or is pulled towards: its curve lies inside their hull. */
export const pathBounds = (
  commands: readonly PathCommand[],
): { readonly left: number; readonly bottom: number; readonly right: number; readonly top: number } | null => {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const command of commands) {
    if (command.op === 'Z') continue;
    xs.push(command.x);
    ys.push(command.y);
    if (command.op === 'Q' || command.op === 'C') {
      xs.push(command.x1);
      ys.push(command.y1);
    }
    if (command.op === 'C') {
      xs.push(command.x2);
      ys.push(command.y2);
    }
  }
  if (xs.length === 0) return null;
  return { left: Math.min(...xs), bottom: Math.min(...ys), right: Math.max(...xs), top: Math.max(...ys) };
};

/**
 * The path as PDF path-construction operators (`m`, `l`, `c`, `h`), its numbers written by
 * `format`. A quadratic from P0 through control Q to P is the cubic with controls
 * P0 + ⅔(Q − P0) and P + ⅔(Q − P) — the same curve.
 */
export const pathOperators = (commands: readonly PathCommand[], format: (value: number) => string): string => {
  const parts: string[] = [];
  let x0 = 0;
  let y0 = 0;
  let startX = 0;
  let startY = 0;
  for (const command of commands) {
    switch (command.op) {
      case 'M':
        parts.push(`${format(command.x)} ${format(command.y)} m`);
        x0 = startX = command.x;
        y0 = startY = command.y;
        break;
      case 'L':
        parts.push(`${format(command.x)} ${format(command.y)} l`);
        x0 = command.x;
        y0 = command.y;
        break;
      case 'Q': {
        const c1x = x0 + (2 / 3) * (command.x1 - x0);
        const c1y = y0 + (2 / 3) * (command.y1 - y0);
        const c2x = command.x + (2 / 3) * (command.x1 - command.x);
        const c2y = command.y + (2 / 3) * (command.y1 - command.y);
        parts.push(
          `${format(c1x)} ${format(c1y)} ${format(c2x)} ${format(c2y)} ${format(command.x)} ${format(command.y)} c`,
        );
        x0 = command.x;
        y0 = command.y;
        break;
      }
      case 'C':
        parts.push(
          `${format(command.x1)} ${format(command.y1)} ${format(command.x2)} ${format(command.y2)} ` +
            `${format(command.x)} ${format(command.y)} c`,
        );
        x0 = command.x;
        y0 = command.y;
        break;
      case 'Z':
        parts.push('h');
        x0 = startX;
        y0 = startY;
        break;
    }
  }
  return parts.join(' ');
};
