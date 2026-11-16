import { describe, expect, it } from "vitest";
import { CURRENCIES, currencyCodeOf, currencyOf } from "../currency";
import { createFormat } from "../format";

describe("money in the shop's currency", () => {
  it("taka is the default and keeps lakh grouping", () => {
    const f = createFormat({ locale: "en" });
    expect(f.symbol).toBe("৳");
    expect(f.money(12_500_000)).toBe("৳1,25,000");
    expect(createFormat({ locale: "bn" }).money(125_000)).toBe("৳১,২৫০");
  });

  it("euro has a comma before the cents and dots between thousands", () => {
    const eur = createFormat({ locale: "en", currency: "EUR" });
    expect(eur.symbol).toBe("€");
    expect(eur.money(12_500_000)).toBe("€125.000");
    expect(eur.money(125_050)).toBe("€1.250,50");
    expect(eur.money(-5_000)).toBe("-€50");
    // As on a receipt: always two decimals.
    expect(eur.money(3_000, "always")).toBe("€30,00");
    expect(eur.money(4_050, "always")).toBe("€40,50");
    expect(eur.money(4_050)).toBe("€40,50");
    expect(eur.qty(1_500)).toBe("1,5");
    expect(eur.percent(7.5)).toBe("7,5%");
  });

  it("dollar keeps a dot before the cents and thousands grouping", () => {
    const usd = createFormat({ locale: "en", currency: "USD" });
    expect(usd.money(9_900, "always")).toBe("$99.00");
    expect(usd.money(125_050)).toBe("$1,250.50");
    expect(usd.qty(1_500)).toBe("1.5");
  });

  it("a Bangla-language shop in euro keeps Bangla digits and the euro sign", () => {
    const f = createFormat({ locale: "bn", currency: "EUR" });
    expect(f.money(12_500_000)).toBe("€১২৫.০০০");
    expect(f.money(125_000)).toBe("€১.২৫০");
    expect(f.money(4_050, "always")).toBe("€৪০,৫০");
  });

  it("rupee keeps lakh grouping", () => {
    expect(
      createFormat({ locale: "en", currency: "INR" }).money(12_500_000),
    ).toBe("₹1,25,000");
  });

  it("dates keep the language's own names whatever the currency", () => {
    const bn = createFormat({ locale: "bn", currency: "EUR" });
    const date = bn.date("2026-11-20T10:00:00Z");
    expect(date).toBe(
      createFormat({ locale: "bn" }).date("2026-11-20T10:00:00Z"),
    );
  });

  it("an unknown or missing saved value means taka", () => {
    expect(currencyCodeOf(undefined)).toBe("BDT");
    expect(currencyCodeOf("GBP")).toBe("BDT");
    expect(currencyCodeOf("EUR")).toBe("EUR");
    expect(currencyOf(undefined).symbol).toBe("৳");
  });

  it("every currency has quick-cash notes in ascending order", () => {
    for (const c of CURRENCIES)
      expect([...c.notes]).toEqual([...c.notes].sort((a, b) => a - b));
  });
});
