import { describe, expect, it } from "vitest";
import { toCsv } from "../export";

describe("csv export", () => {
  it("writes a header and rows, in order", () => {
    expect(
      toCsv(
        [
          { a: 1, b: "x" },
          { a: 2, b: "y" },
        ],
        ["a", "b"],
      ),
    ).toBe("﻿a,b\r\n1,x\r\n2,y\r\n");
  });

  it("quotes commas, quotes and line breaks, and leaves blanks empty", () => {
    const csv = toCsv(
      [{ name: 'Milk, "fresh"', note: "line1\nline2", missing: undefined }],
      ["name", "note", "missing"],
    );
    expect(csv).toBe(
      '﻿name,note,missing\r\n"Milk, ""fresh""","line1\nline2",\r\n',
    );
  });

  it("keeps Bangla text intact and starts with a byte-order mark for Excel", () => {
    const csv = toCsv([{ name: "ফ্রেশ দুধ" }], ["name"]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("ফ্রেশ দুধ");
  });

  it("writes objects as JSON", () => {
    expect(toCsv([{ lines: [{ qty: 1 }] }], ["lines"])).toContain(
      '"[{""qty"":1}]"',
    );
  });
});
