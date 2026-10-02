import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ListParamsInput,
  matches,
  parseListParams,
  type Resource,
  referenceList,
  referenceTotals,
} from "@/data/spec";
import { derivedSearchFields } from "@/lib/search-fields";
import { startMongo, type TestMongo } from "../../../../tests/helpers/mongo";
import { toWire } from "../../commands/master-data";
import {
  BadCursorError,
  COLLECTION,
  getRecord,
  listResource,
  lookupProduct,
  type Page,
  stockSummary,
  totalsOf,
  type Viewer,
} from "../service";

/**
 * The server's lists must give the same records in the same order as the plain rules in
 * src/data/spec.ts, page by page. The data is made up to hit the awkward cases: Bangla and English
 * names, ties, deleted and inactive records, dates around midnight in Dhaka, another shop's data.
 */
let mongo: TestMongo;
let storeId: string;
let otherStore: string;

const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const rand = rng(77);
const pick = <T>(items: readonly T[]): T =>
  items[Math.floor(rand() * items.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const NAMES = [
  "Rice",
  "Salt",
  "Sugar",
  "Milk",
  "Tea",
  "Oil",
  "Soap",
  "Biscuit",
  "Egg",
  "Dal",
];
const BN = ["চাল", "লবণ", "চিনি", "দুধ", "চা", "তেল", "সাবান", "বিস্কুট", "ডিম", "ডাল"];
const PEOPLE = [
  "রহিম উদ্দিন",
  "করিম মিয়া",
  "সালমা খাতুন",
  "Abdul Karim",
  "Nasrin Akter",
  "Hasan Mahmud",
];
const METHODS = ["cash", "bkash", "nagad", "card"] as const;
const stamp = (day: number, hour: number) =>
  new Date(Date.UTC(2026, 8, day, hour, int(0, 59), int(0, 59))).toISOString();

type Doc = Record<string, unknown>;
const docs: Record<string, Doc[]> = {};

const viewer = (canSeeCost = true): Viewer => ({ storeId, canSeeCost });

async function collect(
  resource: Resource,
  input: ListParamsInput<Resource>,
  limit = 7,
): Promise<string[]> {
  const params = parseListParams(resource, input);
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 200; guard++) {
    const page: Page = await listResource(
      mongo.db,
      resource,
      params,
      viewer(),
      { limit, cursor },
    );
    ids.push(...page.items.map((d) => d.id));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return ids;
}

const reference = (resource: Resource, input: ListParamsInput<Resource>) =>
  referenceList(
    resource,
    docs[resource] ?? [],
    parseListParams(resource, input),
  ).map((d) => String(d.id));

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore();
  otherStore = await mongo.seedStore("Other");

  const put = async (resource: Resource, store: string, doc: Doc) => {
    const stored = {
      _id: doc.id,
      storeId: store,
      deletedAt: null,
      version: 1,
      fieldVersions: {},
      syncSeq: 1,
      ...doc,
    };
    delete (stored as Doc).id;
    const collection = [
      "products",
      "customers",
      "suppliers",
      "sales",
      "purchases",
    ].includes(resource)
      ? (resource as "products")
      : null;
    if (collection)
      Object.assign(stored, derivedSearchFields(collection, stored));
    await mongo.db.collection(COLLECTION[resource]).insertOne(stored as never);
    if (store === storeId) {
      docs[resource] ??= [];
      docs[resource].push(toWire(stored as never) as unknown as Doc);
    }
  };

  for (let i = 0; i < 60; i++) {
    const k = i % NAMES.length;
    await put("products", storeId, {
      id: `p${String(i).padStart(3, "0")}`,
      name: `${NAMES[k]} ${["Fine", "Coarse", "Premium", "1kg", "500g", ""][i % 6]}`.trim(),
      nameBn: i % 2 ? BN[k] : "",
      sku: `A${String(i + 1).padStart(4, "0")}`,
      barcode: i % 3 === 0 ? `890${1000 + i}` : "",
      categoryId: i % 4 === 0 ? null : `cat${i % 3}`,
      unit: "pcs",
      purchasePrice: int(10, 90) * 100,
      sellingPrice: pick([2000, 4500, 4500, 7000, 9900]),
      stock: pick([0, 0, 1000, 5000, 12_000, 50_000]),
      lowStockThreshold: pick([0, 0, 5000, 10_000]),
      isActive: i % 11 !== 0,
      createdAt: stamp(1 + (i % 28), 5),
      updatedAt: stamp(1 + (i % 28), 5),
    });
  }
  await put("products", storeId, {
    id: "p-deleted",
    name: "Deleted Rice",
    sku: "DEL",
    barcode: "",
    categoryId: null,
    isActive: true,
    stock: 0,
    lowStockThreshold: 0,
    sellingPrice: 100,
    purchasePrice: 50,
    createdAt: stamp(2, 5),
    deletedAt: stamp(3, 5),
  });
  await put("products", otherStore, {
    id: "p-other",
    name: "Other Shop Rice",
    sku: "O1",
    barcode: "",
    categoryId: null,
    isActive: true,
    stock: 1,
    lowStockThreshold: 0,
    sellingPrice: 100,
    purchasePrice: 50,
    createdAt: stamp(2, 5),
  });

  for (let i = 0; i < 40; i++) {
    const person = PEOPLE[i % PEOPLE.length];
    for (const kind of ["customers", "suppliers"] as const)
      await put(kind, storeId, {
        id: `${kind[0]}${String(i).padStart(3, "0")}`,
        name: i < PEOPLE.length ? person : `${person} ${i}`,
        phone: i % 4 === 0 ? "" : `0171100${String(1000 + i)}`,
        contactPerson: kind === "suppliers" && i % 2 ? "Abdul" : "",
        balance: pick([0, 0, 5000, 125_000, -3000, 60_000]),
        createdAt: stamp(1 + (i % 28), 6),
        updatedAt: stamp(1 + (i % 28), 6),
      });
  }

  for (let i = 0; i < 120; i++) {
    const customer = i % 3 === 0 ? null : `c${String(i % 40).padStart(3, "0")}`;
    const person = customer
      ? docs.customers.find((c) => c.id === customer)
      : undefined;
    const total = int(1, 400) * 100;
    const due = i % 5 === 0 ? int(1, total / 100) * 100 : 0;
    await put("sales", storeId, {
      id: `s${String(i).padStart(4, "0")}`,
      invoiceNo: `${["A", "B"][i % 2]}-2609-${String(i + 1).padStart(4, "0")}`,
      customerId: customer,
      customerName: (person?.name as string) ?? "",
      customerPhone: (person?.phone as string) ?? "",
      status: i % 13 === 0 ? "voided" : "active",
      paymentMethod: pick(METHODS),
      subtotal: total,
      discount: 0,
      total: i % 7 === 0 ? 5000 : total, // ties on purpose
      paid: total - due,
      due,
      itemCount: 1,
      items: [
        {
          id: `s${i}:i0`,
          productId: "p000",
          unitCost: 4000,
          unitPrice: 5000,
          qty: 1000,
          lineTotal: 5000,
        },
      ],
      createdAt: stamp(1 + (i % 28), pick([0, 5, 12, 17, 18, 19, 23])),
    });
  }
  for (let i = 0; i < 30; i++)
    await put("purchases", storeId, {
      id: `u${String(i).padStart(3, "0")}`,
      purchaseNo: `P-A-2609-${String(i + 1).padStart(4, "0")}`,
      invoiceRef: i % 2 ? `INV-${100 + i}` : "",
      supplierId: `s${String(i % 40).padStart(3, "0")}`,
      supplierName: PEOPLE[i % PEOPLE.length],
      date: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}`,
      total: int(1, 900) * 100,
      due: i % 3 === 0 ? int(1, 50) * 100 : 0,
      itemCount: 1,
      items: [],
      createdAt: stamp(1 + (i % 28), 8),
    });
  for (let i = 0; i < 40; i++)
    await put("expenses", storeId, {
      id: `e${String(i).padStart(3, "0")}`,
      date: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}`,
      category: pick(["rent", "food", "transport", "other"]),
      method: pick(METHODS),
      status: i % 9 === 0 ? "voided" : "active",
      amount: int(1, 90) * 100,
      createdAt: stamp(1 + (i % 28), 9),
    });
  for (let i = 0; i < 40; i++)
    await put("payments", storeId, {
      id: `y${String(i).padStart(3, "0")}`,
      partyType: i % 3 ? "customer" : "supplier",
      partyId: `c${String(i % 40).padStart(3, "0")}`,
      amount: int(1, 50) * 100,
      createdAt: stamp(1 + (i % 28), 10),
    });
  for (let i = 0; i < 15; i++)
    await put("returns", storeId, {
      id: `r${String(i).padStart(3, "0")}`,
      kind: i % 2 ? "sale" : "purchase",
      total: int(1, 30) * 100,
      createdAt: stamp(1 + (i % 28), 11),
    });
  for (let i = 0; i < 50; i++)
    await put("stockMovements", storeId, {
      id: `m${String(i).padStart(3, "0")}`,
      productId: `p${String(i % 5).padStart(3, "0")}`,
      type: pick(["sale", "purchase", "adjustment"]),
      qtyDelta: int(-5, 5) * 1000,
      createdAt: stamp(1 + (i % 28), 13),
    });
}, 180_000);

afterAll(async () => {
  await mongo?.stop();
});

const CASES: Array<[Resource, ListParamsInput<Resource>]> = [
  ["products", {}],
  ["products", { q: "rice" }],
  ["products", { q: "rice fine" }],
  ["products", { q: "চাল" }],
  ["products", { q: "a00০5" }],
  ["products", { q: "890" }],
  ["products", { q: "8901003" }], // an exact barcode
  ["products", { q: "A0004" }], // an exact SKU
  ["products", { active: "all" }],
  ["products", { active: "inactive" }],
  ["products", { categoryId: "cat1" }],
  ["products", { categoryId: "none", active: "all" }],
  ["products", { stock: "out" }],
  ["products", { stock: "low" }],
  ["products", { stock: "low", categoryId: "cat2", q: "salt" }],
  ["products", { sort: "stock" }],
  ["products", { sort: "stock", dir: "desc" }],
  ["products", { sort: "price" }],
  ["products", { sort: "newest" }],
  ["products", { sort: "name", dir: "desc" }],
  ["customers", {}],
  ["customers", { q: "রহিম" }],
  ["customers", { q: "01711" }],
  ["customers", { q: "karim" }],
  ["customers", { balance: "owes", sort: "balance" }],
  ["customers", { balance: "advance" }],
  ["customers", { sort: "newest" }],
  ["suppliers", {}],
  ["suppliers", { q: "abdul" }],
  ["suppliers", { balance: "owes", sort: "balance", dir: "asc" }],
  ["sales", {}],
  ["sales", { q: "A-2609-0042" }],
  ["sales", { q: "42" }],
  ["sales", { q: "0007" }],
  ["sales", { q: "২৬০৯" }],
  ["sales", { q: "রহিম" }],
  ["sales", { q: "01711" }],
  ["sales", { from: "2026-09-10", to: "2026-09-12" }],
  ["sales", { from: "2026-09-15" }],
  ["sales", { to: "2026-09-03" }],
  ["sales", { status: "voided" }],
  ["sales", { status: "active", method: "bkash" }],
  ["sales", { dueOnly: true }],
  ["sales", { dueOnly: true, sort: "due" }],
  ["sales", { customerId: "c001" }],
  ["sales", { sort: "oldest" }],
  ["sales", { sort: "total" }],
  ["sales", { sort: "total", dir: "asc", q: "A" }],
  ["purchases", {}],
  ["purchases", { q: "inv" }],
  ["purchases", { q: "7" }],
  ["purchases", { q: "করিম" }],
  ["purchases", { from: "2026-09-05", to: "2026-09-10" }],
  ["purchases", { dueOnly: true, sort: "due" }],
  ["purchases", { supplierId: "s003" }],
  ["purchases", { sort: "oldest" }],
  ["expenses", {}],
  ["expenses", { status: "all" }],
  ["expenses", { category: "food" }],
  ["expenses", { method: "cash", status: "all", sort: "amount" }],
  ["expenses", { from: "2026-09-10", to: "2026-09-20", sort: "oldest" }],
  ["payments", {}],
  ["payments", { type: "supplier" }],
  ["payments", { type: "customer", sort: "amount" }],
  ["payments", { partyId: "c001" }],
  ["returns", {}],
  ["returns", { kind: "sale", sort: "total" }],
  ["stockMovements", {}],
  ["stockMovements", { productId: "p001" }],
  ["stockMovements", { productId: "p002", type: "sale" }],
];

describe("the server's lists match the plain rules, page by page", () => {
  for (const [resource, input] of CASES) {
    it(`${resource} ${JSON.stringify(input)}`, async () => {
      const expected = reference(resource, input);
      expect(await collect(resource, input, 7)).toEqual(expected);
      // The answer does not depend on how big the pages are.
      expect(await collect(resource, input, 50)).toEqual(expected);
    });
  }

  it("covers a meaningful spread (the cases are not all empty)", async () => {
    const sizes = await Promise.all(
      CASES.map(([r, i]) => collect(r, i, 50).then((x) => x.length)),
    );
    expect(sizes.filter((n) => n > 0).length).toBeGreaterThan(
      CASES.length * 0.85,
    );
    expect(Math.max(...sizes)).toBeGreaterThan(50); // several pages were really walked
  });
});

describe("header totals cover everything that matches, not one page", () => {
  const TOTAL_CASES: Array<[Resource, ListParamsInput<Resource>]> = [
    ["sales", {}],
    ["sales", { from: "2026-09-10", to: "2026-09-20", method: "cash" }],
    ["sales", { dueOnly: true }],
    ["purchases", {}],
    ["purchases", { dueOnly: true }],
    ["customers", {}],
    ["customers", { balance: "owes" }],
    ["suppliers", { q: "karim" }],
    ["expenses", { status: "all" }],
    ["payments", { type: "supplier" }],
    ["returns", {}],
    ["products", { stock: "low" }],
    ["stockMovements", { productId: "p001" }],
  ];
  for (const [resource, input] of TOTAL_CASES) {
    it(`${resource} ${JSON.stringify(input)}`, async () => {
      const params = parseListParams(resource, input);
      const matching = (docs[resource] ?? []).filter((d) =>
        matches(resource, d, params),
      );
      expect(await totalsOf(mongo.db, resource, params, viewer())).toEqual(
        referenceTotals(resource, matching),
      );
    });
  }
});

describe("what a person may see", () => {
  it("hides purchase prices and the cost of sold goods from people who may not see cost", async () => {
    const products = await listResource(
      mongo.db,
      "products",
      parseListParams("products", {}),
      viewer(false),
      { limit: 5 },
    );
    for (const p of products.items)
      expect(p).not.toHaveProperty("purchasePrice");
    const owner = await listResource(
      mongo.db,
      "products",
      parseListParams("products", {}),
      viewer(true),
      { limit: 5 },
    );
    for (const p of owner.items) expect(p).toHaveProperty("purchasePrice");

    const linesOf = async (canSeeCost: boolean) =>
      (
        (await getRecord(mongo.db, "sales", "s0001", viewer(canSeeCost)))
          ?.record as unknown as { items?: Doc[] } | undefined
      )?.items ?? [];
    const hidden = await linesOf(false);
    expect(hidden.length).toBeGreaterThan(0);
    for (const item of hidden) expect(item).not.toHaveProperty("unitCost");
    const shown = await linesOf(true);
    expect(shown[0]).toHaveProperty("unitCost");
    expect((await stockSummary(mongo.db, viewer(false))).costValue).toBe(0);
    expect(
      (await stockSummary(mongo.db, viewer(true))).costValue,
    ).toBeGreaterThan(0);
  });

  it("never shows another shop's records, deleted records, or internal fields", async () => {
    const all = await collect("products", { active: "all" }, 100);
    expect(all).not.toContain("p-other");
    expect(all).not.toContain("p-deleted");
    expect(
      await getRecord(mongo.db, "products", "p-other", viewer()),
    ).toBeNull();
    const page = await listResource(
      mongo.db,
      "sales",
      parseListParams("sales", {}),
      viewer(),
      { limit: 3 },
    );
    for (const sale of page.items) {
      expect(sale).not.toHaveProperty("searchWords");
      expect(sale).not.toHaveProperty("fieldVersions");
      expect(sale).not.toHaveProperty("items"); // lists leave the lines out
    }
  });

  it("a list row has no lines, but the record's own page has them (and its returns)", async () => {
    const got = await getRecord(mongo.db, "sales", "s0001", viewer());
    expect(got?.record).toMatchObject({ id: "s0001" });
    expect(got?.extra.returns).toEqual([]);
    const person = await getRecord(mongo.db, "customers", "c001", viewer());
    expect(person?.extra).toHaveProperty("ledgerEntries");
    const product = await getRecord(mongo.db, "products", "p001", viewer());
    expect(product?.extra.stockMovements.length).toBeGreaterThan(0);
  });
});

describe("paging", () => {
  it("refuses a page marker that belongs to a different search", async () => {
    const first = await listResource(
      mongo.db,
      "sales",
      parseListParams("sales", {}),
      viewer(),
      { limit: 5 },
    );
    expect(first.nextCursor).toBeTruthy();
    await expect(
      listResource(
        mongo.db,
        "sales",
        parseListParams("sales", { status: "voided" }),
        viewer(),
        { limit: 5, cursor: first.nextCursor },
      ),
    ).rejects.toBeInstanceOf(BadCursorError);
    await expect(
      listResource(mongo.db, "sales", parseListParams("sales", {}), viewer(), {
        limit: 5,
        cursor: "not-a-cursor",
      }),
    ).rejects.toBeInstanceOf(BadCursorError);
  });

  it("a record added while someone is scrolling does not repeat or skip anything already behind them", async () => {
    const params = parseListParams("sales", { sort: "newest" });
    const first = await listResource(mongo.db, "sales", params, viewer(), {
      limit: 10,
    });
    await mongo.db.collection("sales").insertOne({
      _id: "s-late" as never,
      storeId,
      deletedAt: null,
      invoiceNo: "A-2609-9999",
      status: "active",
      paymentMethod: "cash",
      total: 1,
      due: 0,
      createdAt: "2026-09-29T23:59:59.000Z",
      searchWords: ["a", "2609", "9999"],
    } as never);
    const second = await listResource(mongo.db, "sales", params, viewer(), {
      limit: 10,
      cursor: first.nextCursor,
    });
    const seen = new Set(first.items.map((d) => d.id));
    for (const item of second.items) expect(seen.has(item.id)).toBe(false);
    await mongo.db.collection("sales").deleteOne({ _id: "s-late" as never });
  });
});

describe("barcode lookup", () => {
  it("finds the one active product by barcode or SKU, and nothing for other codes or shops", async () => {
    expect((await lookupProduct(mongo.db, "8901003", viewer()))?.id).toBe(
      "p003",
    );
    expect((await lookupProduct(mongo.db, "A0004", viewer()))?.id).toBe("p003");
    expect(await lookupProduct(mongo.db, "nope", viewer())).toBeNull();
    expect(await lookupProduct(mongo.db, "O1", viewer())).toBeNull();
    expect(await lookupProduct(mongo.db, "DEL", viewer())).toBeNull();
    expect(await lookupProduct(mongo.db, "", viewer())).toBeNull();
  });
});
