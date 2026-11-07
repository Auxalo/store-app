import { describe, expect, it } from "vitest";
import { paymentMethodSaveInput } from "@/schemas/payment-method";
import {
  BUILTIN_METHOD_CODES,
  isFixedMethod,
  makeMethodHelpers,
  methodRecordsFromSettings,
} from "../payment-methods";

const tr = (code: string) => `T:${code}`;
const record = (
  code: string,
  value: { name: string; removed: boolean },
  createdAt = "2026-01-01T00:00:00.000Z",
) => ({ code, value, createdAt });

describe("the shop's payment methods", () => {
  it("start as the built-in ones, named by their translations", () => {
    const m = makeMethodHelpers([], tr);
    expect(m.active.map((x) => x.code)).toEqual([...BUILTIN_METHOD_CODES]);
    expect(m.name("bkash")).toBe("T:bkash");
  });

  it("a wallet can be hidden and shown again; old records still name it", () => {
    const hidden = makeMethodHelpers(
      [record("bkash", { name: "", removed: true })],
      tr,
    );
    expect(hidden.active.map((x) => x.code)).not.toContain("bkash");
    expect(hidden.all.map((x) => x.code)).toContain("bkash");
    expect(hidden.name("bkash")).toBe("T:bkash");
    // A picker for a record that already uses the hidden method still offers it.
    expect(hidden.pickable("bkash").map((x) => x.code)).toContain("bkash");
    expect(hidden.pickable("cash").map((x) => x.code)).not.toContain("bkash");
  });

  it("cash, bank and card cannot be hidden, whatever a record says", () => {
    const m = makeMethodHelpers(
      [
        record("cash", { name: "", removed: true }),
        record("card", { name: "", removed: true }),
      ],
      tr,
    );
    expect(m.active.map((x) => x.code)).toEqual(
      expect.arrayContaining(["cash", "card", "bank"]),
    );
    expect(isFixedMethod("bank")).toBe(true);
    expect(isFixedMethod("bkash")).toBe(false);
  });

  it("the shop's own methods follow the built-in ones, in the order they were added", () => {
    const m = makeMethodHelpers(
      [
        record(
          "m_b",
          { name: "Wise", removed: false },
          "2026-02-01T00:00:00.000Z",
        ),
        record(
          "m_a",
          { name: "Revolut", removed: false },
          "2026-01-01T00:00:00.000Z",
        ),
      ],
      tr,
    );
    expect(m.active.slice(-2).map((x) => x.code)).toEqual(["m_a", "m_b"]);
    expect(m.name("m_a")).toBe("Revolut");
  });

  it("a removed own method is hidden but still named; an unknown code shows as itself", () => {
    const m = makeMethodHelpers(
      [record("m_a", { name: "Revolut", removed: true })],
      tr,
    );
    expect(m.active.map((x) => x.code)).not.toContain("m_a");
    expect(m.name("m_a")).toBe("Revolut");
    expect(m.name("mystery")).toBe("mystery");
  });

  it("reads only well-formed method records", () => {
    const base = { createdAt: "2026-01-01T00:00:00.000Z" };
    const records = methodRecordsFromSettings([
      {
        ...base,
        key: "payment.m_a",
        value: { name: "Revolut", removed: false },
      },
      { ...base, key: "payment.m_b", value: "nope" },
      {
        ...base,
        key: "payment.m_c",
        value: { name: "x", removed: false },
        deletedAt: "2026-01-02T00:00:00.000Z",
      },
      {
        ...base,
        key: "unit.u_a",
        value: { name: "x", decimals: 0, removed: false },
      },
    ]);
    expect(records.map((r) => r.code)).toEqual(["m_a"]);
  });
});

describe("saving a payment method", () => {
  it("needs a name for the shop's own method, but not for a built-in one", () => {
    expect(
      paymentMethodSaveInput.safeParse({
        code: "m_a",
        name: " ",
        removed: false,
      }).success,
    ).toBe(false);
    expect(
      paymentMethodSaveInput.safeParse({
        code: "bkash",
        name: "",
        removed: true,
      }).success,
    ).toBe(true);
  });

  it("refuses to remove cash, bank or card", () => {
    for (const code of ["cash", "bank", "card"])
      expect(
        paymentMethodSaveInput.safeParse({ code, name: "", removed: true })
          .success,
      ).toBe(false);
  });
});
