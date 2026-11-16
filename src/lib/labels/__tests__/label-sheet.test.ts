import { describe, expect, it } from "vitest";
import {
  BAND_ROWS,
  type Bitmap,
  PRINT_WIDTH,
  receiptJob,
} from "../../print/escpos";
import {
  DOTS_PER_MM,
  LABEL_SIZES,
  type LabelSize,
  layoutLabel,
} from "../label-layout";
import {
  A4,
  defaultLabelPaper,
  fitsRoll,
  MAX_ROLL_LABELS,
  ROLL_GAP,
  rollCell,
  rollLengthMm,
  rollPrintableMm,
  rollTail,
  sheetGrid,
  sheetPages,
  stack,
} from "../label-sheet";
import { scan } from "./scan-helpers";

const measure = (text: string, _bold: boolean, size: number) =>
  text.length * size * 0.55;

const EAN = "5901234123457";

/** The label's bars as printer dots (text left out), `scale` times finer than the printer's own. */
function labelBitmap(size: LabelSize, code = EAN, scale = 1): Bitmap {
  const layout = layoutLabel(
    { name: "Fresh Milk", barcode: code },
    size,
    measure,
  );
  if (!layout.ok) throw new Error(layout.problem);
  const widthPx = layout.width * scale;
  const height = layout.height * scale;
  const rowBytes = Math.ceil(widthPx / 8);
  const data = new Uint8Array(rowBytes * height);
  for (const op of layout.ops) {
    if (op.kind !== "bars") continue;
    for (let m = 0; m < op.modules.length; m++) {
      if (op.modules[m] !== "1") continue;
      for (let y = op.y * scale; y < (op.y + op.h) * scale; y++)
        for (let dx = 0; dx < op.module * scale; dx++) {
          const x = (op.x + m * op.module) * scale + dx;
          data[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
        }
    }
  }
  return { widthPx, height, data };
}

/** The dots as a scanner sees them. */
function picture(bitmap: Bitmap) {
  const rowBytes = Math.ceil(bitmap.widthPx / 8);
  const data = new Uint8ClampedArray(bitmap.widthPx * bitmap.height);
  for (let y = 0; y < bitmap.height; y++)
    for (let x = 0; x < bitmap.widthPx; x++)
      data[y * bitmap.widthPx + x] =
        bitmap.data[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7)) ? 0 : 255;
  return { data, width: bitmap.widthPx, height: bitmap.height };
}

const dot = (bitmap: Bitmap, x: number, y: number) =>
  (bitmap.data[y * Math.ceil(bitmap.widthPx / 8) + (x >> 3)] &
    (0x80 >> (x & 7))) !==
  0;

describe("labels on an A4 sheet", () => {
  it("fits as many as the sheet holds", () => {
    expect(sheetGrid({ w: 40, h: 30 })).toEqual({
      cols: 4,
      rows: 9,
      perPage: 36,
    });
    expect(sheetGrid({ w: 38, h: 25 })).toEqual({
      cols: 5,
      rows: 11,
      perPage: 55,
    });
    expect(sheetGrid({ w: 50, h: 25 })).toEqual({
      cols: 3,
      rows: 11,
      perPage: 33,
    });
    expect(sheetGrid({ w: 50, h: 30 })).toEqual({
      cols: 3,
      rows: 9,
      perPage: 27,
    });
  });

  it("never runs off the sheet or its empty edge, whatever the size, and always holds one", () => {
    for (let w = 20; w <= 100; w += 3)
      for (let h = 20; h <= 100; h += 7) {
        const grid = sheetGrid({ w, h });
        expect(grid.cols).toBeGreaterThanOrEqual(1);
        expect(grid.rows).toBeGreaterThanOrEqual(1);
        expect(grid.cols * w).toBeLessThanOrEqual(A4.w - 2 * A4.edge);
        expect(grid.rows * h).toBeLessThanOrEqual(A4.h - 2 * A4.edge);
        expect(grid.perPage).toBe(grid.cols * grid.rows);
      }
  });

  it("counts the sheets a print needs", () => {
    const grid = sheetGrid({ w: 40, h: 30 });
    expect(sheetPages(0, grid)).toBe(1);
    expect(sheetPages(36, grid)).toBe(1);
    expect(sheetPages(37, grid)).toBe(2);
    expect(sheetPages(40, grid)).toBe(2);
    expect(sheetPages(1000, grid)).toBe(28);
  });

  it("is still a barcode that scans when drawn three times finer", () => {
    for (const size of LABEL_SIZES) {
      const read = scan(picture(labelBitmap(size, EAN, 3)));
      expect(read?.text).toBe(EAN);
    }
  });
});

describe("labels on a receipt roll", () => {
  it("knows what the roll can print and which labels fit", () => {
    expect(rollPrintableMm("80mm")).toBe(72);
    expect(rollPrintableMm("58mm")).toBe(48);
    expect(fitsRoll({ w: 40, h: 30 }, "58mm")).toBe(true);
    expect(fitsRoll({ w: 48, h: 30 }, "58mm")).toBe(true);
    expect(fitsRoll({ w: 50, h: 30 }, "58mm")).toBe(false);
    expect(fitsRoll({ w: 72, h: 30 }, "80mm")).toBe(true);
    expect(fitsRoll({ w: 73, h: 30 }, "80mm")).toBe(false);
  });

  it("says how much paper a print takes", () => {
    // 10 labels of 30 mm, 3 mm between them and after the last.
    expect(rollLengthMm(10, { w: 40, h: 30 })).toBe(333);
    expect(rollLengthMm(MAX_ROLL_LABELS, { w: 40, h: 30 })).toBe(6603);
  });

  for (const paper of ["80mm", "58mm"] as const)
    it(`puts the label in the middle of the ${paper} roll, with a cut line on top, and it still scans`, () => {
      const size = { w: 40, h: 30 };
      const label = labelBitmap(size);
      const dots = PRINT_WIDTH[paper];
      const cell = rollCell(label, dots);
      if (!cell) throw new Error("no cell");
      expect(cell.widthPx).toBe(dots);
      expect(cell.height).toBe(size.h * DOTS_PER_MM + ROLL_GAP);
      // The cut line: dashes right across the top.
      expect(dot(cell, 0, 0)).toBe(true);
      expect(dot(cell, 4, 0)).toBe(false);
      expect(dot(cell, dots - 8, 0)).toBe(true);
      // The label's own dots, moved to the middle and nothing lost.
      const left = (dots - label.widthPx) / 2;
      const top = ROLL_GAP / 2 + 1;
      for (let y = 0; y < label.height; y += 7)
        for (let x = 0; x < label.widthPx; x += 3)
          expect(dot(cell, left + x, top + y)).toBe(dot(label, x, y));
      expect(scan(picture(cell))?.text).toBe(EAN);
    });

  it("gives nothing for a label wider than the roll", () => {
    expect(rollCell(labelBitmap({ w: 50, h: 30 }), PRINT_WIDTH["58mm"])).toBe(
      null,
    );
  });

  it("sends the whole strip as one job: reset first, every row once, one cut at the end", () => {
    const dots = PRINT_WIDTH["80mm"];
    const cell = rollCell(labelBitmap({ w: 40, h: 30 }), dots);
    if (!cell) throw new Error("no cell");
    const strip = stack([cell, cell, cell, rollTail(dots)]);
    expect(strip.widthPx).toBe(dots);
    expect(strip.height).toBe(3 * cell.height + ROLL_GAP);
    // The third label is the first one again, further down.
    expect(dot(strip, 300, 2 * cell.height + 100)).toBe(dot(cell, 300, 100));

    const job = receiptJob(strip);
    expect([...job.subarray(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...job.subarray(-4)]).toEqual([0x1d, 0x56, 0x42, 0x00]);
    const bands = Math.ceil(strip.height / BAND_ROWS);
    // reset + a header per band + the dots + feed + cut
    expect(job.length).toBe(2 + bands * 8 + strip.data.length + 3 + 4);
  });

  it("does not stack pictures of different widths", () => {
    expect(() => stack([rollTail(576), rollTail(384)])).toThrow();
  });
});

describe("which paper to start on", () => {
  it("follows the receipt printer set up on the device, else a sticker roll", () => {
    expect(defaultLabelPaper(null, "80mm")).toBe("label");
    expect(defaultLabelPaper("windows", "80mm")).toBe("80mm");
    expect(defaultLabelPaper("ble", "58mm")).toBe("58mm");
    expect(defaultLabelPaper("system", "a4")).toBe("label");
  });
});
