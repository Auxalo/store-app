import { describe, expect, it } from "vitest";
import { isValidPhone, normalizePhone } from "../phone";

describe("phone numbers", () => {
  it("accepts an empty phone (it is optional)", () => {
    expect(isValidPhone("")).toBe(true);
    expect(isValidPhone("   ")).toBe(true);
    expect(normalizePhone("")).toBe("");
  });

  it("accepts Bangladeshi numbers typed in different ways, and stores plain digits", () => {
    for (const typed of [
      "01711000001",
      "01711-000001",
      "০১৭১১ ০০০০০১",
      "+880 1711-000001",
    ]) {
      expect(isValidPhone(typed)).toBe(true);
    }
    expect(normalizePhone("০১৭১১-০০০০০১")).toBe("01711000001");
    expect(normalizePhone("+880 1711 000001")).toBe("+8801711000001");
  });

  it("rejects text, too few digits and too many digits", () => {
    expect(isValidPhone("abc")).toBe(false);
    expect(isValidPhone("call me")).toBe(false);
    expect(isValidPhone("12345")).toBe(false);
    expect(isValidPhone("1234567890123456")).toBe(false);
  });
});
