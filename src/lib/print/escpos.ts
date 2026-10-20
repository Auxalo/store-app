/**
 * ESC/POS, the command language almost every thermal receipt printer understands. The receipt is
 * sent as a picture (these printers have no Bangla letters of their own), so only a few commands are
 * needed: reset, "print this raster band", feed paper, cut.
 */

/** Printable width in dots at 203 dpi: 58 mm paper prints 384, 80 mm paper prints 576. */
export const PRINT_WIDTH = { "58mm": 384, "80mm": 576 } as const;

const ESC = 0x1b;
const GS = 0x1d;

/** Rows per "print raster" command: cheap printers choke on one huge block. */
export const BAND_ROWS = 24;

/** The image as black (1) / white (0) dots, packed 8 per byte, rows left to right. */
export interface Bitmap {
  widthPx: number;
  height: number;
  /** ceil(widthPx / 8) bytes per row. */
  data: Uint8Array;
}

/**
 * Turns canvas pixels (RGBA) into black-and-white dots: darker than the threshold is black.
 * No greys, which is what a thermal head can print.
 */
export function thresholdToBitmap(
  rgba: Uint8ClampedArray | Uint8Array,
  widthPx: number,
  height: number,
  threshold = 170,
): Bitmap {
  const rowBytes = Math.ceil(widthPx / 8);
  const data = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < widthPx; x++) {
      const i = (y * widthPx + x) * 4;
      const alpha = rgba[i + 3] / 255;
      // Transparent counts as white paper.
      const luminance =
        (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * alpha +
        255 * (1 - alpha);
      if (luminance < threshold)
        data[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { widthPx, height, data };
}

/** `ESC @`: forget any earlier settings. */
export const init = () => Uint8Array.of(ESC, 0x40);

/** `ESC d n`: feed n lines. */
export const feed = (lines: number) => Uint8Array.of(ESC, 0x64, lines);

/** `GS V 66 0`: feed a little and partly cut (printers without a cutter ignore it). */
export const cut = () => Uint8Array.of(GS, 0x56, 0x42, 0x00);

/** `GS v 0`: one band of the picture. */
function rasterBand(widthBytes: number, rows: number, data: Uint8Array) {
  const head = Uint8Array.of(
    GS,
    0x76,
    0x30,
    0x00,
    widthBytes & 0xff,
    (widthBytes >> 8) & 0xff,
    rows & 0xff,
    (rows >> 8) & 0xff,
  );
  const out = new Uint8Array(head.length + data.length);
  out.set(head, 0);
  out.set(data, head.length);
  return out;
}

const join = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** The whole job: reset, the picture in bands, a little paper, and the cut. */
export function receiptJob(
  bitmap: Bitmap,
  options: { cut?: boolean; feedLines?: number } = {},
): Uint8Array {
  const rowBytes = Math.ceil(bitmap.widthPx / 8);
  const parts: Uint8Array[] = [init()];
  for (let y = 0; y < bitmap.height; y += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, bitmap.height - y);
    parts.push(
      rasterBand(
        rowBytes,
        rows,
        bitmap.data.subarray(y * rowBytes, (y + rows) * rowBytes),
      ),
    );
  }
  parts.push(feed(options.feedLines ?? 3));
  if (options.cut ?? true) parts.push(cut());
  return join(parts);
}

/** Splits bytes into pieces of at most `size` (Bluetooth and serial links take small writes). */
export function chunks(bytes: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size)
    out.push(bytes.subarray(i, Math.min(bytes.length, i + size)));
  return out;
}
