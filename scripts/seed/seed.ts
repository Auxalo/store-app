import "fake-indexeddb/auto";
import type { LocalContext } from "@/commands/local/registry";
import { runCommand } from "@/commands/local/run";
import { StoreDB } from "@/db/local/db";
import { getDeviceId, setMeta } from "@/db/local/meta";
import type { Product } from "@/db/local/types";
import { getDb } from "@/db/server/mongo";
import { AUDIT_SETTING, SETUP_SETTING } from "@/lib/constants";
import { newId } from "@/lib/ids";
import { startOfStoreDay } from "@/lib/time";
import { dayKey } from "@/reports/compute";
import { getSyncDeps } from "@/server/deps";
import { registerDevice } from "@/server/devices";
import { createStoreWithOwner } from "@/server/onboarding";
import { createStaffMember } from "@/server/staff-admin";
import { handlePull } from "@/server/sync/pull";
import { handlePush } from "@/server/sync/push";
import { syncOnce } from "@/sync/engine";
import type { SyncTransport } from "@/sync/transport";
import {
  CATEGORIES,
  CUSTOMERS,
  MONTHLY_EXPENSES,
  OWNER,
  PRODUCTS,
  RECEIPT_FOOTER,
  STAFF,
  STORE_PROFILE,
  SUPPLIERS,
} from "./catalog";

/**
 * Builds a demo shop with a month of believable history, by doing what people would do in the app:
 * the same commands, run on a (simulated) device and sent through the real sync code to MongoDB.
 * So everything in it (stock ledger, customer dues, invoices, audit trail, reports) is exactly what
 * the app itself would have produced.
 *
 *   pnpm db:seed            create the demo shop (does nothing if it already exists)
 *   pnpm db:seed --reset    delete the demo shop and create it again
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const DAYS = 30;
const taka = (n: number) => Math.round(n * 100);
const milli = (n: number) => Math.round(n * 1000);

// --- a repeatable "random" so the demo is the same every time ---
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(2610);
const chance = (p: number) => rand() < p;
const between = (lo: number, hi: number) =>
  lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(items: readonly T[]): T =>
  items[Math.floor(rand() * items.length)];
function weighted<T>(items: readonly T[], weight: (item: T) => number): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let roll = rand() * total;
  for (const item of items) {
    roll -= weight(item);
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

// --- the simulated clock: commands stamp records with "now", so we set "now" while they run ---
const RealDate = Date;
let fixedNow: number | null = null;
class SimulatedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(fixedNow ?? RealDate.now());
    else super(...(args as [number]));
  }
  static now() {
    return fixedNow ?? RealDate.now();
  }
}
globalThis.Date = SimulatedDate as unknown as DateConstructor;
async function at<T>(time: number, work: () => Promise<T>): Promise<T> {
  fixedNow = Math.min(time, RealDate.now());
  try {
    return await work();
  } finally {
    fixedNow = null;
  }
}

async function main() {
  const reset = process.argv.includes("--reset");
  const deps = await getSyncDeps();
  const db = await getDb();

  const existing = await db
    .collection("user")
    .findOne({ username: OWNER.username });
  if (existing) {
    if (!reset) {
      console.log(
        `The demo shop already exists (login: ${OWNER.username}). Use "pnpm db:seed --reset" to rebuild it.`,
      );
      return;
    }
    await wipeStore(String(existing.storeId));
    console.log("Old demo shop deleted.");
  }

  // --- the shop, its people, and the device that "worked" for the month ---
  const { storeId, userId: ownerId } = await createStoreWithOwner(
    OWNER as never,
  );
  const staff: Record<string, string> = {};
  for (const person of STAFF)
    staff[person.role] = (await createStaffMember(db, storeId, person)).id;

  const local = new StoreDB(`seed-${newId()}`);
  const deviceId = await getDeviceId(local);
  const reg = await registerDevice(db, {
    storeId,
    userId: ownerId,
    deviceId,
    name: "দোকানের কম্পিউটার (ডেমো)",
    existing: { ok: false, reason: "missing" },
  });
  await setMeta(local, "deviceCode", reg.code);
  await setMeta(local, "storeId", storeId);

  const ctxOf = (
    role: "owner" | "manager" | "cashier",
    actorUserId: string,
  ): LocalContext => ({ storeId, actorUserId, role, deviceId });
  const owner = ctxOf("owner", ownerId);
  const manager = ctxOf("manager", staff.manager);
  const cashier = ctxOf("cashier", staff.cashier);
  const run = (
    ctx: LocalContext,
    time: number,
    type: Parameters<typeof runCommand>[2],
    input: unknown,
  ) => at(time, () => runCommand(local, ctx, type, input));

  const transport: SyncTransport = {
    push: async (request) =>
      JSON.parse(
        JSON.stringify(
          await handlePush(
            deps,
            { storeId, deviceId },
            JSON.parse(JSON.stringify(request)),
          ),
        ),
      ),
    pull: async (cursor) =>
      JSON.parse(JSON.stringify(await handlePull(deps.db, storeId, cursor))),
  };
  const sync = async () => {
    for (let i = 0; i < 20; i++) {
      await syncOnce(local, transport, {
        deviceId,
        appVersion: "1.0.0",
        now: () => RealDate.now() + i * 3_600_000,
      });
      if (
        (await local.outbox
          .where("status")
          .anyOf("pending", "syncing")
          .count()) === 0
      )
        return;
    }
    throw new Error("could not finish syncing the demo data");
  };

  const firstDay = startOfStoreDay(RealDate.now() - (DAYS - 1) * DAY).getTime();
  const dayStart = (daysAgo: number) =>
    startOfStoreDay(RealDate.now() - daysAgo * DAY).getTime();

  // --- day 1 morning: set the shop up ---
  const t0 = firstDay + 8 * HOUR;
  await run(owner, t0, "setting.set", {
    key: "store.profile",
    value: STORE_PROFILE,
  });
  await run(owner, t0 + 1000, "setting.set", {
    key: "receipt.footer",
    value: RECEIPT_FOOTER,
  });
  // The demo shows the audit trail, so it is switched on (real shops start with it off).
  await run(owner, t0 + 1500, "setting.set", {
    key: AUDIT_SETTING,
    value: true,
  });

  const categoryId = new Map<string, string>();
  for (const [i, c] of CATEGORIES.entries()) {
    const id = newId();
    categoryId.set(c.name, id);
    await run(owner, t0 + 2000 + i * 1000, "category.create", {
      id,
      name: c.name,
      nameBn: c.nameBn,
      description: "",
    });
  }
  const supplierIds: string[] = [];
  for (const [i, s] of SUPPLIERS.entries()) {
    const id = newId();
    supplierIds.push(id);
    await run(owner, t0 + 20_000 + i * 1000, "supplier.create", {
      id,
      name: s.nameBn,
      phone: s.phone,
      contactPerson: s.contactPerson,
      address: s.address,
    });
  }
  const customerIds: string[] = [];
  for (const [i, c] of CUSTOMERS.entries()) {
    const id = newId();
    customerIds.push(id);
    await run(owner, t0 + 30_000 + i * 1000, "customer.create", {
      id,
      name: c.name,
      phone: c.phone,
      address: c.address,
    });
  }

  // What they already owed when the shop started using the app (previous khata balances).
  const previousDue = [125_000, 0, 60_000, 0, 240_000, 0, 0, 35_000];
  for (const [i, amount] of previousDue.entries()) {
    if (amount === 0) continue;
    await run(owner, t0 + 40_000 + i * 1000, "party.openingBalance", {
      id: newId(),
      partyType: "customer",
      partyId: customerIds[i],
      amount,
      note: "আগের হিসাব",
    });
  }
  await run(owner, t0 + 50_000, "party.openingBalance", {
    id: newId(),
    partyType: "supplier",
    partyId: supplierIds[0],
    amount: 850_000,
    note: "আগের হিসাব",
  });
  // The demo shop is already set up.
  await run(owner, t0 + 51_000, "setting.set", {
    key: SETUP_SETTING,
    value: new RealDate(t0).toISOString(),
  });

  interface Item {
    id: string;
    spec: (typeof PRODUCTS)[number];
  }
  const items: Item[] = [];
  for (const [i, spec] of PRODUCTS.entries()) {
    const id = newId();
    items.push({ id, spec });
    const perUnit = milli(1);
    await run(owner, t0 + 60_000 + i * 1000, "product.create", {
      id,
      // One name per product, in the language the shop writes it: this shop writes Bangla.
      name: spec.nameBn,
      nameBn: "",
      categoryId: categoryId.get(spec.category) ?? null,
      unit: spec.unit,
      sku: `P${String(i + 1).padStart(3, "0")}`,
      purchasePrice: taka(spec.buy),
      sellingPrice: taka(spec.sell),
      lowStockThreshold: milli(spec.low),
      isActive: true,
      // Enough on the shelf to last the month: what is left at the end plus what gets sold.
      openingStock: Math.round((spec.endStock + spec.daily * 14) * perUnit),
      openingMovementId: newId(),
    });
  }
  await sync();

  // --- the month, day by day ---
  const sold: Array<{
    id: string;
    at: number;
    lines: Array<{
      productId: string;
      productName: string;
      productNameBn: string;
      unit: string;
      qty: number;
      unitPrice: number;
    }>;
  }> = [];
  const voidedIds = new Set<string>();
  const returnedIds = new Set<string>();
  const stockOf = async (id: string): Promise<Product> => {
    const product = await local.products.get(id);
    if (!product) throw new Error(`missing product ${id}`);
    return product;
  };

  const qtyFor = (unit: string) => {
    if (unit === "kg" || unit === "litre")
      return pick([500, 1000, 1000, 2000, 2000, 3000, 5000]);
    if (unit === "dozen") return pick([1000, 1000, 2000]);
    return pick([1000, 1000, 1000, 2000, 2000, 3000]);
  };

  async function sale(time: number) {
    const lines = [];
    const chosen = new Set<string>();
    for (let n = between(1, 5); n > 0; n--) {
      const item = weighted(items, (i) => i.spec.daily);
      if (chosen.has(item.id)) continue;
      const product = await stockOf(item.id);
      let qty = qtyFor(item.spec.unit);
      if (product.stock < qty) qty = product.stock >= 1000 ? 1000 : 0;
      if (qty <= 0) continue;
      chosen.add(item.id);
      lines.push({
        productId: item.id,
        productName: item.spec.nameBn,
        productNameBn: "",
        unit: item.spec.unit,
        qty,
        listPrice: product.sellingPrice,
        unitPrice: product.sellingPrice,
        unitCost: product.purchasePrice,
        discount: 0,
      });
    }
    if (lines.length === 0) return;

    const total = lines.reduce(
      (s, l) => s + Math.round((l.unitPrice * l.qty) / 1000),
      0,
    );
    const discount =
      total >= taka(300) && chance(0.2)
        ? pick([taka(5), taka(10), taka(20)])
        : 0;
    const payable = total - discount;
    const onCredit = chance(0.12);
    const customer = onCredit || chance(0.15) ? pick(customerIds) : null;
    const customerName = customer
      ? CUSTOMERS[customerIds.indexOf(customer)].name
      : "";
    const actor = weighted([owner, cashier, manager], (c) =>
      c === cashier ? 5 : c === owner ? 4 : 2,
    );
    const id = newId();
    await run(actor, time, "sale.create", {
      id,
      lines,
      discount,
      customerId: customer,
      customerName,
      tendered: onCredit
        ? Math.floor((payable * pick([0, 0.3, 0.5])) / 100) * 100
        : payable,
      paymentMethod: onCredit
        ? "cash"
        : weighted(
            ["cash", "bkash", "nagad", "card"] as const,
            (m) => ({ cash: 70, bkash: 20, nagad: 7, card: 3 })[m],
          ),
    });
    sold.push({
      id,
      at: time,
      lines: lines.map(
        ({ productId, productName, productNameBn, unit, qty, unitPrice }) => ({
          productId,
          productName,
          productNameBn,
          unit,
          qty,
          unitPrice,
        }),
      ),
    });
  }

  async function restock(time: number, ago: number) {
    for (const [index, supplierId] of supplierIds.entries()) {
      if (!chance(0.85)) continue;
      const lines = [];
      for (const item of items.filter((i) => i.spec.supplier === index)) {
        const product = await stockOf(item.id);
        const showcase = item.spec.endStock <= item.spec.low;
        if (showcase && ago < 12) continue; // let the "low/out" items run down for the demo
        if (product.stock > milli(item.spec.endStock + item.spec.daily * 7))
          continue;
        const units = Math.max(item.spec.low, Math.round(item.spec.daily * 12));
        lines.push({
          productId: item.id,
          productName: item.spec.nameBn,
          productNameBn: "",
          unit: item.spec.unit,
          qty: milli(units),
          unitCost: Math.round(taka(item.spec.buy) * (0.97 + rand() * 0.06)),
          discount: 0,
        });
      }
      if (lines.length === 0) continue;
      const total = lines.reduce(
        (s, l) => s + Math.round((l.unitCost * l.qty) / 1000),
        0,
      );
      await run(owner, time + index * 60_000, "purchase.create", {
        id: newId(),
        supplierId,
        supplierName: SUPPLIERS[index].nameBn,
        date: dayKey(time),
        lines,
        paid: chance(0.5)
          ? total
          : Math.round((total * pick([0.4, 0.6])) / 100) * 100,
        paymentMethod: pick(["cash", "bank"] as const),
        updateCosts: true,
      });
    }
  }

  for (let ago = DAYS - 1; ago >= 0; ago--) {
    const start = dayStart(ago);
    const friday = new RealDate(start + 6 * HOUR).getUTCDay() === 5;
    const times = Array.from(
      { length: Math.round(between(16, 30) * (friday ? 1.25 : 1)) },
      () => start + 9 * HOUR + Math.floor(rand() * 13 * HOUR),
    )
      .filter((t) => t < RealDate.now() - 60_000)
      .sort((a, b) => a - b);

    if (ago % 3 === 0 && ago < DAYS - 2)
      await restock(start + 8 * HOUR + 30 * 60_000, ago);

    for (const time of times) {
      await sale(time);
      // Now and then a customer pays something off.
      if (chance(0.06)) {
        const owing = (await local.customers.toArray()).filter(
          (c) => c.balance > 0,
        );
        if (owing.length > 0) {
          const c = pick(owing);
          await run(
            chance(0.5) ? owner : cashier,
            time + 120_000,
            "payment.collect",
            {
              id: newId(),
              partyId: c.id,
              amount: Math.min(
                c.balance,
                Math.max(
                  100,
                  Math.round((c.balance * pick([0.5, 1, 1])) / 100) * 100,
                ),
              ),
              method: pick(["cash", "bkash"] as const),
            },
          );
        }
      }
    }

    const noon = start + 13 * HOUR;
    for (const e of MONTHLY_EXPENSES.filter((x) => x.daysAgo === ago)) {
      if (noon < RealDate.now())
        await run(owner, noon, "expense.create", {
          id: newId(),
          category: e.category,
          amount: taka(e.amount),
          description: e.description,
          date: dayKey(noon),
          method: "cash",
        });
    }
    if (ago % 3 === 1 && noon < RealDate.now())
      await run(manager, noon + 600_000, "expense.create", {
        id: newId(),
        category: "transport",
        amount: taka(between(100, 400)),
        description: "ভ্যান ভাড়া",
        date: dayKey(noon),
        method: "cash",
      });
    if (ago % 7 === 2 && noon < RealDate.now())
      await run(manager, noon + 900_000, "expense.create", {
        id: newId(),
        category: "food",
        amount: taka(between(80, 250)),
        description: "চা-নাস্তা",
        date: dayKey(noon),
        method: "cash",
      });

    // A few mistakes and returns, like a real month.
    const earlier = sold.filter((s) => s.at < start - 2 * HOUR);
    const evening = start + 18 * HOUR;
    if (
      (ago === 14 || ago === 6) &&
      earlier.length > 0 &&
      evening < RealDate.now()
    ) {
      const s = pick(
        earlier.filter((x) => !voidedIds.has(x.id) && !returnedIds.has(x.id)),
      );
      if (s) {
        voidedIds.add(s.id);
        await run(owner, evening, "sale.void", {
          saleId: s.id,
          reason: "ভুল পণ্য দেওয়া হয়েছিল",
        });
      }
    }
    if (
      (ago === 18 || ago === 11 || ago === 3) &&
      earlier.length > 0 &&
      evening < RealDate.now()
    ) {
      const s = pick(
        earlier.filter((x) => !voidedIds.has(x.id) && !returnedIds.has(x.id)),
      );
      if (s) {
        returnedIds.add(s.id);
        const line = s.lines[0];
        await run(manager, evening + 300_000, "saleReturn.create", {
          id: newId(),
          saleId: s.id,
          lines: [{ itemIndex: 0, ...line, qty: Math.min(line.qty, 1000) }],
          settlement: "cash",
          restock: true,
        });
      }
    }
    if (ago === 8) {
      const eggs = items.find((i) => i.spec.name.startsWith("Eggs"));
      if (eggs)
        await run(manager, start + 15 * HOUR, "stock.adjust", {
          productId: eggs.id,
          movementId: newId(),
          type: "damage",
          qtyDelta: -2000,
          note: "ডিম ভেঙে গেছে",
        });
    }
    if ((ago === 20 || ago === 10) && noon < RealDate.now()) {
      const owed = (await local.suppliers.toArray()).filter(
        (s) => s.balance > 0,
      );
      if (owed.length > 0) {
        const s = pick(owed);
        await run(owner, noon + 1_200_000, "payment.pay", {
          id: newId(),
          partyId: s.id,
          amount: Math.min(
            s.balance,
            Math.max(100, Math.round(s.balance / 2 / 100) * 100),
          ),
          method: "bank",
        });
      }
    }

    await sync();
  }

  // --- a monthly stock count, so a few items are low or out (good for testing alerts) ---
  const countTime = RealDate.now() - 30 * 60_000;
  for (const item of items) {
    const product = await stockOf(item.id);
    const target = milli(item.spec.endStock);
    const delta = target - product.stock;
    if (delta === 0) continue;
    // Small differences only for most items; the "low/out" showcase items are set exactly.
    const showcase = item.spec.endStock <= item.spec.low;
    if (showcase) {
      await run(owner, countTime, "stock.adjust", {
        productId: item.id,
        movementId: newId(),
        type: "adjustment",
        qtyDelta: delta,
        note: "মাসিক স্টক গণনা",
      });
    }
  }
  await sync();

  const summary = {
    sales: await local.sales.count(),
    voided: await local.sales.where("status").equals("voided").count(),
    products: await local.products.count(),
    customers: await local.customers.count(),
    suppliers: await local.suppliers.count(),
    purchases: await local.purchases.count(),
    expenses: await local.expenses.count(),
    returns: await local.returns.count(),
    payments: await local.payments.count(),
  };
  console.log("\nDemo shop ready:", JSON.stringify(summary));
  console.log(`\nSign in as owner:   ${OWNER.username} / ${OWNER.password}`);
  for (const p of STAFF)
    console.log(`Sign in as ${p.role}: ${p.username} / ${p.password}`);
}

async function wipeStore(storeId: string) {
  const db = await getDb();
  const users = await db.collection("user").find({ storeId }).toArray();
  const ids = users.map((u) => String(u._id));
  const byUserId = {
    userId: { $in: [...ids, ...users.map((u) => u._id)] },
  } as never;
  await db.collection("account").deleteMany(byUserId);
  await db.collection("session").deleteMany(byUserId);
  await db.collection("user").deleteMany({ storeId });
  for (const name of [
    "categories",
    "settings",
    "products",
    "stockMovements",
    "customers",
    "sales",
    "ledgerEntries",
    "suppliers",
    "purchases",
    "payments",
    "expenses",
    "returns",
    "auditLogs",
    "appliedOps",
    "devices",
  ])
    await db.collection(name).deleteMany({ storeId });
  await db.collection("stores").deleteOne({ _id: storeId } as never);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
