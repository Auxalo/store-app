import { parseListParams } from "@/data/spec";
import { getDb } from "@/db/server/mongo";
import { derivedSearchFields } from "@/lib/search-fields";
import { dayKey } from "@/reports/compute";
import {
  listResource,
  stockSummary,
  totalsOf,
  type Viewer,
} from "@/server/data/service";
import { serverSummary } from "@/server/reports";
import { ensureSyncIndexes } from "@/server/sync/collections";

/**
 * Fills a store with a big shop (50,000 products, 200,000 sales over 90 days) in a scratch
 * database and times the questions the online screens ask, as the server answers them.
 *
 *   MONGODB_DB=store_app_load node scripts/loadtest.mjs
 *
 * It refuses to run against a database whose name does not contain "load", and it empties that
 * database first. Target: the 95th percentile of every list and total under 300 ms.
 */

const PRODUCTS = Number(process.env.LOAD_PRODUCTS ?? 50_000);
const SALES = Number(process.env.LOAD_SALES ?? 200_000);
const CUSTOMERS = 3_000;
const DAYS = 90;
const STORE = "load-store";
const P95_TARGET_MS = 300;
const DAY = 86_400_000;
const RUNS = 25;

const dbName = process.env.MONGODB_DB ?? "";
if (!dbName.includes("load")) {
  console.error(
    `Refusing to run: MONGODB_DB is "${dbName}", it must contain "load" (this empties the database).`,
  );
  process.exit(1);
}

let seed = 42;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const NAMES = [
  "Sugar",
  "Rice",
  "Milk",
  "Soap",
  "Tea",
  "Salt",
  "Oil",
  "Biscuit",
  "Noodles",
  "Juice",
];
const BN = [
  "চিনি",
  "চাল",
  "দুধ",
  "সাবান",
  "চা",
  "লবণ",
  "তেল",
  "বিস্কুট",
  "নুডলস",
  "জুস",
];
const METHODS = ["cash", "cash", "cash", "bkash", "nagad", "card"] as const;

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

async function main() {
  const db = await getDb();
  for (const c of [
    "products",
    "customers",
    "sales",
    "stores",
    "returns",
    "expenses",
    "purchases",
  ])
    await db.collection(c).deleteMany({});
  await ensureSyncIndexes(db);

  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();

  // --- products ---
  console.log(`Creating ${PRODUCTS} products...`);
  for (let from = 0; from < PRODUCTS; from += 5_000) {
    const batch = [];
    for (let i = from; i < Math.min(PRODUCTS, from + 5_000); i++) {
      const k = i % NAMES.length;
      const doc: Record<string, unknown> = {
        _id: `p${i}`,
        id: `p${i}`,
        storeId: STORE,
        name: `${NAMES[k]} ${i}`,
        nameBn: `${BN[k]} ${i}`,
        sku: String(i).padStart(5, "0"),
        barcode: String(8_900_000_000_000 + i),
        categoryId: `c${i % 40}`,
        unit: "pcs",
        purchasePrice: int(2_000, 20_000),
        sellingPrice: int(2_500, 25_000),
        stock: int(0, 200) * 1000,
        lowStockThreshold: 10_000,
        isActive: i % 50 !== 0,
        createdAt: iso(now - int(0, DAYS) * DAY),
        updatedAt: iso(now),
        version: 1,
        deletedAt: null,
        syncSeq: i + 1,
      };
      batch.push({ ...doc, ...derivedSearchFields("products", doc) });
    }
    await db.collection("products").insertMany(batch);
  }

  // --- customers ---
  const customers: Array<{ id: string; name: string; phone: string }> = [];
  for (let i = 0; i < CUSTOMERS; i++)
    customers.push({
      id: `u${i}`,
      name: `Customer ${i}`,
      phone: `0171${String(1_000_000 + i)}`,
    });
  await db.collection("customers").insertMany(
    customers.map((c, i) => {
      const doc: Record<string, unknown> = {
        _id: c.id,
        ...c,
        storeId: STORE,
        address: "",
        balance: i % 5 === 0 ? int(100, 90_000) : 0,
        isActive: true,
        createdAt: iso(now),
        updatedAt: iso(now),
        version: 1,
        deletedAt: null,
        syncSeq: i + 1,
      };
      return { ...doc, ...derivedSearchFields("customers", doc) };
    }),
  );

  // --- sales ---
  console.log(`Creating ${SALES} sales over ${DAYS} days...`);
  for (let from = 0; from < SALES; from += 5_000) {
    const batch = [];
    for (let i = from; i < Math.min(SALES, from + 5_000); i++) {
      const created = now - Math.floor((i / SALES) * DAYS * DAY);
      const buyer = rand() < 0.3 ? customers[int(0, CUSTOMERS - 1)] : null;
      const lines = int(1, 4);
      const items = [];
      let total = 0;
      for (let l = 0; l < lines; l++) {
        const price = int(2_500, 25_000);
        const qty = int(1, 5) * 1000;
        const lineTotal = Math.round((price * qty) / 1000);
        total += lineTotal;
        items.push({
          id: `s${i}:i${l}`,
          saleId: `s${i}`,
          productId: `p${int(0, PRODUCTS - 1)}`,
          productName: "Item",
          productNameBn: "",
          unit: "pcs",
          qty,
          listPrice: price,
          unitPrice: price,
          unitCost: Math.round(price * 0.8),
          discount: 0,
          lineTotal,
          createdAt: iso(created),
        });
      }
      const due = buyer && rand() < 0.2 ? Math.round(total * 0.4) : 0;
      const doc: Record<string, unknown> = {
        _id: `s${i}`,
        id: `s${i}`,
        storeId: STORE,
        invoiceNo: `2610-${String(i + 1).padStart(6, "0")}`,
        customerId: buyer?.id ?? null,
        customerName: buyer?.name ?? "",
        customerPhone: buyer?.phone ?? "",
        subtotal: total,
        discount: 0,
        total,
        paid: total - due,
        due,
        paymentMethod: METHODS[int(0, METHODS.length - 1)],
        notes: "",
        status: i % 97 === 0 ? "voided" : "active",
        itemCount: lines,
        items,
        createdAt: iso(created),
        updatedAt: iso(created),
        createdBy: "u",
        deviceId: "d",
        version: 1,
        deletedAt: null,
        syncSeq: PRODUCTS + i + 1,
      };
      batch.push({ ...doc, ...derivedSearchFields("sales", doc) });
    }
    await db.collection("sales").insertMany(batch);
  }

  const viewer: Viewer = {
    storeId: STORE,
    canSeeCost: true,
    timeZone: "Asia/Dhaka",
  };
  const today = dayKey(now, "Asia/Dhaka");
  const daysAgo = (n: number) => dayKey(now - n * DAY, "Asia/Dhaka");

  type Job = { label: string; run: () => Promise<unknown> };
  const list =
    (
      resource: "products" | "sales" | "customers",
      input: Record<string, unknown>,
      cursorPages = 0,
    ) =>
    async () => {
      const params = parseListParams(resource, input as never);
      let cursor: string | null = null;
      for (let i = 0; i <= cursorPages; i++) {
        const page: { nextCursor: string | null } = await listResource(
          db,
          resource,
          params as never,
          viewer,
          { limit: 50, cursor },
        );
        cursor = page.nextCursor;
        if (!cursor) break;
      }
    };
  const totals =
    (
      resource: "products" | "sales" | "customers",
      input: Record<string, unknown>,
    ) =>
    async () =>
      totalsOf(
        db,
        resource,
        parseListParams(resource, input as never) as never,
        viewer,
      );

  const jobs: Job[] = [
    { label: "products: first page A-Z", run: list("products", {}) },
    { label: "products: page 40 deep (A-Z)", run: list("products", {}, 40) },
    {
      label: "products: search a word (sugar)",
      run: list("products", { q: "sugar" }),
    },
    {
      label: "products: search a word + number (rice 4321)",
      run: list("products", { q: "rice 4321" }),
    },
    {
      label: "products: search Bangla (চিনি)",
      run: list("products", { q: "চিনি" }),
    },
    {
      label: "products: scan a barcode",
      run: list("products", { q: "8900000012345" }),
    },
    {
      label: "products: low stock, fewest first",
      run: list("products", { stock: "low", sort: "stock" }),
    },
    {
      label: "products: one category",
      run: list("products", { categoryId: "c7" }),
    },
    { label: "products: totals (all)", run: totals("products", {}) },
    { label: "sales: newest first", run: list("sales", {}) },
    {
      label: "sales: search invoice number",
      run: list("sales", { q: "151515" }),
    },
    {
      label: "sales: search buyer name",
      run: list("sales", { q: "customer 2024" }),
    },
    {
      label: "sales: search buyer phone",
      run: list("sales", { q: "01711002024" }),
    },
    { label: "sales: today", run: list("sales", { from: today, to: today }) },
    {
      label: "sales: last 7 days, biggest first",
      run: list("sales", { from: daysAgo(6), to: today, sort: "total" }),
    },
    { label: "sales: owing only", run: list("sales", { dueOnly: true }) },
    {
      label: "sales: totals (today)",
      run: totals("sales", { from: today, to: today }),
    },
    {
      label: "sales: totals (30 days)",
      run: totals("sales", { from: daysAgo(29), to: today }),
    },
    {
      label: "customers: owing, biggest first",
      run: list("customers", { balance: "owes", sort: "balance" }),
    },
    {
      label: "customers: search a name",
      run: list("customers", { q: "customer 12" }),
    },
    {
      label: "customers: totals (owing)",
      run: totals("customers", { balance: "owes" }),
    },
    { label: "report: stock value", run: () => stockSummary(db, viewer) },
    {
      label: "report: today",
      run: () =>
        serverSummary(db, STORE, { from: today, to: today }, "Asia/Dhaka"),
    },
    {
      label: "report: 7 days",
      run: () =>
        serverSummary(db, STORE, { from: daysAgo(6), to: today }, "Asia/Dhaka"),
    },
    {
      label: "report: 30 days",
      run: () =>
        serverSummary(
          db,
          STORE,
          { from: daysAgo(29), to: today },
          "Asia/Dhaka",
        ),
    },
  ];

  console.log(
    `\n${"question".padEnd(52)} p50     p95     max   (ms, ${RUNS} runs)`,
  );
  let slow = 0;
  for (const job of jobs) {
    await job.run(); // warm up
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      await job.run();
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const p95 = percentile(times, 0.95);
    if (p95 > P95_TARGET_MS) slow++;
    console.log(
      `${job.label.padEnd(52)} ${percentile(times, 0.5).toFixed(0).padStart(5)} ${p95.toFixed(0).padStart(7)} ${times[times.length - 1].toFixed(0).padStart(7)} ${p95 > P95_TARGET_MS ? "  <-- over target" : ""}`,
    );
  }
  console.log(
    slow === 0
      ? `\nAll ${jobs.length} questions are under ${P95_TARGET_MS} ms at the 95th percentile.`
      : `\n${slow} of ${jobs.length} questions are over ${P95_TARGET_MS} ms at the 95th percentile.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
