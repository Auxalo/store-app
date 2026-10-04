import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { DEFAULT_PLATFORM_BILLING } from "@/billing/plans";
import {
  type BillingDoc,
  billingStateOf,
  endOfDhakaDay,
} from "@/billing/state";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import {
  approvePayment,
  extendShop,
  forgetPlatformBilling,
  getPlatformBilling,
  initialBilling,
  recordManualPayment,
  rejectPayment,
  savePlatformBilling,
  setShopBilling,
  shopBillingView,
  submitPayment,
} from "../billing";
import { clearStoreCaches } from "../cache";
import { HttpError } from "../http";
import { shopGate } from "../shop-status";

vi.mock("server-only", () => ({}));

let mongo: TestMongo;
const admin = { id: "op-1", name: "Operator One" };
const owner = { id: "u-1", name: "Owner" };

// 5 Oct 2026, noon in Dhaka.
const NOW = new Date("2026-10-05T06:00:00Z");
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

/** A shop with billing set straight on its record. */
async function shopWith(billing: Partial<BillingDoc> | null, name = "Shop") {
  const storeId = await mongo.seedStore(name);
  if (billing) {
    const settings = await getPlatformBilling(mongo.db);
    const doc = {
      ...initialBilling(settings, NOW, { mode: "paid", paidUntil: end20Oct }),
      ...billing,
    };
    // Recompute the marks the same way the service does.
    const { marksFor } = await import("@/billing/state");
    Object.assign(
      doc,
      marksFor(doc.paidUntil ?? null, doc.graceDays ?? 3, 7),
      billing.lockAt !== undefined ? { lockAt: billing.lockAt } : {},
    );
    await mongo.db
      .collection<{ _id: string }>("stores")
      .updateOne({ _id: storeId }, { $set: { billing: doc } });
  }
  return storeId;
}

const pay = (trxId: string, extra: Record<string, unknown> = {}) => ({
  method: "bkash" as const,
  trxId,
  sender: "01711000001",
  amount: 500_00,
  planId: "m1",
  ...extra,
});

async function billingOf(storeId: string) {
  clearStoreCaches();
  return (await shopGate(mongo.db, storeId)).billing as BillingDoc;
}

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (e: unknown) => (e instanceof HttpError ? e.code : String(e)),
  );

describe("how a new shop starts", () => {
  it("gets the operator's trial by default", () => {
    const b = initialBilling(DEFAULT_PLATFORM_BILLING, NOW);
    expect(b.mode).toBe("paid");
    expect(b.paidOnce).toBe(false);
    expect(b.paidUntil?.toISOString()).toBe("2026-10-19T17:59:59.999Z"); // 5 Oct + 14 days
    expect(billingStateOf(b, NOW).state).toBe("trial");
  });

  it("can start free or without billing", () => {
    expect(
      initialBilling(DEFAULT_PLATFORM_BILLING, NOW, { mode: "free" }),
    ).toEqual({ mode: "free" });
    expect(
      initialBilling(DEFAULT_PLATFORM_BILLING, NOW, { mode: "off" }),
    ).toEqual({ mode: "off" });
  });
});

describe("a shop sends a payment", () => {
  it("waits for the operator and shows on the shop's billing page", async () => {
    const shop = await shopWith({});
    const { payment, opened } = await submitPayment(
      mongo.db,
      shop,
      owner,
      pay("AB12CD34EF"),
      NOW,
    );
    expect(payment.status).toBe("pending");
    expect(opened).toBe(false); // not locked: nothing to open
    const view = await shopBillingView(mongo.db, shop, true, NOW);
    expect(view.payments?.map((p) => p.trxId)).toEqual(["AB12CD34EF"]);
    expect(view.payTo?.bkash).toBe("01772998823");
    // Someone who cannot pay (a cashier) is only told where the shop stands.
    expect(
      Object.keys(await shopBillingView(mongo.db, shop, false, NOW)),
    ).toEqual(["billing"]);
  });

  it("a transaction id counts once, whichever shop sends it", async () => {
    const a = await shopWith({}, "A");
    const b = await shopWith({}, "B");
    await submitPayment(mongo.db, a, owner, pay("DUP0000001"), NOW);
    expect(
      await code(submitPayment(mongo.db, b, owner, pay("dup-000 0001"), NOW)),
    ).toBe("TRX_USED");
    // Nothing of shop A is visible to shop B.
    const view = await shopBillingView(mongo.db, b, true, NOW);
    expect(view.payments).toEqual([]);
  });

  it("at most three wait at once", async () => {
    const shop = await shopWith({});
    for (const id of ["P1000001", "P1000002", "P1000003"])
      await submitPayment(mongo.db, shop, owner, pay(id), NOW);
    expect(
      await code(submitPayment(mongo.db, shop, owner, pay("P1000004"), NOW)),
    ).toBe("TOO_MANY_PENDING");
  });

  it("a shop without paid billing, or a plan it may not choose, is refused", async () => {
    const free = await shopWith({ mode: "free" });
    expect(
      await code(submitPayment(mongo.db, free, owner, pay("F0000001"), NOW)),
    ).toBe("BILLING_NOT_PAID");
    const off = await shopWith(null);
    expect(
      await code(submitPayment(mongo.db, off, owner, pay("F0000002"), NOW)),
    ).toBe("BILLING_NOT_PAID");
    const agreed = await shopWith({ planId: "m1", price: 300_00 });
    expect(
      await code(
        submitPayment(
          mongo.db,
          agreed,
          owner,
          pay("F0000003", { planId: "m12" }),
          NOW,
        ),
      ),
    ).toBe("INVALID_PLAN");
  });

  it("a locked shop is let in for 48 hours, once per period", async () => {
    const shop = await shopWith({});
    const later = new Date("2026-10-25T06:00:00Z"); // locked since the end of the 23rd
    expect(billingStateOf(await billingOf(shop), later).locked).toBe(true);
    const first = await submitPayment(
      mongo.db,
      shop,
      owner,
      pay("L0000001"),
      later,
    );
    expect(first.opened).toBe(true);
    const open = await billingOf(shop);
    expect(billingStateOf(open, later)).toMatchObject({
      locked: false,
      provisional: true,
    });
    expect(
      billingStateOf(open, new Date(later.getTime() + 48 * 3_600_000)).locked,
    ).toBe(true);
    // Rejected, and a second try in the same period: no second opening.
    await rejectPayment(
      mongo.db,
      admin,
      first.payment.id,
      "No such payment",
      later,
    );
    expect(billingStateOf(await billingOf(shop), later).locked).toBe(true);
    const second = await submitPayment(
      mongo.db,
      shop,
      owner,
      pay("L0000002"),
      later,
    );
    expect(second.opened).toBe(false);
  });
});

describe("the operator reviews payments", () => {
  it("approving moves the period on from its end and opens the shop", async () => {
    const shop = await shopWith({});
    const { payment } = await submitPayment(
      mongo.db,
      shop,
      owner,
      pay("A0000001"),
      NOW,
    );
    const approved = await approvePayment(mongo, admin, payment.id, {}, NOW);
    expect(approved.status).toBe("approved");
    const b = await billingOf(shop);
    expect(b.paidUntil?.toISOString()).toBe("2026-11-20T17:59:59.999Z");
    expect(b.paidOnce).toBe(true);
    expect(billingStateOf(b, NOW).state).toBe("active");
    // Never twice.
    expect(await code(approvePayment(mongo, admin, payment.id, {}, NOW))).toBe(
      "ALREADY_REVIEWED",
    );
  });

  it("a locked shop starts again from the day it is approved", async () => {
    const shop = await shopWith({});
    const later = new Date("2026-11-05T06:00:00Z");
    const { payment } = await submitPayment(
      mongo.db,
      shop,
      owner,
      pay("A0000002"),
      later,
    );
    await approvePayment(mongo, admin, payment.id, { months: 6 }, later);
    const b = await billingOf(shop);
    expect(b.paidUntil?.toISOString()).toBe("2027-05-05T17:59:59.999Z");
    expect(b.provisionalUntil).toBeNull();
    expect(billingStateOf(b, later).locked).toBe(false);
  });

  it("rejecting frees the transaction id so it can be sent again", async () => {
    const shop = await shopWith({});
    const { payment } = await submitPayment(
      mongo.db,
      shop,
      owner,
      pay("R0000001"),
      NOW,
    );
    const rejected = await rejectPayment(
      mongo.db,
      admin,
      payment.id,
      "Wrong amount",
      NOW,
    );
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: "Wrong amount",
    });
    expect(
      await code(submitPayment(mongo.db, shop, owner, pay("R0000001"), NOW)),
    ).toBe("ok");
  });

  it("a payment taken by hand moves the period on and is logged", async () => {
    const shop = await shopWith({ mode: "off" }, "Cash Shop");
    await recordManualPayment(
      mongo,
      admin,
      shop,
      {
        amount: 1_000_00,
        method: "cash",
        trxId: "",
        months: 2,
        note: "at the shop",
      },
      NOW,
    );
    const b = await billingOf(shop);
    expect(b.mode).toBe("paid"); // a shop without billing that pays is now paying
    expect(b.paidOnce).toBe(true);
    const log = await mongo.db
      .collection("platformAudit")
      .findOne({ action: "billing.record", storeId: shop });
    expect(log?.detail).toContain("Cash Shop");
    expect(log?.detail).toContain("at the shop");
  });
});

describe("the operator changes a shop's billing", () => {
  it("turning billing on gives the trial, a date sets the end, and every change is logged", async () => {
    const shop = await shopWith(null, "Old Shop");
    const on = await setShopBilling(
      mongo.db,
      admin,
      shop,
      { mode: "paid" },
      NOW,
    );
    expect(on?.paidUntil?.toISOString()).toBe("2026-10-19T17:59:59.999Z");
    expect(billingStateOf(on, NOW).state).toBe("trial");

    const dated = await setShopBilling(
      mongo.db,
      admin,
      shop,
      { paidUntil: "2026-12-31", graceDays: 0 },
      NOW,
    );
    expect(dated?.paidUntil?.toISOString()).toBe("2026-12-31T17:59:59.999Z");
    expect(dated?.lockAt?.toISOString()).toBe("2026-12-31T17:59:59.999Z");

    const free = await setShopBilling(
      mongo.db,
      admin,
      shop,
      { mode: "free" },
      NOW,
    );
    expect(billingStateOf(free, new Date("2030-01-01")).state).toBe("free");

    const actions = await mongo.db
      .collection("platformAudit")
      .find({ storeId: shop, action: "billing.update" })
      .toArray();
    expect(actions).toHaveLength(3);
  });

  it("extra days go on the end, or from today for a locked shop", async () => {
    const shop = await shopWith({});
    const b = await extendShop(
      mongo.db,
      admin,
      shop,
      10,
      "sorry for the outage",
      NOW,
    );
    expect(b?.paidUntil?.toISOString()).toBe("2026-10-30T17:59:59.999Z");
    const later = new Date("2026-11-10T06:00:00Z");
    const c = await extendShop(mongo.db, admin, shop, 3, "", later);
    expect(c?.paidUntil?.toISOString()).toBe("2026-11-13T17:59:59.999Z");
    expect(
      await code(
        extendShop(
          mongo.db,
          admin,
          await shopWith({ mode: "free" }),
          3,
          "",
          NOW,
        ),
      ),
    ).toBe("BILLING_NOT_PAID");
  });

  it("new grace days apply to every paying shop at once", async () => {
    const shop = await shopWith({});
    const before = await billingOf(shop);
    expect(before.lockAt?.toISOString()).toBe("2026-10-23T17:59:59.999Z");
    await savePlatformBilling(mongo.db, admin, {
      ...DEFAULT_PLATFORM_BILLING,
      graceDays: 5,
    });
    expect((await billingOf(shop)).lockAt?.toISOString()).toBe(
      "2026-10-25T17:59:59.999Z",
    );
    // Put the default back for the other tests.
    await savePlatformBilling(mongo.db, admin, DEFAULT_PLATFORM_BILLING);
  });
});
