import { describe, expect, it } from "vitest";
import { derivedSearchFields } from "@/lib/search-fields";
import { parseListParams, referenceList } from "../spec";

type Doc = Record<string, unknown>;
const ids = (docs: Doc[]) => docs.map((d) => d.id);

const product = (id: string, f: Doc): Doc => ({
  id,
  name: "",
  nameBn: "",
  sku: "",
  barcode: "",
  categoryId: null,
  isActive: true,
  stock: 10_000,
  lowStockThreshold: 0,
  sellingPrice: 1000,
  createdAt: "2026-10-01T00:00:00.000Z",
  deletedAt: null,
  ...f,
});
const withFields = (c: "products" | "customers" | "sales", d: Doc): Doc => ({
  ...d,
  ...derivedSearchFields(c, d),
});

describe("products", () => {
  const docs = [
    withFields(
      "products",
      product("p1", {
        name: "Miniket Rice",
        nameBn: "মিনিকেট চাল",
        sku: "A0001",
        barcode: "111",
        categoryId: "grain",
        stock: 50_000,
        sellingPrice: 7500,
        createdAt: "2026-10-01T00:00:00.000Z",
      }),
    ),
    withFields(
      "products",
      product("p2", {
        name: "Nazirshail Rice",
        sku: "A0002",
        categoryId: "grain",
        stock: 0,
        sellingPrice: 8500,
        createdAt: "2026-10-03T00:00:00.000Z",
      }),
    ),
    withFields(
      "products",
      product("p3", {
        name: "Salt",
        sku: "A0003",
        stock: 4_000,
        lowStockThreshold: 5_000,
        sellingPrice: 4200,
        createdAt: "2026-10-02T00:00:00.000Z",
      }),
    ),
    withFields(
      "products",
      product("p4", { name: "Old Tea", isActive: false, sku: "A0004" }),
    ),
    withFields(
      "products",
      product("p5", { name: "Gone", deletedAt: "2026-10-01T00:00:00.000Z" }),
    ),
  ];
  const list = (input: Doc) =>
    ids(referenceList("products", docs, parseListParams("products", input)));

  it("lists active products A-Z by default and never shows deleted ones", () => {
    // Miniket Rice, Nazirshail Rice, Salt: A-Z by name.
    expect(list({})).toEqual(["p1", "p2", "p3"]);
    expect(list({ active: "all" })).toContain("p4");
    expect(list({ active: "all" })).not.toContain("p5");
    expect(list({ active: "inactive" })).toEqual(["p4"]);
  });

  it("searches every typed word as a prefix, in English, Bangla, SKU and Bangla digits", () => {
    expect(list({ q: "rice" })).toEqual(["p1", "p2"]);
    expect(list({ q: "rice miniket" })).toEqual(["p1"]);
    expect(list({ q: "চাল" })).toEqual(["p1"]);
    expect(list({ q: "mini" })).toEqual(["p1"]);
    expect(list({ q: "a000২" })).toEqual(["p2"]);
    expect(list({ q: "nothing" })).toEqual([]);
  });

  it("an exact barcode or SKU finds the product and puts it first", () => {
    expect(list({ q: "111" })).toEqual(["p1"]);
    expect(list({ q: "A0003" })).toEqual(["p3"]);
  });

  it("filters by category (or none) and by stock level", () => {
    expect(list({ categoryId: "grain" })).toEqual(["p1", "p2"]);
    expect(list({ categoryId: "none" })).toEqual(["p3"]);
    expect(list({ stock: "out" })).toEqual(["p2"]);
    expect(list({ stock: "low" })).toEqual(["p2", "p3"]); // low means needing attention: running low or out
  });

  it("sorts by name, stock, price and newest, in either direction", () => {
    expect(list({ sort: "stock" })).toEqual(["p2", "p3", "p1"]);
    expect(list({ sort: "stock", dir: "desc" })).toEqual(["p1", "p3", "p2"]);
    expect(list({ sort: "price" })).toEqual(["p2", "p1", "p3"]);
    expect(list({ sort: "newest" })).toEqual(["p2", "p3", "p1"]);
    expect(list({ sort: "name", dir: "desc" })).toEqual(["p3", "p2", "p1"]);
  });
});

describe("customers and suppliers", () => {
  const docs = [
    withFields("customers", {
      id: "c1",
      name: "রহিম",
      phone: "01711000001",
      balance: 5000,
      createdAt: "2026-10-01T00:00:00.000Z",
    }),
    withFields("customers", {
      id: "c2",
      name: "করিম",
      phone: "",
      balance: -300,
      createdAt: "2026-10-02T00:00:00.000Z",
    }),
    withFields("customers", {
      id: "c3",
      name: "সালমা",
      phone: "01811000002",
      balance: 0,
      createdAt: "2026-10-03T00:00:00.000Z",
    }),
  ];
  const list = (input: Doc) =>
    ids(referenceList("customers", docs, parseListParams("customers", input)));

  it("finds people by name or phone and filters those who owe or are in advance", () => {
    expect(list({ q: "০১৭১১" })).toEqual(["c1"]);
    expect(list({ q: "করিম" })).toEqual(["c2"]);
    expect(list({ balance: "owes" })).toEqual(["c1"]);
    expect(list({ balance: "advance" })).toEqual(["c2"]);
  });

  it("sorts by balance (largest due first) and newest", () => {
    expect(list({ sort: "balance" })).toEqual(["c1", "c3", "c2"]);
    expect(list({ sort: "newest" })).toEqual(["c3", "c2", "c1"]);
  });
});

describe("sales", () => {
  const sale = (id: string, f: Doc) =>
    withFields("sales", {
      id,
      invoiceNo: "A-2610-0001",
      customerId: null,
      customerName: "",
      customerPhone: "",
      status: "active",
      paymentMethod: "cash",
      total: 1000,
      due: 0,
      createdAt: "2026-10-02T06:00:00.000Z",
      deletedAt: null,
      ...f,
    });
  const docs = [
    sale("s1", {
      invoiceNo: "A-2610-0042",
      customerId: "c1",
      customerName: "রহিম উদ্দিন",
      customerPhone: "01711000001",
      total: 25_000,
      due: 10_000,
      paymentMethod: "bkash",
      createdAt: "2026-10-02T06:00:00.000Z",
    }),
    sale("s2", {
      invoiceNo: "A-2610-0043",
      total: 5_000,
      createdAt: "2026-10-03T06:00:00.000Z",
    }),
    sale("s3", {
      invoiceNo: "B-2610-0042",
      status: "voided",
      total: 9_000,
      createdAt: "2026-10-01T06:00:00.000Z",
    }),
    // 20:00 UTC on the 3rd is already the 4th in Dhaka.
    sale("s4", {
      invoiceNo: "A-2610-0044",
      total: 7_000,
      createdAt: "2026-10-03T20:00:00.000Z",
    }),
  ];
  const list = (input: Doc) =>
    ids(referenceList("sales", docs, parseListParams("sales", input)));

  it("is found by invoice number: whole, a part, or without the zeros", () => {
    expect(list({ q: "A-2610-0042" })).toEqual(["s1"]);
    expect(list({ q: "0043" })).toEqual(["s2"]);
    expect(list({ q: "42" })).toEqual(["s1", "s3"]);
    expect(list({ q: "২৬১০" })).toEqual(["s4", "s2", "s1", "s3"]);
  });

  it("is found by the buyer's name or phone", () => {
    expect(list({ q: "রহিম" })).toEqual(["s1"]);
    expect(list({ q: "উদ্দিন রহিম" })).toEqual(["s1"]);
    expect(list({ q: "01711" })).toEqual(["s1"]);
  });

  it("filters by store day (Dhaka), status, payment method and due", () => {
    expect(list({ from: "2026-10-04", to: "2026-10-04" })).toEqual(["s4"]);
    expect(list({ from: "2026-10-03", to: "2026-10-03" })).toEqual(["s2"]);
    expect(list({ status: "voided" })).toEqual(["s3"]);
    expect(list({ status: "active", method: "bkash" })).toEqual(["s1"]);
    expect(list({ dueOnly: true })).toEqual(["s1"]);
    expect(list({ customerId: "c1" })).toEqual(["s1"]);
  });

  it("sorts newest or oldest first, by total, or by what is still due", () => {
    expect(list({})).toEqual(["s4", "s2", "s1", "s3"]);
    expect(list({ sort: "oldest" })).toEqual(["s3", "s1", "s2", "s4"]);
    expect(list({ sort: "total" })).toEqual(["s1", "s3", "s4", "s2"]);
    expect(list({ sort: "due" })[0]).toBe("s1");
  });

  it("breaks ties by id, so every page and every device agrees", () => {
    const same = [
      sale("b", { total: 100 }),
      sale("a", { total: 100 }),
      sale("c", { total: 100 }),
    ];
    expect(
      ids(
        referenceList(
          "sales",
          same,
          parseListParams("sales", { sort: "total" }),
        ),
      ),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("other lists", () => {
  it("expenses default to active ones, by date, newest first", () => {
    const docs = [
      {
        id: "e1",
        date: "2026-10-01",
        createdAt: "2026-10-01T05:00:00.000Z",
        category: "rent",
        method: "cash",
        status: "active",
        amount: 5000,
      },
      {
        id: "e2",
        date: "2026-10-03",
        createdAt: "2026-10-03T05:00:00.000Z",
        category: "food",
        method: "bkash",
        status: "active",
        amount: 200,
      },
      {
        id: "e3",
        date: "2026-10-02",
        createdAt: "2026-10-02T05:00:00.000Z",
        category: "food",
        method: "cash",
        status: "voided",
        amount: 900,
      },
    ];
    const list = (input: Doc) =>
      ids(referenceList("expenses", docs, parseListParams("expenses", input)));
    expect(list({})).toEqual(["e2", "e1"]);
    expect(list({ status: "all" })).toEqual(["e2", "e3", "e1"]);
    expect(list({ category: "food", status: "all" })).toEqual(["e2", "e3"]);
    expect(list({ sort: "amount" })).toEqual(["e1", "e2"]);
    expect(list({ from: "2026-10-02" })).toEqual(["e2"]);
  });

  it("payments filter by who paid, and movements by product and type", () => {
    const pay = [
      {
        id: "a",
        partyType: "customer",
        partyId: "c1",
        amount: 100,
        createdAt: "2026-10-02T05:00:00.000Z",
      },
      {
        id: "b",
        partyType: "supplier",
        partyId: "s1",
        amount: 900,
        createdAt: "2026-10-03T05:00:00.000Z",
      },
    ];
    expect(
      ids(
        referenceList(
          "payments",
          pay,
          parseListParams("payments", { type: "supplier" }),
        ),
      ),
    ).toEqual(["b"]);
    expect(
      ids(
        referenceList(
          "payments",
          pay,
          parseListParams("payments", { sort: "amount" }),
        ),
      ),
    ).toEqual(["b", "a"]);
    const moves = [
      {
        id: "m1",
        productId: "p1",
        type: "sale",
        createdAt: "2026-10-02T05:00:00.000Z",
      },
      {
        id: "m2",
        productId: "p1",
        type: "purchase",
        createdAt: "2026-10-03T05:00:00.000Z",
      },
      {
        id: "m3",
        productId: "p2",
        type: "sale",
        createdAt: "2026-10-04T05:00:00.000Z",
      },
    ];
    expect(
      ids(
        referenceList(
          "stockMovements",
          moves,
          parseListParams("stockMovements", { productId: "p1", type: "sale" }),
        ),
      ),
    ).toEqual(["m1"]);
  });

  it("refuses nonsense params", () => {
    expect(() => parseListParams("sales", { sort: "colour" })).toThrow();
    expect(() => parseListParams("sales", { from: "yesterday" })).toThrow();
    expect(() => parseListParams("products", { stock: "plenty" })).toThrow();
  });
});
