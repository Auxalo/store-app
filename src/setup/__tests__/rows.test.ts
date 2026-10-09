import { describe, expect, it } from "vitest";
import {
  checkRows,
  emptyExisting,
  makeUnitLookup,
  planCategories,
  rowsFromPaste,
} from "../rows";

const unitOf = makeUnitLookup({ kg: "কেজি", pcs: "পিস", packet: "প্যাকেট" });
const check = (
  kind: "products" | "customers" | "suppliers",
  rows: string[][],
  existing = emptyExisting(),
) => checkRows(kind, rows, { existing, unitOf });

describe("product rows", () => {
  // name, category, unit, purchasePrice, sellingPrice, stock, lowStock, barcode, sku
  it("reads a complete row, in Bangla digits and units too", () => {
    const [row] = check("products", [
      ["Rice", "চাল-ডাল", "কেজি", "৬৮", "৭৫.৫০", "১২৫.৫", "২০", "123", "R1"],
    ]);
    expect(row.issues).toEqual({});
    expect(row.value).toEqual({
      name: "Rice",
      category: "চাল-ডাল",
      unit: "kg",
      purchasePrice: 6800,
      sellingPrice: 7550,
      openingStock: 125_500,
      lowStockThreshold: 20_000,
      barcode: "123",
      sku: "R1",
    });
  });

  it("needs only a name and two prices; the rest is optional", () => {
    const [row] = check("products", [["Salt", "", "", "30", "36"]]);
    expect(row.value).toMatchObject({
      name: "Salt",
      unit: "pcs",
      openingStock: 0,
      sku: "",
    });
  });

  it("flags missing names and missing or zero prices, per column", () => {
    const [row] = check("products", [["", "", "", "0", ""]]);
    expect(row.issues).toEqual({
      name: "required",
      purchasePrice: "positive",
      sellingPrice: "required",
    });
    expect(row.value).toBeUndefined();
  });

  it("flags numbers that are not numbers, unknown units and too many decimals", () => {
    const [bad] = check("products", [
      ["A", "", "box of 5", "x", "10", "-3", ""],
    ]);
    expect(bad.issues).toMatchObject({
      unit: "unknownUnit",
      purchasePrice: "invalidNumber",
      stock: "invalidNumber",
    });
    const [decimals] = check("products", [["B", "", "pcs", "5", "10", "2.5"]]);
    expect(decimals.issues).toEqual({ stock: "tooManyDecimals" });
    const [ok] = check("products", [["C", "", "kg", "5", "10", "2.5"]]);
    expect(ok.issues).toEqual({});
  });

  it("catches repeats inside the list, and what the shop already has", () => {
    const existing = emptyExisting();
    existing.skus.add("OLD1");
    existing.barcodes.add("999");
    existing.productKeys.add("old milk|pcs|5000");
    const rows = check(
      "products",
      [
        ["Tea", "", "pcs", "40", "50", "", "", "111", "T1"],
        ["Tea 2", "", "pcs", "40", "50", "", "", "111", "T2"], // same barcode
        ["Tea 3", "", "pcs", "40", "50", "", "", "", "T1"], // same SKU
        ["Tea", "", "pcs", "40", "50"], // same product again
        ["x", "", "pcs", "1", "2", "", "", "999", "OLD1"], // already in the shop
        ["Old Milk", "", "pcs", "40", "50"], // same name, unit and price as an existing one
      ],
      existing,
    );
    expect(rows[0].issues).toEqual({});
    expect(rows[1].issues).toEqual({ barcode: "duplicate" });
    expect(rows[2].issues).toEqual({ sku: "duplicate" });
    expect(rows[3].issues).toEqual({ name: "duplicate" });
    expect(rows[4].issues).toEqual({ barcode: "exists", sku: "exists" });
    expect(rows[5].issues).toEqual({ name: "exists" });
  });

  it("allows the same name at a different price or unit (different sizes)", () => {
    const rows = check("products", [
      ["Oil", "", "bottle", "160", "170"],
      ["Oil", "", "bottle", "800", "850"],
      ["Oil", "", "litre", "160", "170"],
    ]);
    expect(rows.map((r) => r.issues)).toEqual([{}, {}, {}]);
  });
});

describe("customer and supplier rows", () => {
  it("reads name, phone, address and the previous balance", () => {
    const [row] = check("customers", [
      ["রহিম উদ্দিন", "০১৭১১-০০০০০১", "মিরপুর", "১,২৫০"],
    ]);
    expect(row.value).toEqual({
      name: "রহিম উদ্দিন",
      phone: "01711000001",
      address: "মিরপুর",
      balance: 125_000,
    });
  });

  it("needs only a name; a blank balance is none and a minus sign is an advance", () => {
    const rows = check("suppliers", [
      ["করিম ট্রেডার্স"],
      ["আল-আমিন", "", "", "-500"],
    ]);
    expect(rows[0].value).toMatchObject({ phone: "", balance: 0 });
    expect(rows[1].value).toMatchObject({ balance: -50_000 });
  });

  it("flags a missing name, a bad phone and a bad balance", () => {
    const [row] = check("customers", [["", "abc", "", "lots"]]);
    expect(row.issues).toEqual({
      name: "required",
      phone: "invalidPhone",
      balance: "invalidNumber",
    });
  });

  it("treats the same phone as the same person, and the same name when there is no phone", () => {
    const existing = emptyExisting();
    existing.phones.add("01711000009");
    existing.names.add("সালমা");
    const rows = check(
      "customers",
      [
        ["A", "01711000001"],
        ["B", "01711-000001"], // same number, written differently
        ["C", "01711000009"], // already a customer
        ["সালমা"], // already a customer, no phone
        ["Karim"],
        ["karim"], // same name twice in the list
        ["Karim", "01711000005"], // same name but a phone: a different person
      ],
      existing,
    );
    expect(rows.map((r) => r.issues)).toEqual([
      {},
      { name: "duplicate" },
      { name: "exists" },
      { name: "exists" },
      {},
      { name: "duplicate" },
      {},
    ]);
  });
});

describe("pasting", () => {
  it("drops a copied header row and reads the rest", () => {
    const rows = rowsFromPaste(
      "customers",
      "Name\tPhone\tAddress\tDue\nরহিম\t01711000001\t\t500",
    );
    expect(rows).toEqual([["রহিম", "01711000001", "", "500"]]);
  });

  it("keeps a first row that is data", () => {
    expect(rowsFromPaste("customers", "রহিম\t01711000001")).toHaveLength(1);
  });

  it("stops at the row limit", () => {
    const text = Array.from({ length: 600 }, (_, i) => `P${i}\t1\t2`).join(
      "\n",
    );
    expect(rowsFromPaste("products", text)).toHaveLength(500);
  });
});

describe("categories", () => {
  it("matches existing ones in either language and lists the new ones once", () => {
    let n = 0;
    const plan = planCategories(
      ["Dairy", "দুধ ও পানীয়", "dairy", "Soap", "  ", "SOAP"],
      [
        { id: "c1", name: "Dairy", nameBn: "দুগ্ধজাত" },
        { id: "c2", name: "Drinks", nameBn: "দুধ ও পানীয়" },
      ],
      () => `new${++n}`,
    );
    expect(plan.toCreate).toEqual([{ id: "new1", name: "Soap" }]);
    expect(plan.idFor.get("dairy")).toBe("c1");
    expect(plan.idFor.get("দুধ ও পানীয়")).toBe("c2");
    expect(plan.idFor.get("soap")).toBe("new1");
  });
});
