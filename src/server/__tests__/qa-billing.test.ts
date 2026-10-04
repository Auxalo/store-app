/**
 * QA audit, part 3: billing edge cases (findings B2, B3, B4, B5, B6). See docs/QA-REPORT.md.
 */
import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  type BillingDoc,
  type BillingStamp,
  billingStateOf,
  endOfDhakaDay,
  marksFor,
} from "@/billing/state";
import { dayKeySchema, paymentsQuery } from "@/schemas/billing";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import {
  extendShop,
  forgetPlatformBilling,
  setShopBilling,
  submitPayment,
} from "../billing";
import { clearStoreCaches } from "../cache";
import { HttpError } from "../http";
import { shopGate } from "../shop-status";

vi.mock("server-only", () => ({}));

let mongo: TestMongo;
const admin = { id: "op-1", name: "Operator" };
const owner = { id: "u-1", name: "Owner" };
const end20Oct = endOfDhakaDay(2026, 9, 20);

beforeAll(async () => {
  mongo = await startMongo();
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

beforeEach(() => {
  clearStoreCaches();
  forgetPlatformBilling();
});

async function shopWith(billing: Partial<BillingDoc> | null) {
  const storeId = await mongo.seedStore("QA Billing");
  if (billing) {
    const doc: BillingDoc = {
      mode: "paid",
      planId: "m1",
      paidOnce: true,
      paidUntil: end20Oct,
      ...marksFor(end20Oct, 3, 7),
      ...billing,
    };
    await mongo.db
      .collection<{ _id: string }>("stores")
      .updateOne({ _id: storeId }, { $set: { billing: doc } });
  }
  clearStoreCaches();
  return storeId;
}

async function billingOf(storeId: string) {
  clearStoreCaches();
  return (await shopGate(mongo.db, storeId)).billing as BillingDoc;
}

const pay = (trxId: string) => ({
  method: "bkash" as const,
  trxId,
  sender: "01711000001",
  amount: 500_00,
  planId: "m1",
});

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (e: unknown) => (e instanceof HttpError ? e.code : String(e)),
  );

describe("QA B2: paying in the last days before the lock", () => {
  it("a shop that pays during its grace days is not locked while the payment is checked", async () => {
    const shop = await shopWith({});
    const inGrace = new Date("2026-10-22T06:00:00Z"); // 2 days past the end, locks on the 23rd
    expect(billingStateOf(await billingOf(shop), inGrace).state).toBe(
      "overdue",
    );
    await submitPayment(mongo.db, shop, owner, pay("G0000001"), inGrace);
    // The operator takes a day to check: by then the grace days are over.
    const nextDay = new Date("2026-10-24T06:00:00Z");
    expect(billingStateOf(await billingOf(shop), nextDay).locked).toBe(false);
  });

  it("no more than three payments wait at once, even when they arrive together", async () => {
    const shop = await shopWith({});
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        code(submitPayment(mongo.db, shop, owner, pay(`PAR${i}00000${i}`))),
      ),
    );
    expect(results.filter((r) => r === "ok").length).toBeLessThanOrEqual(3);
    expect(
      await mongo.db
        .collection("billingPayments")
        .countDocuments({ storeId: shop, status: "pending" }),
    ).toBeLessThanOrEqual(3);
  });
});

describe("QA B3: extra days for a shop that is let in while a payment is checked", () => {
  it("extra days count from today, so the shop is not locked again at once", async () => {
    const shop = await shopWith({});
    const locked = new Date("2026-10-25T06:00:00Z");
    await submitPayment(mongo.db, shop, owner, pay("E0000001"), locked); // let in for 48 hours
    expect(billingStateOf(await billingOf(shop), locked).locked).toBe(false);

    await extendShop(mongo.db, admin, shop, 1, "a gift", locked);
    expect(billingStateOf(await billingOf(shop), locked).locked).toBe(false);
  });
});

describe("QA B4: operator changes that must not lock a shop by surprise", () => {
  it("a paying shop cannot be left without an end date", async () => {
    const shop = await shopWith({});
    expect(
      await code(setShopBilling(mongo.db, admin, shop, { paidUntil: null })),
    ).not.toBe("ok");
  });

  it("turning billing on for a shop with an old end date gives it a trial instead of locking it", async () => {
    const shop = await shopWith({
      mode: "free",
      paidUntil: end20Oct,
      lockAt: end20Oct,
    });
    const now = new Date("2026-11-10T06:00:00Z");
    await setShopBilling(mongo.db, admin, shop, { mode: "paid" }, now);
    expect(billingStateOf(await billingOf(shop), now).locked).toBe(false);
  });
});

describe("QA B5: an older answer arriving late", () => {
  it("does not take back a newer billing the device already has", async () => {
    const { ingestStamp, useBillingStore } = await import("@/billing/client");
    const stamp = (
      serverTime: string,
      state: "open" | "locked",
    ): BillingStamp => ({
      mode: "paid",
      plan: null,
      paidOnce: true,
      paidUntil: end20Oct.toISOString(),
      warnFrom: null,
      lockAt:
        state === "locked"
          ? "2026-10-01T00:00:00.000Z"
          : "2030-01-01T00:00:00.000Z",
      provisionalUntil: null,
      serverTime,
    });
    useBillingStore.getState().set({ stamp: null, highWater: 0, offsetMs: 0 });
    // After the operator approved: the newer answer (open)...
    await ingestStamp(stamp("2026-10-05T10:00:10.000Z", "open"));
    // ...then a slower, older answer (still locked) arrives.
    await ingestStamp(stamp("2026-10-05T10:00:00.000Z", "locked"));
    expect(useBillingStore.getState().stamp?.lockAt).toBe(
      "2030-01-01T00:00:00.000Z",
    );
  });
});

describe("QA B6: dates must be real dates", () => {
  it("refuses a day that does not exist", () => {
    expect(dayKeySchema.safeParse("2026-10-31").success).toBe(true);
    expect(dayKeySchema.safeParse("2026-13-45").success).toBe(false);
    expect(dayKeySchema.safeParse("2026-02-30").success).toBe(false);
  });

  it("refuses a month that does not exist", () => {
    expect(paymentsQuery.safeParse({ month: "2026-10" }).success).toBe(true);
    expect(paymentsQuery.safeParse({ month: "2026-13" }).success).toBe(false);
    expect(paymentsQuery.safeParse({ month: "2026-00" }).success).toBe(false);
  });
});

void randomUUID;
