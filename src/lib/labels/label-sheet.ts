import { type Bitmap, PRINT_WIDTH } from "../print/escpos";
import { DOTS_PER_MM, type LabelSize } from "./label-layout";

/**
 * What the labels are printed on, and how they are laid out there. Pure (no canvas, no page):
 * - "label": a roll of stickers in a label printer, one sticker per page;
 * - "80mm" / "58mm": a receipt printer's roll, the labels one under another with cut lines;
 * - "a4": a sheet of plain paper, as many labels as fit, in rows, with cut lines.
 */
export type LabelPaper = "label" | "80mm" | "58mm" | "a4";
export type RollPaper = "80mm" | "58mm";

export const LABEL_PAPERS: LabelPaper[] = ["label", "80mm", "58mm", "a4"];

export const isRoll = (paper: LabelPaper): paper is RollPaper =>
  paper === "80mm" || paper === "58mm";

/**
 * The paper to start on when the shop has not chosen yet: a device with a receipt printer set up
 * prints the labels on it (that is the printer the shop has), any other on a sticker roll.
 */
export function defaultLabelPaper(
  printerVia: string | null | undefined,
  receiptPaper: string,
): LabelPaper {
  if (printerVia && (receiptPaper === "80mm" || receiptPaper === "58mm"))
    return receiptPaper;
  return "label";
}

/* ------------------------------------------------------------------ A4 */

/** An A4 sheet in mm, and the edge left empty all round (printers cannot print to the very edge). */
export const A4 = { w: 210, h: 297, edge: 10 } as const;

export interface SheetGrid {
  cols: number;
  rows: number;
  perPage: number;
}

/** How many labels of this size fit on one A4 sheet (always at least one). */
export function sheetGrid(size: LabelSize): SheetGrid {
  const cols = Math.max(1, Math.floor((A4.w - 2 * A4.edge) / size.w));
  const rows = Math.max(1, Math.floor((A4.h - 2 * A4.edge) / size.h));
  return { cols, rows, perPage: cols * rows };
}

/** Sheets needed for `total` labels. */
export const sheetPages = (total: number, grid: SheetGrid) =>
  Math.max(1, Math.ceil(total / grid.perPage));

/* ---------------------------------------------------------------- rolls */

/** Most labels one print on a receipt roll may hold (200 labels of 30 mm is already 6.6 m of paper). */
export const MAX_ROLL_LABELS = 200;

/** Empty paper between two labels on a roll, in dots (3 mm); the cut line runs along its middle. */
export const ROLL_GAP = 24;

/** The part of the roll the printer can print, in mm: 72 on 80 mm paper, 48 on 58 mm. */
export const rollPrintableMm = (paper: RollPaper) =>
  PRINT_WIDTH[paper] / DOTS_PER_MM;

/** Is the label narrow enough for the roll? */
export const fitsRoll = (size: LabelSize, paper: RollPaper) =>
  Math.round(size.w * DOTS_PER_MM) <= PRINT_WIDTH[paper];

/** How much paper `total` labels take on a roll, in mm. */
export const rollLengthMm = (total: number, size: LabelSize) =>
  Math.round(
    (total * (size.h * DOTS_PER_MM + ROLL_GAP) + ROLL_GAP) / DOTS_PER_MM,
  );

const setDot = (bitmap: Bitmap, x: number, y: number) => {
  bitmap.data[y * Math.ceil(bitmap.widthPx / 8) + (x >> 3)] |= 0x80 >> (x & 7);
};
const getDot = (bitmap: Bitmap, x: number, y: number) =>
  (bitmap.data[y * Math.ceil(bitmap.widthPx / 8) + (x >> 3)] &
    (0x80 >> (x & 7))) !==
  0;

const blank = (widthPx: number, height: number): Bitmap => ({
  widthPx,
  height,
  data: new Uint8Array(Math.ceil(widthPx / 8) * height),
});

/** A dashed line across the whole width (4 dots on, 4 off, 2 dots thick) at row `y`. */
function dashAcross(bitmap: Bitmap, y: number) {
  for (let x = 0; x < bitmap.widthPx; x++)
    if (x % 8 < 4) {
      setDot(bitmap, x, y);
      setDot(bitmap, x, y + 1);
    }
}

/**
 * One label as it goes on a receipt roll: `rollDots` wide, the cut line on top, then the label
 * centred, with a dashed line down each side of it where the roll is wider than the label (to cut
 * it to its own size). Labels follow each other with no paper wasted; the strip is closed by
 * `rollTail`. A label wider than the roll gives null.
 */
export function rollCell(label: Bitmap, rollDots: number): Bitmap | null {
  if (label.widthPx > rollDots) return null;
  const cell = blank(rollDots, label.height + ROLL_GAP);
  const left = Math.floor((rollDots - label.widthPx) / 2);
  const top = ROLL_GAP / 2 + 1;
  dashAcross(cell, 0);
  for (let y = 0; y < label.height; y++)
    for (let x = 0; x < label.widthPx; x++)
      if (getDot(label, x, y)) setDot(cell, left + x, top + y);
  // Side cut lines, just outside the label (its own empty edges stay empty for the scanner).
  const sides = [left - 2, left + label.widthPx + 1].filter(
    (x) => x >= 0 && x < rollDots,
  );
  if (left >= 8)
    for (const x of sides)
      for (let y = 2; y < cell.height; y++) if (y % 8 < 4) setDot(cell, x, y);
  return cell;
}

/** The end of a strip: the last cut line and a little paper under it. */
export function rollTail(rollDots: number): Bitmap {
  const tail = blank(rollDots, ROLL_GAP);
  dashAcross(tail, 0);
  return tail;
}

/** Pictures of the same width put one under another as one picture (what is sent to the printer). */
export function stack(parts: Bitmap[]): Bitmap {
  const widthPx = parts[0]?.widthPx ?? 0;
  const rowBytes = Math.ceil(widthPx / 8);
  const height = parts.reduce((n, p) => n + p.height, 0);
  const data = new Uint8Array(rowBytes * height);
  let at = 0;
  for (const part of parts) {
    if (part.widthPx !== widthPx) throw new Error("WIDTHS_DIFFER");
    data.set(part.data, at);
    at += part.data.length;
  }
  return { widthPx, height, data };
}
