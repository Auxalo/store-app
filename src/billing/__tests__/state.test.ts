import { describe, expect, it } from "vitest";
import { DEFAULT_PLATFORM_BILLING, plansFor } from "../plans";
import {
  type BillingDoc,
  billingStateOf,
  calendarDaysBetween,
  effectiveNow,
  endOfDhakaDay,
  marksFor,
  nextPeriod,
  normalizeTrxId,
  stampOf,
} from "../state";

// Dhaka is UTC+6 all year: midnight in Dhaka is 18:00 UTC the day before.
const at = (iso: string) => new Date(iso);
const end20Oct = endOfDhakaDay(2026, 9, 20); // 2026-10-20 23:59:59.999 Dhaka

function paid(extra: Partial<BillingDoc> = {}, grace = 3, reminder = 7) {
  const paidUntil = extra.paidUntil ?? end20Oct;
  return {
    mode: "paid" as const,
    paidOnce: true,
    paidUntil,
    ...marksFor(paidUntil, grace, reminder),
    ...extra,
  };
}

describe("dates", () => {
  it("a period ends at the end of its Dhaka day", () => {
    expect(end20Oct.toISOString()).toBe("2026-10-20T17:59:59.999Z");
  });

  it("warns from the start of the 7th day before and locks at the end of the last grace day", () => {
    const { warnFrom, lockAt } = marksFor(end20Oct, 3, 7);
    expect(warnFrom?.toISOString()).toBe("2026-10-12T18:00:00.000Z"); // 13 Oct, 00:00 Dhaka
    expect(lockAt?.toISOString()).toBe("2026-10-23T17:59:59.999Z"); // 23 Oct, 23:59 Dhaka
  });

  it("no grace days locks at the end of the period itself", () => {
    expect(marksFor(end20Oct, 0, 7).lockAt?.toISOString()).toBe(
      end20Oct.toISOString(),
    );
  });

  it("rolls over month ends when counting days", () => {
    const end30 = endOfDhakaDay(2026, 9, 30);
    expect(marksFor(end30, 3, 7).lockAt?.toISOString()).toBe(
      "2026-11-02T17:59:59.999Z",
    );
    const end3 = endOfDhakaDay(2026, 10, 3);
    expect(marksFor(end3, 3, 7).warnFrom?.toISOString()).toBe(
      "2026-10-26T18:00:00.000Z", // 27 Oct
    );
  });

  it("counts Dhaka calendar days, not 24-hour spans", () => {
    // 23:30 Dhaka on the 19th, and 00:30 Dhaka on the 20th: one calendar day apart.
    expect(
      calendarDaysBetween(
        at("2026-10-19T17:30:00Z"),
        at("2026-10-19T18:30:00Z"),
      ),
    ).toBe(1);
  });
});

describe("where a shop stands", () => {
  it("off and free never lock", () => {
    expect(billingStateOf(undefined, at("2030-01-01T00:00:00Z")).state).toBe(
      "off",
    );
    expect(billingStateOf({ mode: "off" }, Date.now()).locked).toBe(false);
    const free = billingStateOf({ mode: "free" }, at("2030-01-01T00:00:00Z"));
    expect(free).toMatchObject({ state: "free", locked: false });
  });

  it("goes active -> ending -> overdue -> locked across the Dhaka midnights", () => {
    const b = paid();
    const s = (iso: string) => billingStateOf(b, at(iso));
    expect(s("2026-10-05T06:00:00Z")).toMatchObject({
      state: "active",
      daysLeft: 15,
    });
    expect(s("2026-10-12T17:59:59Z").state).toBe("active"); // 12 Oct, 23:59 Dhaka
    expect(s("2026-10-12T18:00:00Z")).toMatchObject({
      state: "ending",
      daysLeft: 7,
    });
    expect(s("2026-10-20T17:59:59Z")).toMatchObject({
      state: "ending",
      daysLeft: 0,
    });
    expect(s("2026-10-20T18:00:00Z")).toMatchObject({
      state: "overdue",
      daysLeft: -1,
      locked: false,
    });
    expect(s("2026-10-23T17:59:59Z").state).toBe("overdue");
    expect(s("2026-10-23T18:00:00Z")).toMatchObject({
      state: "locked",
      locked: true,
    });
  });

  it("a shop that never paid is on trial", () => {
    const b = paid({ paidOnce: false });
    expect(billingStateOf(b, at("2026-10-05T06:00:00Z"))).toMatchObject({
      state: "trial",
      trial: true,
    });
    expect(billingStateOf(b, at("2026-10-24T06:00:00Z")).state).toBe("locked");
  });

  it("a paid shop with no period is locked", () => {
    expect(billingStateOf({ mode: "paid" }, Date.now()).state).toBe("locked");
  });

  it("a locked shop that sent a payment is let in until the opening ends", () => {
    const b = paid({ provisionalUntil: at("2026-10-26T06:00:00Z") });
    expect(billingStateOf(b, at("2026-10-25T06:00:00Z"))).toMatchObject({
      locked: false,
      provisional: true,
      state: "overdue",
    });
    expect(billingStateOf(b, at("2026-10-26T06:00:00Z")).locked).toBe(true);
  });

  it("a device reaches the same answer from what it was told", () => {
    const b = paid();
    const stamp = JSON.parse(
      JSON.stringify(stampOf(b, at("2026-10-01T00:00:00Z"))),
    );
    for (const iso of [
      "2026-10-05T06:00:00Z",
      "2026-10-15T06:00:00Z",
      "2026-10-21T06:00:00Z",
      "2026-10-24T06:00:00Z",
    ])
      expect(billingStateOf(stamp, at(iso))).toEqual(
        billingStateOf(b, at(iso)),
      );
  });
});

describe("the next period", () => {
  it("paying before the lock continues from the old end date", () => {
    const b = paid();
    const next = nextPeriod(b, 1, at("2026-10-22T06:00:00Z")); // in the grace days
    expect(next.paidUntil.toISOString()).toBe("2026-11-20T17:59:59.999Z");
    expect(next.anchorDay).toBe(20);
  });

  it("keeps the day of the month across short months", () => {
    const jan31 = endOfDhakaDay(2027, 0, 31);
    const b = paid({ paidUntil: jan31, anchorDay: 31 });
    const feb = nextPeriod(b, 1, at("2027-01-20T06:00:00Z"));
    expect(feb.paidUntil.toISOString()).toBe("2027-02-28T17:59:59.999Z");
    const afterFeb = paid({ paidUntil: feb.paidUntil, anchorDay: 31 });
    const mar = nextPeriod(afterFeb, 1, at("2027-02-20T06:00:00Z"));
    expect(mar.paidUntil.toISOString()).toBe("2027-03-31T17:59:59.999Z");
  });

  it("a locked shop starts again from today", () => {
    const b = paid();
    const next = nextPeriod(b, 1, at("2026-11-05T06:00:00Z")); // 5 Nov, locked since the 23rd
    expect(next.paidUntil.toISOString()).toBe("2026-12-05T17:59:59.999Z");
    expect(next.start.toISOString()).toBe("2026-11-05T06:00:00.000Z");
  });

  it("a year at once", () => {
    const next = nextPeriod(null, 12, at("2026-10-03T06:00:00Z"));
    expect(next.paidUntil.toISOString()).toBe("2027-10-03T17:59:59.999Z");
  });
});

describe("small helpers", () => {
  it("transaction ids compare without spaces, dashes or case", () => {
    expect(normalizeTrxId(" 9j7a-3b2c 1d ")).toBe("9J7A3B2C1D");
  });

  it("a device's 'now' follows the server and never goes back", () => {
    expect(effectiveNow(1_000, 500, undefined)).toBe(1_500);
    expect(effectiveNow(1_000, -500, 2_000)).toBe(2_000); // the clock was turned back
  });

  it("an agreed price fixes the shop to its own plan", () => {
    expect(plansFor(DEFAULT_PLATFORM_BILLING, {}).map((p) => p.id)).toEqual([
      "m1",
      "m6",
      "m12",
    ]);
    expect(
      plansFor(DEFAULT_PLATFORM_BILLING, { planId: "m1", price: 300_00 }),
    ).toEqual([expect.objectContaining({ id: "m1", price: 300_00 })]);
  });
});
