import { describe, expect, it } from "vitest";
import {
  barcodeProblem,
  clampSize,
  DOTS_PER_MM,
  fitName,
  LABEL_SIZES,
  type LabelOp,
  layoutLabel,
} from "../label-layout";
import { scan } from "./scan-helpers";

/** Every letter about as wide as 0.55 of its height: close enough to a real font for layout. */
const measure = (text: string, _bold: boolean, size: number) =>
  text.length * size * 0.55;

const CODES = [
  "5901234123457", // EAN-13
  "036000291452", // UPC-A
  "96385074", // EAN-8
  "5901234123458", // Code 128 digits
  "SKU 00012/B", // Code 128 text
  "Milk-1L-FRESH-2026-LOT-0042", // longer text
];

/** The label as a picture of its bars only (text left out): white label, black bars, where the layout put them. */
function barsPicture(width: number, height: number, ops: LabelOp[]) {
  const data = new Uint8ClampedArray(width * height).fill(255);
  for (const op of ops) {
    if (op.kind !== "bars") continue;
    for (let m = 0; m < op.modules.length; m++) {
      if (op.modules[m] !== "1") continue;
      for (let y = op.y; y < op.y + op.h; y++)
        for (let dx = 0; dx < op.module; dx++)
          data[y * width + op.x + m * op.module + dx] = 0;
    }
  }
  return { data, width, height };
}

describe("the label layout", () => {
  for (const size of LABEL_SIZES)
    describe(`${size.w} x ${size.h} mm`, () => {
      for (const code of CODES)
        it(`puts a scannable ${code} on it`, () => {
          const layout = layoutLabel(
            { name: "Fresh Milk 1 Litre", barcode: code },
            size,
            measure,
          );
          // Some long codes do not fit a small label: that is said, not squeezed.
          if (!layout.ok) {
            expect(layout.problem).toBe("TOO_WIDE");
            return;
          }
          expect(layout.width).toBe(size.w * DOTS_PER_MM);
          expect(layout.height).toBe(size.h * DOTS_PER_MM);

          const bars = layout.ops.find((o) => o.kind === "bars");
          if (bars?.kind !== "bars") throw new Error("no bars");
          // Whole dots, and at least the thinnest bar that prints cleanly.
          expect([2, 3]).toContain(bars.module);
          expect(Number.isInteger(bars.x)).toBe(true);
          expect(Number.isInteger(bars.y)).toBe(true);
          // Inside the label, with empty space either side.
          const right = bars.x + bars.modules.length * bars.module;
          expect(bars.x).toBeGreaterThanOrEqual(0);
          expect(right).toBeLessThanOrEqual(layout.width);
          // The bars are tall enough, and everything is inside the label.
          expect(bars.h).toBeGreaterThanOrEqual(40);
          for (const op of layout.ops) {
            expect(op.y).toBeGreaterThanOrEqual(0);
            expect(op.y).toBeLessThan(layout.height);
          }
          const last = layout.ops.at(-1);
          expect(
            last && last.y + (last.kind === "text" ? last.size : 0),
          ).toBeLessThanOrEqual(layout.height);

          // And a scanner reads it from the picture of where the bars really are.
          const result = scan(
            barsPicture(layout.width, layout.height, layout.ops),
          );
          expect(result?.text, `${code} on ${size.w}x${size.h}`).toBe(code);
        });
    });

  it("uses wider bars when the label is wide enough, and the thinnest that print when it is not", () => {
    const ean = "5901234123457";
    const wide = layoutLabel(
      { name: "A", barcode: ean },
      { w: 50, h: 30 },
      measure,
    );
    const narrow = layoutLabel(
      { name: "A", barcode: ean },
      { w: 38, h: 25 },
      measure,
    );
    expect(wide.ok && wide.module).toBe(3);
    expect(narrow.ok && narrow.module).toBe(2);
  });

  it("says when a code is too long for the label, instead of squeezing it", () => {
    const long = layoutLabel(
      { name: "A", barcode: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" },
      { w: 38, h: 25 },
      measure,
    );
    expect(long).toEqual({ ok: false, problem: "TOO_WIDE" });
  });

  it("gives the reason when there is no barcode", () => {
    expect(
      layoutLabel({ name: "A", barcode: "" }, { w: 40, h: 30 }, measure),
    ).toEqual({
      ok: false,
      problem: "EMPTY",
    });
    expect(
      layoutLabel({ name: "A", barcode: "পণ্য" }, { w: 40, h: 30 }, measure),
    ).toEqual({
      ok: false,
      problem: "UNSUPPORTED",
    });
  });

  it("shows the name on top, the code number under the bars, and the price last when asked", () => {
    const layout = layoutLabel(
      { name: "Fresh Milk", barcode: "5901234123457", price: "৳৯০" },
      { w: 40, h: 30 },
      measure,
    );
    if (!layout.ok) throw new Error("no layout");
    const kinds = layout.ops.map((o) => (o.kind === "text" ? o.text : "bars"));
    expect(kinds).toEqual(["Fresh Milk", "bars", "5901234123457", "৳৯০"]);
    const ys = layout.ops.map((o) => o.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    // No price unless given.
    const plain = layoutLabel(
      { name: "Fresh Milk", barcode: "5901234123457" },
      { w: 40, h: 30 },
      measure,
    );
    expect(
      plain.ok && plain.ops.map((o) => (o.kind === "text" ? o.text : "bars")),
    ).toEqual(["Fresh Milk", "bars", "5901234123457"]);
  });

  it("gives a short label one line of name when two lines would squeeze the bars", () => {
    const small = layoutLabel(
      {
        name: "Fresh Milk 1 Litre Pasteurised Full Cream",
        barcode: "5901234123457",
        price: "৳৯০",
      },
      { w: 38, h: 20 },
      measure,
    );
    if (!small.ok) throw new Error("no layout");
    const names = small.ops.filter((o) => o.kind === "text").slice(0, -2);
    expect(names).toHaveLength(1);
    const bars = small.ops.find((o) => o.kind === "bars");
    expect(bars?.kind === "bars" && bars.h).toBeGreaterThanOrEqual(40);
    // A 25 mm tall label still has room for two.
    const normal = layoutLabel(
      {
        name: "Fresh Milk 1 Litre Pasteurised Full Cream",
        barcode: "5901234123457",
        price: "৳৯০",
      },
      { w: 38, h: 25 },
      measure,
    );
    expect(
      normal.ok && normal.ops.filter((o) => o.kind === "text").slice(0, -2),
    ).toHaveLength(2);
  });
});

describe("long names", () => {
  const m = (t: string) => t.length * 10;
  it("wraps to the lines given and ends the last with an ellipsis when cut", () => {
    expect(fitName("Fresh Milk", 200, 2, m)).toEqual(["Fresh Milk"]);
    expect(fitName("Fresh Milk 1 Litre Pasteurised", 120, 2, m)).toEqual([
      "Fresh Milk 1",
      "Litre…",
    ]);
    const cut = fitName("Fresh Milk 1 Litre Pasteurised Full Cream", 120, 2, m);
    expect(cut).toHaveLength(2);
    expect(cut[1].endsWith("…")).toBe(true);
    for (const line of cut) expect(m(line)).toBeLessThanOrEqual(120);
  });

  it("cuts one very long word instead of running off the label", () => {
    const out = fitName("Supercalifragilisticexpialidocious", 100, 2, m);
    for (const line of out) expect(m(line)).toBeLessThanOrEqual(100);
  });
});

describe("label size", () => {
  it("keeps a typed size within what a sticker can be", () => {
    expect(clampSize({ w: 5, h: 500 })).toEqual({ w: 20, h: 100 });
    expect(clampSize({ w: 40.4, h: Number.NaN })).toEqual({ w: 40, h: 20 });
  });
});

describe("which codes fit which label (no fonts needed)", () => {
  it("knows before drawing: a long Code 128 does not fit 40 mm but fits 50 mm", () => {
    expect(barcodeProblem("5901234123457", { w: 38, h: 25 })).toBeNull();
    expect(barcodeProblem("SKU-0012/B", { w: 40, h: 30 })).toBe("TOO_WIDE");
    expect(barcodeProblem("SKU-0012/B", { w: 50, h: 30 })).toBeNull();
    expect(barcodeProblem("", { w: 40, h: 30 })).toBe("EMPTY");
    expect(barcodeProblem("পণ্য", { w: 40, h: 30 })).toBe("UNSUPPORTED");
    // The same answer as the layout gives.
    for (const code of ["SKU-0012/B", "5901234123457", "ABC"])
      for (const size of LABEL_SIZES) {
        const layout = layoutLabel({ name: "A", barcode: code }, size, measure);
        expect(layout.ok ? null : layout.problem).toBe(
          barcodeProblem(code, size),
        );
      }
  });

  it("gives the bars the height a one-line name does not use", () => {
    const bars = (name: string) => {
      const l = layoutLabel(
        { name, barcode: "5901234123457" },
        { w: 40, h: 30 },
        measure,
      );
      const b = l.ok ? l.ops.find((o) => o.kind === "bars") : undefined;
      return b?.kind === "bars" ? b.h : 0;
    };
    expect(bars("Soap")).toBeGreaterThan(
      bars("Fresh Milk 1 Litre Pasteurised Full Cream"),
    );
  });
});
