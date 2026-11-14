import { thresholdToBitmap } from "../print/escpos";
import { bitmapToPng } from "../print/render-receipt";
import {
  type LabelInput,
  type LabelLayout,
  type LabelProblem,
  type LabelSize,
  layoutLabel,
} from "./label-layout";

export type RenderedLabel =
  | { ok: true; src: string; layout: Extract<LabelLayout, { ok: true }> }
  | { ok: false; problem: LabelProblem };

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
 * Draws one sticker as a black-and-white picture exactly as many dots as the label has (8 per mm),
 * as an image address. The bars are drawn as whole-dot rectangles with no smoothing and the
 * picture is made pure black and white after, so nothing blurs the bars. The same picture is the
 * preview on the screen and what is printed.
 */
export async function renderLabel(
  input: LabelInput,
  size: LabelSize,
): Promise<RenderedLabel> {
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

  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("NO_CANVAS");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  for (const op of layout.ops) {
    if (op.kind === "text") {
      ctx.font = `${op.bold ? "bold" : "normal"} ${op.size}px ${family}`;
      ctx.fillText(op.text, op.x, op.y);
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
  const { data } = ctx.getImageData(0, 0, layout.width, layout.height);
  const bitmap = thresholdToBitmap(data, layout.width, layout.height);
  return { ok: true, src: bitmapToPng(bitmap), layout };
}
