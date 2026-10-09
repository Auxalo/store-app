import { describe, expect, it } from "vitest";
import { derivedSearchFields, queryTokens } from "../search-fields";

describe("derived search fields", () => {
  it("products are found by their one name (Bangla or English), SKU and barcode, and sort by a normalised name", () => {
    const f = derivedSearchFields("products", {
      name: "Miniket Rice",
      sku: "A0042",
      barcode: "8941234",
    });
    expect(f.searchWords).toEqual(
      expect.arrayContaining(["miniket", "rice", "a0042", "8941234"]),
    );
    expect(f.nameKey).toBe("miniket rice");

    const bn = derivedSearchFields("products", { name: "মিনিকেট চাল" });
    expect(bn.searchWords).toEqual(expect.arrayContaining(["মিনিকেট", "চাল"]));
  });

  it("an old separate Bangla name is no longer searched (the product has one name)", () => {
    const f = derivedSearchFields("products", {
      name: "Miniket Rice",
      nameBn: "মিনিকেট চাল",
    });
    expect(f.searchWords).not.toContain("চাল");
  });

  it("customers and suppliers are found by name and phone (Bangla digits too)", () => {
    expect(
      derivedSearchFields("customers", { name: "রহিম", phone: "০১৭১১০০০০০১" })
        .searchWords,
    ).toEqual(expect.arrayContaining(["রহিম", "01711000001"]));
    const s = derivedSearchFields("suppliers", {
      name: "Karim Traders",
      phone: "018",
      contactPerson: "Abdul",
    });
    expect(s.searchWords).toEqual(
      expect.arrayContaining(["karim", "traders", "018", "abdul"]),
    );
  });

  it("sales are found by invoice number (whole, in parts, and without leading zeros), buyer name and phone", () => {
    const f = derivedSearchFields("sales", {
      invoiceNo: "A-2610-0042",
      customerName: "রহিম উদ্দিন",
      customerPhone: "01711000001",
    });
    expect(f.searchWords).toEqual(
      expect.arrayContaining([
        "a",
        "2610",
        "0042",
        "42",
        "রহিম",
        "উদ্দিন",
        "01711000001",
      ]),
    );
    expect(f.nameKey).toBeUndefined();
  });

  it("a number that is only zeros is still findable, and nothing breaks without a buyer", () => {
    expect(
      derivedSearchFields("sales", { invoiceNo: "A-2610-0000" }).searchWords,
    ).toContain("0");
    expect(derivedSearchFields("sales", {}).searchWords).toEqual([]);
  });

  it("purchases are found by our number, the supplier's invoice and the supplier", () => {
    const f = derivedSearchFields("purchases", {
      purchaseNo: "P-A-2610-0007",
      invoiceRef: "INV-99",
      supplierName: "করিম ট্রেডার্স",
    });
    expect(f.searchWords).toEqual(
      expect.arrayContaining(["p", "0007", "7", "inv", "99", "করিম", "ট্রেডার্স"]),
    );
  });
});

describe("query tokens", () => {
  it("splits like the stored words, in one normal form", () => {
    expect(queryTokens("  A-2610-0042  ")).toEqual(["a", "2610", "0042"]);
    expect(queryTokens("০১৭১১")).toEqual(["01711"]);
    expect(queryTokens("")).toEqual([]);
  });
});
