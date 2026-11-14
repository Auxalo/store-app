import { type Bitmap, PRINT_WIDTH, thresholdToBitmap } from "./escpos";
import { layoutReceipt, type ReceiptModel } from "./receipt-layout";

export type ThermalWidth = keyof typeof PRINT_WIDTH;

/**
 * Draws the receipt as a black-and-white picture exactly as wide as the printer's paper. Bangla
 * letters, the taka sign and the shop's own wording all print correctly because they are pixels,
 * not the printer's built-in (Latin-only) letters. Uses the fonts the app already loaded.
 */
export async function renderReceipt(
  model: ReceiptModel,
  width: ThermalWidth,
): Promise<Bitmap> {
  const widthPx = PRINT_WIDTH[width];
  const family =
    getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  // Make sure the Bangla and Latin faces are ready before measuring anything.
  try {
    await Promise.all([
      document.fonts.load(`normal 22px ${family}`, "অ৳$€₹A1"),
      document.fonts.load(`bold 22px ${family}`, "অ৳$€₹A1"),
    ]);
  } catch {
    /* draw with whatever is there */
  }

  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = 10;
  const probe = canvas.getContext("2d");
  if (!probe) throw new Error("NO_CANVAS");
  const measure = (text: string, bold: boolean, size: number) => {
    probe.font = `${bold ? "bold" : "normal"} ${size}px ${family}`;
    return probe.measureText(text).width;
  };
  const layout = layoutReceipt(model, widthPx, measure);

  canvas.height = layout.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("NO_CANVAS");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, widthPx, layout.height);
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.textBaseline = "top";
  for (const op of layout.ops) {
    if (op.kind === "rule") {
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(4, op.y);
      ctx.lineTo(widthPx - 4, op.y);
      ctx.stroke();
      continue;
    }
    ctx.font = `${op.bold ? "bold" : "normal"} ${op.size}px ${family}`;
    ctx.textAlign = op.align ?? "left";
    ctx.fillText(op.text ?? "", op.x ?? 0, op.y);
  }
  const { data } = ctx.getImageData(0, 0, widthPx, layout.height);
  return thresholdToBitmap(data, widthPx, layout.height);
}

/**
 * The black-and-white picture as a PNG address (data URL), for printing through the computer's own
 * print window (print-window.ts): pure black and white, so it prints as sharp as on a Bluetooth
 * receipt printer.
 */
export function bitmapToPng(bitmap: Bitmap): string {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.widthPx;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("NO_CANVAS");
  const image = ctx.createImageData(bitmap.widthPx, bitmap.height);
  const rowBytes = Math.ceil(bitmap.widthPx / 8);
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.widthPx; x++) {
      const black = bitmap.data[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7));
      const i = (y * bitmap.widthPx + x) * 4;
      const v = black ? 0 : 255;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

/** How wide the printed part of the roll is, in mm (8 dots per mm at 203 dpi): 48 or 72. */
export const printableMm = (width: ThermalWidth) => PRINT_WIDTH[width] / 8;
