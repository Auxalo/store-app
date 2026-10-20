import { describe, expect, it } from "vitest";
import {
  BAND_ROWS,
  chunks,
  PRINT_WIDTH,
  receiptJob,
  thresholdToBitmap,
} from "../escpos";
import { layoutReceipt, type ReceiptModel, wrap } from "../receipt-layout";

const px = (r: number, g: number, b: number, a = 255) => [r, g, b, a];

describe("ESC/POS", () => {
  it("makes black and white dots, with no greys, and transparent counts as paper", () => {
    // A row of 10 pixels: black, white, dark grey, light grey, transparent, then 5 black.
    const row = [
      px(0, 0, 0),
      px(255, 255, 255),
      px(100, 100, 100),
      px(220, 220, 220),
      px(0, 0, 0, 0),
      ...Array.from({ length: 5 }, () => px(0, 0, 0)),
    ].flat();
    const bitmap = thresholdToBitmap(Uint8ClampedArray.from(row), 10, 1);
    expect(bitmap.data.length).toBe(2); // 10 dots = 2 bytes
    // dots: 1 0 1 0 0 | 1 1 1 1 1  -> 10100111 11000000
    expect([...bitmap.data]).toEqual([0b10100111, 0b11000000]);
  });

  it("builds the job: reset, picture in bands, paper feed, cut", () => {
    const widthPx = PRINT_WIDTH["58mm"];
    const height = BAND_ROWS * 2 + 5; // two full bands and a short one
    const rowBytes = widthPx / 8;
    const bitmap = {
      widthPx,
      height,
      data: new Uint8Array(rowBytes * height).fill(0xff),
    };
    const job = receiptJob(bitmap);
    // Starts with ESC @
    expect([...job.subarray(0, 2)]).toEqual([0x1b, 0x40]);
    // First band header: GS v 0 m xL xH yL yH
    expect([...job.subarray(2, 10)]).toEqual([
      0x1d,
      0x76,
      0x30,
      0x00,
      rowBytes & 0xff,
      rowBytes >> 8,
      BAND_ROWS,
      0,
    ]);
    // 48 bytes per row, so a 24-row band is 1152 bytes of dots after its 8-byte header.
    const second = 2 + 8 + rowBytes * BAND_ROWS;
    expect([...job.subarray(second, second + 3)]).toEqual([0x1d, 0x76, 0x30]);
    // The last band carries the remaining 5 rows.
    const third = second + 8 + rowBytes * BAND_ROWS;
    expect(job[third + 6]).toBe(5);
    // Ends with the feed and the cut.
    expect([...job.subarray(job.length - 4)]).toEqual([0x1d, 0x56, 0x42, 0x00]);
    expect(job.length).toBe(
      2 + 3 * 8 + rowBytes * height + 3 /* feed */ + 4 /* cut */,
    );
  });

  it("can leave out the cut, and splits writes into small chunks", () => {
    const job = receiptJob(
      { widthPx: 8, height: 1, data: Uint8Array.of(0xff) },
      { cut: false },
    );
    expect([...job.subarray(job.length - 3)]).toEqual([0x1b, 0x64, 3]);
    const parts = chunks(new Uint8Array(1000), 180);
    expect(parts.map((p) => p.length)).toEqual([180, 180, 180, 180, 180, 100]);
  });

  it("knows the printable width of each paper at 203 dpi", () => {
    expect(PRINT_WIDTH["58mm"]).toBe(384);
    expect(PRINT_WIDTH["80mm"]).toBe(576);
    expect(PRINT_WIDTH["58mm"] % 8).toBe(0);
    expect(PRINT_WIDTH["80mm"] % 8).toBe(0);
  });
});

// A made-up ruler: every character is 10 wide, bold 12.
const measure = (text: string, bold: boolean) =>
  [...text].length * (bold ? 12 : 10);

const model: ReceiptModel = {
  header: ["রহিম স্টোর", "মিরপুর, ঢাকা"],
  meta: ["Invoice: A-1", "Date: today"],
  items: [
    { name: "মিনিকেট চাল ৫০ কেজি বস্তা", detail: "2 kg × ৳50", amount: "৳100" },
  ],
  totals: [
    { label: "Total", value: "৳100", bold: true },
    { label: "Paid", value: "৳60" },
    { label: "Due", value: "৳40", bold: true },
  ],
  standing: [{ label: "Previous due", value: "৳200" }],
  footer: "ধন্যবাদ",
};

describe("receipt layout", () => {
  it("wraps text to the width, and cuts a word that is wider than the paper", () => {
    const m = (t: string) => [...t].length * 10;
    expect(wrap("aa bb cc", 50, m)).toEqual(["aa bb", "cc"]);
    expect(wrap("abcdefghij", 40, m)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrap("", 40, m)).toEqual([""]);
  });

  it("puts every row inside the paper, top to bottom, with figures on the right", () => {
    const layout = layoutReceipt(model, PRINT_WIDTH["58mm"], measure);
    const texts = layout.ops.filter((o) => o.kind === "text");
    expect(texts.length).toBeGreaterThan(10);
    // Rows only go down.
    for (let i = 1; i < texts.length; i++)
      expect(texts[i].y).toBeGreaterThanOrEqual(texts[i - 1].y);
    expect(layout.height).toBeGreaterThan(texts[texts.length - 1].y);
    // A figure sits at the right edge, a label at the left.
    const due = texts.find((o) => o.text === "৳40");
    expect(due?.align).toBe("right");
    expect(due?.x).toBeGreaterThan(PRINT_WIDTH["58mm"] - 12);
    const label = texts.find((o) => o.text === "Due");
    expect(label?.align).toBe("left");
    // The shop's name is first, centred and larger than the rest.
    expect(texts[0]).toMatchObject({ text: "রহিম স্টোর", align: "center" });
    expect(texts[0].size).toBeGreaterThan(layout.size);
    // Nothing is wider than the paper (the ruler makes it checkable).
    for (const o of texts) {
      if (o.align === "left")
        expect(
          (o.x ?? 0) + measure(o.text ?? "", !!o.bold),
        ).toBeLessThanOrEqual(PRINT_WIDTH["58mm"]);
    }
  });

  it("uses bigger letters on 80 mm paper and a longer strip when the receipt is long", () => {
    const narrow = layoutReceipt(model, PRINT_WIDTH["58mm"], measure);
    const wide = layoutReceipt(model, PRINT_WIDTH["80mm"], measure);
    expect(wide.size).toBeGreaterThan(narrow.size);
    const longer = layoutReceipt(
      {
        ...model,
        items: Array.from({ length: 12 }, (_, i) => ({
          name: `পণ্য ${i}`,
          detail: "1 pcs × ৳10",
          amount: "৳10",
        })),
      },
      PRINT_WIDTH["58mm"],
      measure,
    );
    expect(longer.height).toBeGreaterThan(narrow.height);
  });

  it("a cancelled sale is marked, and an empty standing adds no extra rule", () => {
    const cancelled = layoutReceipt(
      { ...model, cancelled: "CANCELLED", standing: [] },
      PRINT_WIDTH["58mm"],
      measure,
    );
    expect(cancelled.ops.some((o) => o.text?.includes("CANCELLED"))).toBe(true);
    const withStanding = layoutReceipt(model, PRINT_WIDTH["58mm"], measure);
    expect(
      withStanding.ops.filter((o) => o.kind === "rule").length,
    ).toBeGreaterThan(cancelled.ops.filter((o) => o.kind === "rule").length);
  });
});
