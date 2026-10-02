import { describe, expect, it } from "vitest";
import { changeBetween, previousRange } from "../compare";

describe("previousRange", () => {
  it("a single day gives the day before", () => {
    expect(previousRange({ from: "2026-10-02", to: "2026-10-02" })).toEqual({
      from: "2026-10-01",
      to: "2026-10-01",
    });
  });

  it("7 days give the 7 days before them", () => {
    expect(previousRange({ from: "2026-10-01", to: "2026-10-07" })).toEqual({
      from: "2026-09-24",
      to: "2026-09-30",
    });
  });

  it("crosses a month and a year, and a leap day", () => {
    expect(previousRange({ from: "2026-01-01", to: "2026-01-31" })).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
    expect(previousRange({ from: "2024-03-01", to: "2024-03-01" })).toEqual({
      from: "2024-02-29",
      to: "2024-02-29",
    });
  });
});

describe("changeBetween", () => {
  it("up and down, as a percent of the earlier number", () => {
    expect(changeBetween(150, 100)).toEqual({ kind: "up", pct: 50 });
    expect(changeBetween(75, 100)).toEqual({ kind: "down", pct: 25 });
  });

  it("no change, and rounding that comes to nothing", () => {
    expect(changeBetween(100, 100)).toEqual({ kind: "flat" });
    expect(changeBetween(1001, 1000)).toEqual({ kind: "flat" });
  });

  it("a zero before is 'new', not a percentage; zero to zero is flat", () => {
    expect(changeBetween(500, 0)).toEqual({ kind: "new" });
    expect(changeBetween(0, 0)).toEqual({ kind: "flat" });
    expect(changeBetween(-500, 0)).toEqual({ kind: "new" });
  });

  it("negative numbers move by their size: a smaller loss is up", () => {
    expect(changeBetween(-50, -100)).toEqual({ kind: "up", pct: 50 });
    expect(changeBetween(-150, -100)).toEqual({ kind: "down", pct: 50 });
    expect(changeBetween(50, -100)).toEqual({ kind: "up", pct: 150 });
  });

  it("going to nothing is down 100%", () => {
    expect(changeBetween(0, 200)).toEqual({ kind: "down", pct: 100 });
  });
});
