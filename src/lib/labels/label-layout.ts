import { wrap } from "../print/receipt-layout";
import { type Barcode, encodeBarcode, QUIET_MODULES } from "./barcode";

/**
 * Where everything goes on one sticker, in printer dots (8 per mm, 203 dpi). Pure: the width of a
 * piece of text comes from a `measure` function, so this runs in tests with no canvas.
 *
 * What makes a barcode scan is that every bar is a WHOLE number of dots wide (a bar of 2.4 dots is
 * drawn as 2 or 3 and the code no longer adds up). So the width of a module is chosen first (3 dots
 * when it fits, else 2) and everything else is placed around it.
 */

export const DOTS_PER_MM = 8;

export interface LabelSize {
  /** Millimetres. */
  w: number;
  h: number;
}

/** Sizes offered as buttons. */
export const LABEL_SIZES: LabelSize[] = [
  { w: 38, h: 25 },
  { w: 40, h: 30 },
  { w: 50, h: 25 },
  { w: 50, h: 30 },
];

export const MIN_LABEL_MM = 20;
export const MAX_LABEL_MM = 100;

/** A size kept within what a sticker can be. */
export function clampSize(size: LabelSize): LabelSize {
  const fix = (n: number) =>
    Math.min(MAX_LABEL_MM, Math.max(MIN_LABEL_MM, Math.round(n || 0)));
  return { w: fix(size.w), h: fix(size.h) };
}

export type Measure = (text: string, bold: boolean, size: number) => number;

export interface LabelInput {
  name: string;
  /** The product's stored code ("" when it has none). */
  barcode: string;
  /** Shown only when given (already formatted, e.g. "৳৯০"). */
  price?: string;
}

export type LabelProblem = "EMPTY" | "UNSUPPORTED" | "TOO_LONG" | "TOO_WIDE";

export type LabelOp =
  | {
      kind: "text";
      text: string;
      /** Centre of the text. */
      x: number;
      /** Top of the text. */
      y: number;
      size: number;
      bold: boolean;
    }
  | {
      kind: "bars";
      x: number;
      y: number;
      /** Dots per module. */
      module: number;
      /** Height of the bars in dots. */
      h: number;
      modules: string;
    };

export type LabelLayout =
  | {
      ok: true;
      width: number;
      height: number;
      ops: LabelOp[];
      barcode: Barcode;
      /** Dots per module that was used (3 or 2). */
      module: number;
    }
  | { ok: false; problem: LabelProblem };

/** Smallest bars still worth printing, in dots (about 5 mm). */
const MIN_BARS_H = 40;
const EDGE = 6;
/** Thinnest bar a thermal label printer prints cleanly, in dots (0.25 mm). */
const MIN_MODULE = 2;
const MAX_MODULE = 3;

/** Text wrapped to `max` wide on at most `lines` lines; when more is left, the last line ends with "…". */
export function fitName(
  name: string,
  max: number,
  lines: number,
  measure: (t: string) => number,
): string[] {
  const all = wrap(name, max, measure);
  if (all.length <= lines) return all;
  const out = all.slice(0, lines);
  let last = out[lines - 1];
  while (last.length > 1 && measure(`${last}…`) > max) last = last.slice(0, -1);
  out[lines - 1] = `${last}…`;
  return out;
}

/** Dots per module (3 or 2) the bars can be printed at on a label `width` dots wide; 0 when not even 2 fits. */
function moduleWidth(barcode: Barcode, width: number): number {
  const quiet = QUIET_MODULES[barcode.kind];
  for (let m = MAX_MODULE; m >= MIN_MODULE; m--)
    if ((barcode.modules.length + 2 * quiet) * m <= width) return m;
  return 0;
}

/**
 * Why a stored code cannot be printed as a barcode on this label size, or null when it can. Needs
 * no fonts, so lists can mark the products that will not fit before anything is drawn.
 */
export function barcodeProblem(
  code: string,
  size: LabelSize,
): LabelProblem | null {
  const encoded = encodeBarcode(code);
  if (!encoded.ok) return encoded.problem;
  return moduleWidth(encoded.barcode, Math.round(size.w * DOTS_PER_MM)) === 0
    ? "TOO_WIDE"
    : null;
}

export function layoutLabel(
  input: LabelInput,
  size: LabelSize,
  measure: Measure,
): LabelLayout {
  const width = Math.round(size.w * DOTS_PER_MM);
  const height = Math.round(size.h * DOTS_PER_MM);

  const encoded = encodeBarcode(input.barcode);
  if (!encoded.ok) return { ok: false, problem: encoded.problem };
  const { barcode } = encoded;

  // The widest bars that fit, with the empty space the code needs on both sides inside the label.
  const module = moduleWidth(barcode, width);
  if (module === 0) return { ok: false, problem: "TOO_WIDE" };
  const barsW = barcode.modules.length * module;

  const nameSize = height >= 240 ? 24 : 20;
  const codeSize = height >= 240 ? 22 : 20;
  const priceSize = height >= 240 ? 26 : 22;
  const nameLine = Math.round(nameSize * 1.15);
  const textW = width - 2 * EDGE;

  const withPrice = Boolean(input.price);
  const fixed = EDGE + codeSize + (withPrice ? priceSize + 2 : 0) + EDGE;
  // Two lines of name if the name needs them and the bars still have room, else one. The bars get
  // all the height the name does not use.
  const nameAt = (n: number) =>
    fitName(input.name, textW, n, (t) => measure(t, true, nameSize));
  let lines = nameAt(2);
  let barsH = height - fixed - lines.length * nameLine - 4;
  if (lines.length > 1 && barsH < MIN_BARS_H + 20) {
    lines = nameAt(1);
    barsH = height - fixed - nameLine - 4;
  }
  barsH = Math.max(MIN_BARS_H, barsH);

  const ops: LabelOp[] = [];
  let y = EDGE;
  for (const text of lines) {
    ops.push({
      kind: "text",
      text,
      x: width / 2,
      y,
      size: nameSize,
      bold: true,
    });
    y += nameLine;
  }
  y += 2;
  // Bars centred, starting on a whole dot.
  const barsX = Math.floor((width - barsW) / 2);
  ops.push({
    kind: "bars",
    x: barsX,
    y,
    module,
    h: barsH,
    modules: barcode.modules,
  });
  y += barsH + 2;
  // The code number under the bars: shrunk if it is wider than the label.
  let size2 = codeSize;
  while (size2 > 12 && measure(barcode.text, false, size2) > textW) size2 -= 1;
  ops.push({
    kind: "text",
    text: barcode.text,
    x: width / 2,
    y,
    size: size2,
    bold: false,
  });
  y += codeSize;
  if (withPrice && input.price)
    ops.push({
      kind: "text",
      text: input.price,
      x: width / 2,
      y: y + 2,
      size: priceSize,
      bold: true,
    });
  return { ok: true, width, height, ops, barcode, module };
}
