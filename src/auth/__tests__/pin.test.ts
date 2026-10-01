import { describe, expect, it } from "vitest";
import { lockoutState } from "../lockout";
import { hashPin, normalizePin, verifyPin } from "../pin";

describe("PIN hashing", () => {
  it("accepts the right PIN and rejects a wrong one", async () => {
    const stored = await hashPin("4821");
    expect(await verifyPin("4821", stored)).toBe(true);
    expect(await verifyPin("4822", stored)).toBe(false);
    expect(await verifyPin("", stored)).toBe(false);
  });

  it("never stores the PIN and salts every hash differently", async () => {
    const a = await hashPin("1234");
    const b = await hashPin("1234");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(JSON.stringify(a)).not.toContain("1234");
    expect(await verifyPin("1234", b)).toBe(true);
  });

  it("works with Bangla digits typed on a Bangla keyboard", async () => {
    expect(normalizePin("৪৮২১")).toBe("4821");
    expect(
      await verifyPin(normalizePin("৪৮২১") as string, await hashPin("4821")),
    ).toBe(true);
  });

  it("only allows 4 to 6 digits", () => {
    for (const bad of ["", "123", "1234567", "12a4", "12 34", "١٢٣٤"])
      expect(normalizePin(bad)).toBeNull();
    for (const good of ["1234", "12345", "123456", " 1234 "])
      expect(normalizePin(good)).not.toBeNull();
  });
});

describe("wrong-PIN lockout", () => {
  const now = 1_000_000;

  it("allows four mistakes freely", () => {
    expect(lockoutState(0, 0, now)).toEqual({
      waitMs: 0,
      needsOnlineLogin: false,
      freeLeft: 5,
    });
    expect(lockoutState(4, now, now)).toMatchObject({ waitMs: 0, freeLeft: 1 });
  });

  it("makes the person wait from the fifth mistake, doubling each time, then stops at a cap", () => {
    expect(lockoutState(5, now, now).waitMs).toBe(30_000);
    expect(lockoutState(6, now, now).waitMs).toBe(60_000);
    expect(lockoutState(7, now, now).waitMs).toBe(120_000);
    expect(lockoutState(14, now, now).waitMs).toBe(15 * 60_000);
  });

  it("counts the wait down and clears it once it has passed", () => {
    expect(lockoutState(5, now - 10_000, now).waitMs).toBe(20_000);
    expect(lockoutState(5, now - 31_000, now).waitMs).toBe(0);
  });

  it("requires an online sign-in after too many mistakes", () => {
    expect(lockoutState(15, now, now)).toEqual({
      waitMs: 0,
      needsOnlineLogin: true,
      freeLeft: 0,
    });
    expect(lockoutState(40, now, now).needsOnlineLogin).toBe(true);
  });
});
