/**
 * The receipt as plain rows of text, and where each row goes on a strip of paper of a given width.
 * Pure (no canvas, no React): the text is already translated and formatted by the caller, and the
 * width of a piece of text comes from a `measure` function, so this can be tested without a browser.
 */

export interface ReceiptModel {
  /** Centered at the top. The first line is the shop's name, drawn large. */
  header: string[];
  /** A heading under the shop's details, e.g. "Payment receipt". */
  title?: string;
  /** "CANCELLED" box, when the sale was cancelled. */
  cancelled?: string;
  /** Invoice, date, customer: one line each. */
  meta: string[];
  items: Array<{
    name: string;
    /** "2 kg × ৳50", under the name. */
    detail: string;
    amount: string;
  }>;
  /** Label on the left, figure on the right. */
  totals: Array<{ label: string; value: string; bold?: boolean }>;
  /** The customer's account after the bill (previous due, total due, advance). */
  standing: Array<{ label: string; value: string; bold?: boolean }>;
  footer: string;
}

export type Measure = (text: string, bold: boolean, size: number) => number;

export interface Op {
  kind: "text" | "rule";
  y: number;
  text?: string;
  x?: number;
  align?: "left" | "right" | "center";
  bold?: boolean;
  size?: number;
}

export interface Layout {
  ops: Op[];
  height: number;
  size: number;
}

const MARGIN = 6;

/** Breaks text into lines that fit `max` wide: at spaces, or anywhere for a word that is too long. */
export function wrap(
  text: string,
  max: number,
  measure: (t: string) => number,
): string[] {
  const lines: string[] = [];
  let line = "";
  const push = (word: string) => {
    const tryLine = line ? `${line} ${word}` : word;
    if (measure(tryLine) <= max) {
      line = tryLine;
      return;
    }
    if (line) lines.push(line);
    line = "";
    if (measure(word) <= max) {
      line = word;
      return;
    }
    // One word wider than the paper: cut it by characters.
    for (const ch of word) {
      if (measure(line + ch) > max && line) {
        lines.push(line);
        line = ch;
      } else line += ch;
    }
  };
  for (const word of text.split(/\s+/).filter(Boolean)) push(word);
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** Places every row on a strip `widthPx` wide, top to bottom. */
export function layoutReceipt(
  model: ReceiptModel,
  widthPx: number,
  measure: Measure,
): Layout {
  // About 2.7 mm characters on 58 mm paper, a touch larger on 80 mm.
  const size = widthPx >= 500 ? 25 : 22;
  const lineH = Math.round(size * 1.35);
  const inner = widthPx - MARGIN * 2;
  const ops: Op[] = [];
  let y = MARGIN;

  const text = (
    t: string,
    options: { align?: Op["align"]; bold?: boolean; size?: number; x?: number },
  ) => {
    const s = options.size ?? size;
    ops.push({
      kind: "text",
      y,
      text: t,
      x:
        options.x ??
        (options.align === "right"
          ? widthPx - MARGIN
          : options.align === "center"
            ? widthPx / 2
            : MARGIN),
      align: options.align ?? "left",
      bold: options.bold,
      size: s,
    });
  };
  const lineFit = (t: string, bold: boolean, s: number, max = inner) =>
    wrap(t, max, (x) => measure(x, bold, s));
  const rule = () => {
    ops.push({ kind: "rule", y: y + Math.round(lineH / 2) });
    y += lineH;
  };
  /** Left text and a right-hand figure on one row (the left wraps if it must). */
  const pair = (label: string, value: string, bold: boolean) => {
    const s = bold ? size + 2 : size;
    const valueW = measure(value, bold, s);
    const labelLines = lineFit(label, bold, s, inner - valueW - 10);
    labelLines.forEach((l, i) => {
      text(l, { bold, size: s });
      if (i === labelLines.length - 1)
        text(value, { align: "right", bold, size: s });
      y += Math.round(s * 1.35);
    });
  };

  model.header.forEach((line, i) => {
    const s = i === 0 ? size + 6 : size;
    for (const l of lineFit(line, i === 0, s)) {
      text(l, { align: "center", bold: i === 0, size: s });
      y += Math.round(s * 1.35);
    }
  });
  if (model.title) {
    for (const l of lineFit(model.title, true, size + 2)) {
      text(l, { align: "center", bold: true, size: size + 2 });
      y += Math.round((size + 2) * 1.35);
    }
  }
  if (model.cancelled) {
    text(`*** ${model.cancelled} ***`, { align: "center", bold: true });
    y += lineH;
  }
  rule();
  for (const line of model.meta) {
    for (const l of lineFit(line, false, size)) {
      text(l, {});
      y += lineH;
    }
  }
  rule();
  for (const item of model.items) {
    for (const l of lineFit(item.name, true, size)) {
      text(l, { bold: true });
      y += lineH;
    }
    pair(item.detail, item.amount, false);
  }
  if (model.items.length > 0) rule();
  for (const row of model.totals) pair(row.label, row.value, !!row.bold);
  if (model.standing.length > 0) {
    rule();
    for (const row of model.standing) pair(row.label, row.value, !!row.bold);
  }
  y += Math.round(lineH / 2);
  for (const l of lineFit(model.footer, false, size)) {
    text(l, { align: "center" });
    y += lineH;
  }
  y += MARGIN;
  return { ops, height: Math.ceil(y), size };
}
