import { parseMoney } from "@/lib/money";
import { isHeaderRow, parsePastedTable } from "@/lib/paste-table";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { parseQty, roundToUnit } from "@/lib/qty";
import { normalizeSearch } from "@/lib/search";
import { UNIT_CODES, type UnitCode, unitDecimals } from "@/lib/units";

/**
 * The first-time setup brings in what a shop already has: products with stock, customers who owe
 * money, suppliers the shop owes. People type rows, or paste them from Excel / Google Sheets; this
 * module reads each row, says what is wrong with it, and finds duplicates. No UI in here.
 */

export type SetupKind = "products" | "customers" | "suppliers";

export const MAX_SETUP_ROWS = 500;

export interface ColumnDef {
  key: string;
  required?: boolean;
  /** Words this column may be called in a pasted header row (English and Bangla). */
  titles: string[];
}

export const COLUMNS: Record<SetupKind, ColumnDef[]> = {
  products: [
    {
      key: "name",
      required: true,
      titles: ["name", "product", "product name", "নাম", "পণ্য", "পণ্যের নাম"],
    },
    { key: "category", titles: ["category", "ক্যাটাগরি"] },
    { key: "unit", titles: ["unit", "একক", "ইউনিট"] },
    {
      key: "purchasePrice",
      required: true,
      titles: ["purchase price", "cost", "buy price", "ক্রয়মূল্য", "ক্রয়"],
    },
    {
      key: "sellingPrice",
      required: true,
      titles: ["selling price", "price", "sell price", "বিক্রয়মূল্য", "বিক্রয়"],
    },
    { key: "stock", titles: ["stock", "quantity", "qty", "স্টক", "পরিমাণ"] },
    {
      key: "lowStock",
      titles: ["low stock", "low-stock level", "alert", "কম স্টক"],
    },
    { key: "barcode", titles: ["barcode", "বারকোড"] },
    { key: "sku", titles: ["sku", "code", "এসকেইউ"] },
  ],
  customers: [
    {
      key: "name",
      required: true,
      titles: ["name", "customer", "customer name", "নাম", "ক্রেতা"],
    },
    { key: "phone", titles: ["phone", "mobile", "ফোন", "মোবাইল"] },
    { key: "address", titles: ["address", "ঠিকানা"] },
    {
      key: "balance",
      titles: ["due", "previous due", "balance", "বাকি", "আগের বাকি"],
    },
  ],
  suppliers: [
    {
      key: "name",
      required: true,
      titles: ["name", "supplier", "supplier name", "নাম", "সরবরাহকারী"],
    },
    { key: "phone", titles: ["phone", "mobile", "ফোন", "মোবাইল"] },
    { key: "address", titles: ["address", "ঠিকানা"] },
    {
      key: "balance",
      titles: [
        "payable",
        "previous payable",
        "balance",
        "due",
        "পাওনা",
        "আগের পাওনা",
      ],
    },
  ],
};

export type RowIssue =
  | "required"
  | "invalidNumber"
  | "positive"
  | "unknownUnit"
  | "tooManyDecimals"
  | "invalidPhone"
  | "duplicate"
  | "exists";

export interface ProductValue {
  name: string;
  category: string;
  unit: UnitCode;
  purchasePrice: number;
  sellingPrice: number;
  openingStock: number;
  lowStockThreshold: number;
  barcode: string;
  sku: string;
}
export interface PartyValue {
  name: string;
  phone: string;
  address: string;
  /** Signed poisha: owed to us (customer) or by us (supplier); negative is an advance. 0 = none. */
  balance: number;
}
export type RowValue = ProductValue | PartyValue;

export interface CheckedRow<V = RowValue> {
  /** Which columns have a problem, and what the problem is. */
  issues: Record<string, RowIssue>;
  /** Present only when the row has no problems. */
  value?: V;
}

/** What the shop already has, so the same list can be pasted twice without making duplicates. */
export interface Existing {
  /** Normalised phone numbers and names (of live customers or suppliers). */
  phones: Set<string>;
  names: Set<string>;
  /** Products: SKUs, barcodes, and `name|unit|price` keys. */
  skus: Set<string>;
  barcodes: Set<string>;
  productKeys: Set<string>;
}

export const emptyExisting = (): Existing => ({
  phones: new Set(),
  names: new Set(),
  skus: new Set(),
  barcodes: new Set(),
  productKeys: new Set(),
});

/** Maps what a person typed for a unit ("kg", "কেজি", "PCS") to a unit code. */
export function makeUnitLookup(labels: Partial<Record<UnitCode, string>>) {
  const byText = new Map<string, UnitCode>();
  for (const code of UNIT_CODES) {
    byText.set(normalizeSearch(code), code);
    const label = labels[code];
    if (label) byText.set(normalizeSearch(label), code);
  }
  return (text: string): UnitCode | null => {
    const key = normalizeSearch(text);
    return key === "" ? "pcs" : (byText.get(key) ?? null);
  };
}

const cell = (cells: string[], i: number) => (cells[i] ?? "").trim();
export const productKey = (name: string, unit: string, price: number) =>
  `${normalizeSearch(name)}|${unit}|${price}`;

function checkProduct(
  cells: string[],
  unitOf: (text: string) => UnitCode | null,
  existing: Existing,
  seen: Existing,
): CheckedRow<ProductValue> {
  const cols = COLUMNS.products.map((c) => c.key);
  const get = (key: string) => cell(cells, cols.indexOf(key));
  const issues: Record<string, RowIssue> = {};

  const name = get("name");
  if (!name) issues.name = "required";

  const unit = unitOf(get("unit"));
  if (!unit) issues.unit = "unknownUnit";

  const price = (key: "purchasePrice" | "sellingPrice") => {
    const text = get(key);
    const value = text ? parseMoney(text) : null;
    if (!text) issues[key] = "required";
    else if (value === null) issues[key] = "invalidNumber";
    else if (value <= 0) issues[key] = "positive";
    return value !== null && value > 0 ? value : 0;
  };
  const purchasePrice = price("purchasePrice");
  const sellingPrice = price("sellingPrice");

  const quantity = (key: "stock" | "lowStock") => {
    const text = get(key);
    if (!text) return 0;
    const value = parseQty(text);
    if (value === null || value < 0) {
      issues[key] = "invalidNumber";
      return 0;
    }
    if (unit && roundToUnit(value, unitDecimals(unit)) !== value) {
      issues[key] = "tooManyDecimals";
      return 0;
    }
    return value;
  };
  const openingStock = quantity("stock");
  const lowStockThreshold = quantity("lowStock");

  const barcode = get("barcode");
  const sku = get("sku");
  const clash = (code: string, key: "barcodes" | "skus", column: string) => {
    if (!code) return;
    if (existing[key].has(code)) issues[column] = "exists";
    else if (seen[key].has(code)) issues[column] = "duplicate";
    else seen[key].add(code);
  };
  clash(barcode, "barcodes", "barcode");
  clash(sku, "skus", "sku");

  if (name && unit && sellingPrice > 0 && !issues.name) {
    const key = productKey(name, unit, sellingPrice);
    if (existing.productKeys.has(key)) issues.name = "exists";
    else if (seen.productKeys.has(key)) issues.name = "duplicate";
    else seen.productKeys.add(key);
  }

  if (Object.keys(issues).length > 0) return { issues };
  return {
    issues,
    value: {
      name,
      category: get("category"),
      unit: unit as UnitCode,
      purchasePrice,
      sellingPrice,
      openingStock,
      lowStockThreshold,
      barcode,
      sku,
    },
  };
}

function checkParty(
  cells: string[],
  kind: "customers" | "suppliers",
  existing: Existing,
  seen: Existing,
): CheckedRow<PartyValue> {
  const cols = COLUMNS[kind].map((c) => c.key);
  const get = (key: string) => cell(cells, cols.indexOf(key));
  const issues: Record<string, RowIssue> = {};

  const name = get("name");
  if (!name) issues.name = "required";

  const phoneText = get("phone");
  if (phoneText && !isValidPhone(phoneText)) issues.phone = "invalidPhone";
  const phone = phoneText && !issues.phone ? normalizePhone(phoneText) : "";

  const balanceText = get("balance");
  let balance = 0;
  if (balanceText) {
    const parsed = parseMoney(balanceText);
    if (parsed === null) issues.balance = "invalidNumber";
    else balance = parsed;
  }

  // The same person: by phone when there is one, otherwise by name.
  if (name && !issues.phone) {
    const key = phone || normalizeSearch(name);
    const set = phone ? "phones" : "names";
    if (existing[set].has(key)) issues.name = "exists";
    else if (seen[set].has(key)) issues.name = "duplicate";
    else seen[set].add(key);
  }

  if (Object.keys(issues).length > 0) return { issues };
  return { issues, value: { name, phone, address: get("address"), balance } };
}

/** Checks every row of one step. Rows after the limit are ignored by the screen, not checked here. */
export function checkRows(
  kind: SetupKind,
  rows: string[][],
  context: { existing: Existing; unitOf: (text: string) => UnitCode | null },
): CheckedRow[] {
  const seen = emptyExisting();
  return rows.map((cells) =>
    kind === "products"
      ? checkProduct(cells, context.unitOf, context.existing, seen)
      : checkParty(cells, kind, context.existing, seen),
  );
}

/** Pasted text → rows for this step, dropping a copied header row. */
export function rowsFromPaste(kind: SetupKind, text: string): string[][] {
  const rows = parsePastedTable(text);
  if (
    rows.length > 0 &&
    isHeaderRow(
      rows[0],
      COLUMNS[kind].map((c) => c.titles),
    )
  )
    rows.shift();
  return rows.slice(0, MAX_SETUP_ROWS);
}

/** What a person can copy to start from: just the column titles, tab separated. */
export const templateText = (titles: string[]) => `${titles.join("\t")}\n`;

/**
 * Product rows name a category in words. Match each one to an existing category (ignoring case and
 * Bangla/English), and list the ones that need creating.
 */
export function planCategories(
  names: string[],
  existing: Array<{ id: string; name: string; nameBn: string }>,
  newId: () => string,
): {
  idFor: Map<string, string>;
  toCreate: Array<{ id: string; name: string }>;
} {
  const known = new Map<string, string>();
  for (const c of existing) {
    known.set(normalizeSearch(c.name), c.id);
    if (c.nameBn) known.set(normalizeSearch(c.nameBn), c.id);
  }
  const idFor = new Map<string, string>();
  const toCreate: Array<{ id: string; name: string }> = [];
  for (const raw of names) {
    const name = raw.trim();
    const key = normalizeSearch(name);
    if (!key || idFor.has(key)) continue;
    const found = known.get(key);
    if (found) idFor.set(key, found);
    else {
      const id = newId();
      idFor.set(key, id);
      toCreate.push({ id, name });
    }
  }
  return { idFor, toCreate };
}
