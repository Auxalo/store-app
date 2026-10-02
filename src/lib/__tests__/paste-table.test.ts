import { describe, expect, it } from "vitest";
import { isHeaderRow, parsePastedTable } from "../paste-table";

describe("parsePastedTable", () => {
  it("reads cells copied from a spreadsheet (tab separated)", () => {
    expect(parsePastedTable("রহিম\t01711000001\t১২৫০\nকরিম\t\t500")).toEqual([
      ["রহিম", "01711000001", "১২৫০"],
      ["করিম", "", "500"],
    ]);
  });

  it("reads pasted CSV when there are no tabs", () => {
    expect(parsePastedTable("Rahim,01711000001,1250\nKarim,,500")).toEqual([
      ["Rahim", "01711000001", "1250"],
      ["Karim", "", "500"],
    ]);
  });

  it("handles quoted cells with commas, quotes and line breaks inside", () => {
    expect(
      parsePastedTable('"Milk, fresh"\t"say ""hi"""\t"two\nlines"\nRice\t1\t2'),
    ).toEqual([
      ["Milk, fresh", 'say "hi"', "two\nlines"],
      ["Rice", "1", "2"],
    ]);
  });

  it("skips empty lines, trims cells, and copes with Windows line endings and a BOM", () => {
    expect(parsePastedTable("﻿ a \t b \r\n\r\n\t\t\r\n c \t d \r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("returns nothing for empty text", () => {
    expect(parsePastedTable("")).toEqual([]);
    expect(parsePastedTable("  \n \t \n")).toEqual([]);
  });

  it("keeps empty cells in the middle and at the end", () => {
    expect(parsePastedTable("a\t\tc\t")).toEqual([["a", "", "c", ""]]);
  });
});

describe("isHeaderRow", () => {
  const titles = [
    ["name", "নাম"],
    ["phone", "ফোন", "মোবাইল"],
    ["due", "বাকি"],
  ];
  it("recognises column titles in English or Bangla", () => {
    expect(isHeaderRow(["Name", "Phone", "Due"], titles)).toBe(true);
    expect(isHeaderRow(["নাম", "ফোন", "বাকি"], titles)).toBe(true);
  });
  it("does not mistake a person's row for titles", () => {
    expect(isHeaderRow(["রহিম", "01711000001", "1250"], titles)).toBe(false);
    expect(isHeaderRow(["Name Rahim", "017", "5"], titles)).toBe(false);
  });
});
