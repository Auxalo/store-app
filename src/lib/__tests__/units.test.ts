import { describe, expect, it } from "vitest";
import {
  DEFAULT_UNITS,
  makeUnitHelpers,
  unitDecimals,
  unitRecordsFromSettings,
} from "../units";

const tr = (code: string) => `T:${code}`;
const record = (
  code: string,
  value: { name: string; decimals: 0 | 1 | 2 | 3; removed: boolean },
  createdAt = "2026-01-01T00:00:00.000Z",
) => ({ code, value, createdAt });

describe("the shop's units", () => {
  it("start as the built-in ones, named by their translations", () => {
    const u = makeUnitHelpers([], tr);
    expect(u.active.map((x) => x.code)).toEqual(
      DEFAULT_UNITS.map((x) => x.code),
    );
    expect(u.name("kg")).toBe("T:kg");
    expect(u.decimals("kg")).toBe(3);
    expect(u.decimals("pcs")).toBe(0);
  });

  it("a rename wins over the translation; an empty name keeps the translation", () => {
    const u = makeUnitHelpers(
      [
        record("pcs", { name: "পিস", decimals: 0, removed: false }),
        record("kg", { name: "", decimals: 3, removed: false }),
      ],
      tr,
    );
    expect(u.name("pcs")).toBe("পিস");
    expect(u.name("kg")).toBe("T:kg");
  });

  it("the shop's own units follow the built-in ones, in the order they were added", () => {
    const u = makeUnitHelpers(
      [
        record(
          "u_b",
          { name: "গজ", decimals: 2, removed: false },
          "2026-02-01T00:00:00.000Z",
        ),
        record(
          "u_a",
          { name: "বস্তা", decimals: 0, removed: false },
          "2026-01-01T00:00:00.000Z",
        ),
      ],
      tr,
    );
    expect(u.active.slice(-2).map((x) => x.code)).toEqual(["u_a", "u_b"]);
    expect(u.name("u_a")).toBe("বস্তা");
    expect(u.decimals("u_b")).toBe(2);
  });

  it("a removed unit leaves the pickers but still names old records", () => {
    const u = makeUnitHelpers(
      [
        record("dozen", { name: "", decimals: 0, removed: true }),
        record("u_a", { name: "বস্তা", decimals: 0, removed: true }),
      ],
      tr,
    );
    expect(u.active.map((x) => x.code)).not.toContain("dozen");
    expect(u.active.map((x) => x.code)).not.toContain("u_a");
    expect(u.all.map((x) => x.code)).toContain("u_a");
    expect(u.name("dozen")).toBe("T:dozen");
    expect(u.name("u_a")).toBe("বস্তা");
  });

  it("an unknown code shows as itself and allows whole numbers", () => {
    const u = makeUnitHelpers([], tr);
    expect(u.name("mystery")).toBe("mystery");
    expect(u.decimals("mystery")).toBe(0);
    expect(unitDecimals("mystery")).toBe(0);
  });

  it("changing a built-in unit between whole and loose is kept", () => {
    const u = makeUnitHelpers(
      [record("pcs", { name: "", decimals: 3, removed: false })],
      tr,
    );
    expect(u.decimals("pcs")).toBe(3);
  });
});

describe("reading the units out of settings records", () => {
  const base = { createdAt: "2026-01-01T00:00:00.000Z" };
  it("takes only well-formed unit records that are not deleted", () => {
    const records = unitRecordsFromSettings([
      {
        ...base,
        key: "unit.u_a",
        value: { name: "বস্তা", decimals: 0, removed: false },
      },
      {
        ...base,
        key: "unit.u_b",
        value: { name: "x", decimals: 9, removed: false },
      },
      { ...base, key: "unit.u_c", value: "nope" },
      {
        ...base,
        key: "unit.u_d",
        value: { name: "y", decimals: 0, removed: false },
        deletedAt: "2026-01-02T00:00:00.000Z",
      },
      { ...base, key: "store.profile", value: { name: "Shop" } },
    ]);
    expect(records.map((r) => r.code)).toEqual(["u_a"]);
  });
});
