import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { Bitmap } from "../../print/escpos";
import { makePdf } from "../label-pdf";

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

function checker(widthPx: number, height: number): Bitmap {
  const rowBytes = Math.ceil(widthPx / 8);
  const data = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < widthPx; x++)
      if ((x + y) % 2) data[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
  return { widthPx, height, data };
}

describe("label PDF", () => {
  it("has every page at its size, each picture once, and a table that points at every object", async () => {
    const a = checker(320, 240);
    const b = checker(13, 5);
    const pdf = await makePdf(
      [a, b],
      [
        {
          w: 210,
          h: 297,
          place: [
            { image: 0, x: 10, y: 10, w: 40, h: 30 },
            { image: 0, x: 50, y: 10, w: 40, h: 30 },
          ],
          cuts: [{ x: 10, y: 10, w: 40, h: 30 }],
        },
        { w: 40, h: 30, place: [{ image: 1, x: 0, y: 0, w: 40, h: 30 }] },
      ],
    );
    const s = text(pdf);
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(s).toContain("/Count 2");
    expect(s).toContain("/MediaBox [0 0 595.276 841.89]");
    expect(s).toContain("/MediaBox [0 0 113.386 85.039]");
    expect(s.match(/\/Subtype \/Image/g)).toHaveLength(2);
    expect(s.match(/\/Im0 Do/g)).toHaveLength(2);
    expect(s).toContain("[2 2] 0 d");

    // Every object is where the table says.
    const xref = Number(/startxref\n(\d+)/.exec(s)?.[1]);
    const rows = s.slice(xref).split("\n").slice(3);
    const count = Number(/\/Size (\d+)/.exec(s)?.[1]);
    for (let id = 1; id < count; id++)
      expect(
        s.slice(Number(rows[id - 1].slice(0, 10))).startsWith(`${id} 0 obj`),
      ).toBe(true);

    // The dots come back exactly.
    const start = s.indexOf("stream\n", s.indexOf("/Width 320")) + 7;
    const len = Number(/\/Width 320[^>]*\/Length (\d+)/.exec(s)?.[1]);
    expect(
      new Uint8Array(inflateSync(pdf.subarray(start, start + len))),
    ).toEqual(a.data);
  });
});
