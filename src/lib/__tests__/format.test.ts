import { describe, expect, it } from "vitest";
import { createFormat } from "../format";

describe("format", () => {
  it("formats English money with lakh grouping and leading ৳", () => {
    const f = createFormat({ locale: "en" });
    expect(f.money(125_000)).toBe("৳1,250");
    expect(f.money(12_500_050)).toBe("৳1,25,000.50");
    expect(f.money(125_000, "always")).toBe("৳1,250.00");
    expect(f.money(-5000)).toBe("-৳50");
    expect(f.money(0)).toBe("৳0");
  });

  it("formats Bangla money with Bangla digits and leading ৳", () => {
    const f = createFormat({ locale: "bn" });
    expect(f.money(12_500_050)).toBe("৳১,২৫,০০০.৫০");
    expect(f.money(125_000)).toBe("৳১,২৫০");
  });

  it("honours the numerals preference independently of language", () => {
    expect(
      createFormat({ locale: "bn", numerals: "latn" }).money(12_500_050),
    ).toBe("৳1,25,000.50");
    expect(
      createFormat({ locale: "en", numerals: "beng" }).money(125_000),
    ).toBe("৳১,২৫০");
  });

  it("formats quantities without trailing zeros", () => {
    expect(createFormat({ locale: "en" }).qty(1500)).toBe("1.5");
    expect(createFormat({ locale: "en" }).qty(3000)).toBe("3");
    expect(createFormat({ locale: "bn" }).qty(2500)).toBe("২.৫");
  });

  it("formats dates in the store time zone", () => {
    // 2026-10-01T18:30:00Z is already 00:30 on Oct 2 in Dhaka (UTC+6)
    const at = "2026-10-01T18:30:00Z";
    expect(createFormat({ locale: "en" }).date(at)).toContain("2 Oct 2026");
    expect(createFormat({ locale: "bn" }).date(at)).toContain("২");
    expect(createFormat({ locale: "en", timeZone: "UTC" }).date(at)).toContain(
      "1 Oct 2026",
    );
  });
});
