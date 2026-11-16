import { type Bitmap, thresholdToBitmap } from "../print/escpos";
import { bitmapToPng } from "../print/render-receipt";
import {
  type LabelInput,
  type LabelLayout,
  type LabelProblem,
  type LabelSize,
  layoutLabel,
} from "./label-layout";

type GoodLayout = Extract<LabelLayout, { ok: true }>;

export type DrawnLabel =
  | { ok: true; bitmap: Bitmap; layout: GoodLayout }
  | { ok: false; problem: LabelProblem };

export type RenderedLabel =
  | { ok: true; src: string; layout: GoodLayout }
  | { ok: false; problem: LabelProblem };

/** How much finer than the printer's dots the picture for the screen and for A4 is drawn (about 600 dpi). */
export const FINE_SCALE = 3;

let fontsReady: Promise<void> | null = null;

/** Makes sure the Bangla and Latin letters are loaded before anything is measured or drawn. */
function loadFonts(family: string) {
  fontsReady ??= Promise.all([
    document.fonts.load(`normal 22px ${family}`, "অ৳$€₹A1"),
    document.fonts.load(`bold 22px ${family}`, "অ৳$€₹A1"),
  ])
    .then(() => undefined)
    .catch(() => undefined);
  return fontsReady;
}

/**
 * Draws one sticker as black and white dots. At `scale` 1 it is exactly as many dots as the label
 * has on a thermal printer (8 per mm): the bars are whole-dot rectangles with no smoothing and the
 * picture is made pure black and white after, so nothing blurs the bars. A larger `scale` draws the
 * very same layout that many times finer (the bars stay whole dots, the letters get smooth), for
 * the screen and for A4 printers, which print far finer than a thermal head.
 */
export async function drawLabel(
  input: LabelInput,
  size: LabelSize,
  scale = 1,
): Promise<DrawnLabel> {
  const family =
    getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  await loadFonts(family);

  const canvas = document.createElement("canvas");
  const probe = canvas.getContext("2d");
  if (!probe) throw new Error("NO_CANVAS");
  const layout = layoutLabel(input, size, (text, bold, px) => {
    probe.font = `${bold ? "bold" : "normal"} ${px}px ${family}`;
    return probe.measureText(text).width;
  });
  if (!layout.ok) return layout;

  const width = layout.width * scale;
  const height = layout.height * scale;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("NO_CANVAS");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.scale(scale, scale);
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  for (const op of layout.ops) {
    if (op.kind === "text") {
      ctx.font = `${op.bold ? "bold" : "normal"} ${op.size}px ${family}`;
      ctx.fillText(op.text, op.x, op.y);
      // At the printer's own dots a thin letter is one dot wide and a tired thermal head drops it:
      // the thin text (the number under the bars) is drawn a little heavier there.
      if (scale === 1 && !op.bold) {
        ctx.lineWidth = 0.7;
        ctx.lineJoin = "round";
        ctx.strokeText(op.text, op.x, op.y);
      }
      continue;
    }
    // One rectangle per run of black modules.
    let m = 0;
    while (m < op.modules.length) {
      if (op.modules[m] !== "1") {
        m++;
        continue;
      }
      let end = m;
      while (end < op.modules.length && op.modules[end] === "1") end++;
      ctx.fillRect(op.x + m * op.module, op.y, (end - m) * op.module, op.h);
      m = end;
    }
  }
  const { data } = ctx.getImageData(0, 0, width, height);
  return { ok: true, bitmap: thresholdToBitmap(data, width, height), layout };
}

/** The sticker as a picture address (PNG), for the screen and the print window. */
export async function renderLabel(
  input: LabelInput,
  size: LabelSize,
  scale = 1,
): Promise<RenderedLabel> {
  const drawn = await drawLabel(input, size, scale);
  if (!drawn.ok) return drawn;
  return { ok: true, src: bitmapToPng(drawn.bitmap), layout: drawn.layout };
}
