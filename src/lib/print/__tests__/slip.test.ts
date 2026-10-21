import { describe, expect, it } from "vitest";
import { createFormat } from "@/lib/format";
import { layoutReceipt } from "../receipt-layout";
import { buildPaymentSlipModel } from "../slip-model";

const WORDS: Record<string, string> = {
  date: "Date",
  customer: "Customer",
  paymentTitle: "Payment receipt",
  paymentReceived: "Payment received",
  method: "Paid by",
  previousDue: "Previous due",
  dueNow: "Due now",
  advance: "Advance",
  allSettled: "All settled",
  thanks: "Thank you!",
};

function slip(before: number | null, after: number, amount = 300000) {
  return buildPaymentSlipModel({
    payment: {
      createdAt: "2026-10-21T10:00:00.000Z",
      amount,
      method: "cash",
      partyName: "Rahim",
    },
    before,
    after,
    storeName: "Shop",
    profile: { name: "", address: "", phone: "" },
    footer: "",
    t: (key) => WORDS[key] ?? key,
    tp: (m) => m,
    f: createFormat({ locale: "en" }),
  });
}

const rows = (m: ReturnType<typeof slip>) => m.standing.map((r) => r.label);

describe("payment slip", () => {
  it("shows the payment and what is still due", () => {
    const m = slip(1000000, 700000);
    expect(m.title).toBe("Payment receipt");
    expect(m.items).toHaveLength(0);
    expect(m.totals[0]).toMatchObject({
      label: "Payment received",
      bold: true,
    });
    expect(rows(m)).toEqual(["Previous due", "Due now"]);
  });

  it("says all settled when nothing is left", () => {
    expect(rows(slip(300000, 0))).toEqual(["Previous due", "All settled"]);
  });

  it("shows an advance when the customer paid more than they owed", () => {
    const m = slip(100000, -200000);
    expect(rows(m)).toEqual(["Previous due", "Advance"]);
    expect(m.standing[1].value).toContain("2,000");
  });

  it("leaves out the previous due when it is not known or was an advance", () => {
    expect(rows(slip(null, 500000))).toEqual(["Due now"]);
    expect(rows(slip(-100000, -400000))).toEqual(["Advance"]);
  });

  it("lays out on paper without a doubled rule", () => {
    const layout = layoutReceipt(
      slip(1000000, 700000),
      384,
      (t) => t.length * 11,
    );
    const rules = layout.ops.filter((op) => op.kind === "rule");
    // Under the header, under the date and customer, above the standing: three.
    expect(rules).toHaveLength(3);
    expect(layout.height).toBeGreaterThan(200);
  });
});
