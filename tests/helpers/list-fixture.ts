import type { ListParamsInput, Resource } from "@/data/spec";

/**
 * Made-up shop data and a battery of list questions, shared by every implementation of the list
 * rules (the plain reference, MongoDB on the server, IndexedDB on the device). The data is built
 * to hit the awkward cases: Bangla and English names, ties, deleted and inactive records, dates
 * around midnight in Dhaka, and another shop's records that must never show.
 */
export type Doc = Record<string, unknown>;

export interface FixtureRow {
  resource: Resource;
  /** "other" rows belong to a different shop. */
  shop: "main" | "other";
  doc: Doc;
}

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

/** The same rows every time. */
export function buildFixture(): FixtureRow[] {
  const rand = rng(77);
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(rand() * items.length)];
  const int = (lo: number, hi: number) =>
    lo + Math.floor(rand() * (hi - lo + 1));
  const stamp = (day: number, hour: number) =>
    new Date(
      Date.UTC(2026, 8, day, hour, int(0, 59), int(0, 59)),
    ).toISOString();

  const rows: FixtureRow[] = [];
  const put = (resource: Resource, shop: "main" | "other", doc: Doc) =>
    rows.push({ resource, shop, doc: { deletedAt: null, ...doc } });
  const customers: Doc[] = [];

  for (let i = 0; i < 60; i++) {
    const k = i % NAMES.length;
    put("products", "main", {
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
  put("products", "main", {
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
  put("products", "other", {
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
    for (const kind of ["customers", "suppliers"] as const) {
      const doc: Doc = {
        id: `${kind[0]}${String(i).padStart(3, "0")}`,
        name: i < PEOPLE.length ? person : `${person} ${i}`,
        phone: i % 4 === 0 ? "" : `0171100${String(1000 + i)}`,
        contactPerson: kind === "suppliers" && i % 2 ? "Abdul" : "",
        balance: pick([0, 0, 5000, 125_000, -3000, 60_000]),
        createdAt: stamp(1 + (i % 28), 6),
        updatedAt: stamp(1 + (i % 28), 6),
      };
      put(kind, "main", doc);
      if (kind === "customers") customers.push(doc);
    }
  }

  for (let i = 0; i < 120; i++) {
    const customer = i % 3 === 0 ? null : `c${String(i % 40).padStart(3, "0")}`;
    const person = customer
      ? customers.find((c) => c.id === customer)
      : undefined;
    const total = int(1, 400) * 100;
    const due = i % 5 === 0 ? int(1, total / 100) * 100 : 0;
    put("sales", "main", {
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
    put("purchases", "main", {
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
    put("expenses", "main", {
      id: `e${String(i).padStart(3, "0")}`,
      date: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}`,
      category: pick(["rent", "food", "transport", "other"]),
      method: pick(METHODS),
      status: i % 9 === 0 ? "voided" : "active",
      amount: int(1, 90) * 100,
      createdAt: stamp(1 + (i % 28), 9),
    });
  for (let i = 0; i < 40; i++)
    put("payments", "main", {
      id: `y${String(i).padStart(3, "0")}`,
      partyType: i % 3 ? "customer" : "supplier",
      partyId: `c${String(i % 40).padStart(3, "0")}`,
      amount: int(1, 50) * 100,
      createdAt: stamp(1 + (i % 28), 10),
    });
  for (let i = 0; i < 15; i++)
    put("returns", "main", {
      id: `r${String(i).padStart(3, "0")}`,
      kind: i % 2 ? "sale" : "purchase",
      total: int(1, 30) * 100,
      createdAt: stamp(1 + (i % 28), 11),
    });
  for (let i = 0; i < 50; i++)
    put("stockMovements", "main", {
      id: `m${String(i).padStart(3, "0")}`,
      productId: `p${String(i % 5).padStart(3, "0")}`,
      type: pick(["sale", "purchase", "adjustment"]),
      qtyDelta: int(-5, 5) * 1000,
      createdAt: stamp(1 + (i % 28), 13),
    });
  return rows;
}

export const CASES: Array<[Resource, ListParamsInput<Resource>]> = [
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

export const TOTAL_CASES: Array<[Resource, ListParamsInput<Resource>]> = [
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
