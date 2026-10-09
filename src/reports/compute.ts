import { TZDate } from "@date-fns/tz";
import type {
  Expense,
  Product,
  Purchase,
  ReturnDoc,
  Sale,
  SaleItem,
} from "@/db/local/types";
import { DEFAULT_TIME_ZONE } from "@/lib/constants";
import { lineTotal } from "@/lib/qty";
import { returnSplit } from "@/lib/refund";

/**
 * Report maths as plain functions over plain records, so the same code gives the same answer on a
 * device (from IndexedDB) and on the server (from MongoDB). Money is poisha, quantities milli-units.
 *
 * What counts:
 *  - Sales: active (not cancelled) sales, on the day they were made.
 *  - Returns: a sale return takes back its refund and its cost on the day the return was made.
 *  - Profit: net sales minus the cost of what was sold (cost is copied onto each sale line when
 *    the sale is made, so later price changes do not rewrite history).
 *  - Expenses: active expenses on their `date`. Net profit = profit minus expenses.
 *  - Purchases are shown as money spent on stock; they are not deducted again (the cost is
 *    already inside profit when the goods are sold).
 */

export interface SaleWithItems extends Sale {
  items: SaleItem[];
}

export interface DayRange {
  /** yyyy-mm-dd in the store's time zone, inclusive. */
  from: string;
  to: string;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** The store-local calendar day (yyyy-mm-dd) of a moment. */
export function dayKey(
  at: string | number | Date,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  let fmt = dayFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormatters.set(timeZone, fmt);
  }
  return fmt.format(new Date(at));
}

/** UTC instants for the start of `range.from` and the start of the day after `range.to`. */
export function rangeBounds(
  range: DayRange,
  timeZone = DEFAULT_TIME_ZONE,
): { start: string; end: string } {
  const at = (day: string, plus = 0) => {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(
      new TZDate(y, m - 1, d + plus, timeZone).getTime(),
    ).toISOString();
  };
  return { start: at(range.from), end: at(range.to, 1) };
}

/** Every day from `from` to `to`, oldest first. */
export function daysIn(range: DayRange): string[] {
  const days: string[] = [];
  const [y, m, d] = range.from.split("-").map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  for (let guard = 0; guard < 800; guard++) {
    const day = cursor.toISOString().slice(0, 10);
    if (day > range.to) break;
    days.push(day);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export interface ReportInput {
  range: DayRange;
  timeZone?: string;
  sales: SaleWithItems[];
  returns: ReturnDoc[];
  expenses: Expense[];
  purchases: Purchase[];
  /** Looks up any sale (also ones before the range) so a return can take back its cost. */
  findSale: (id: string) => SaleWithItems | undefined;
  /** productId → categoryId. */
  categoryOf: (productId: string) => string | null;
}

export interface ProductRow {
  productId: string;
  name: string;
  nameBn: string;
  unit: SaleItem["unit"];
  qty: number;
  revenue: number;
  profit: number;
}

export interface DayRow {
  day: string;
  sales: number;
  profit: number;
  count: number;
}

export interface Summary {
  range: DayRange;
  salesCount: number;
  /** Sum of line totals before any sale-level discount. */
  subtotal: number;
  discount: number;
  /** What customers were charged. */
  total: number;
  paid: number;
  /** Money left owing from these sales when they were made. */
  due: number;
  /** Paid from customers' store credit. */
  creditUsed: number;
  /** Cash handed back to customers for returns in this period. */
  cashBack: number;
  /** Refunds that came off what customers owed (or were kept as their credit). */
  credited: number;
  /** Money that came in: received at the sales, less cash handed back. */
  received: number;
  /**
   * Still owed from these sales once returns took their part off: `due - credited`. Negative means
   * returns created store credit beyond what was owed.
   * (netSales = received + creditUsed + unpaid, always.)
   */
  unpaid: number;
  /** Goods sent back to suppliers (what they were worth). */
  purchaseReturns: number;
  returns: number;
  /** total − returns. */
  netSales: number;
  /** Cost of goods sold, after taking returned goods back. */
  cost: number;
  profit: number;
  expenses: number;
  /** profit − expenses. */
  netProfit: number;
  purchasesCount: number;
  purchasesTotal: number;
  purchasesDue: number;
  byDay: DayRow[];
  byPayment: Array<{
    method: Sale["paymentMethod"];
    total: number;
    count: number;
  }>;
  byProduct: ProductRow[];
  byCategory: Array<{
    categoryId: string | null;
    qty: number;
    revenue: number;
    profit: number;
  }>;
  expensesByCategory: Array<{ category: string; total: number }>;
}

const costOf = (item: SaleItem) => lineTotal(item.unitCost, item.qty);

/** The sale's own discount spread over its lines, so product profit adds up to sale profit. */
function lineShare(sale: SaleWithItems, item: SaleItem): number {
  const gross = sale.items.reduce((sum, i) => sum + i.lineTotal, 0);
  if (sale.discount <= 0 || gross <= 0) return item.lineTotal;
  return item.lineTotal - Math.round((sale.discount * item.lineTotal) / gross);
}

export function summarize(input: ReportInput): Summary {
  const tz = input.timeZone ?? DEFAULT_TIME_ZONE;
  const { range } = input;
  const inRange = (day: string) => day >= range.from && day <= range.to;

  const days = new Map<string, DayRow>(
    daysIn(range).map((day) => [day, { day, sales: 0, profit: 0, count: 0 }]),
  );
  const payments = new Map<
    string,
    { method: Sale["paymentMethod"]; total: number; count: number }
  >();
  const products = new Map<string, ProductRow>();
  const categories = new Map<
    string | null,
    { categoryId: string | null; qty: number; revenue: number; profit: number }
  >();

  const addProduct = (
    item: SaleItem,
    qty: number,
    revenue: number,
    cost: number,
  ) => {
    const row = products.get(item.productId) ?? {
      productId: item.productId,
      name: item.productName,
      nameBn: item.productNameBn,
      unit: item.unit,
      qty: 0,
      revenue: 0,
      profit: 0,
    };
    row.qty += qty;
    row.revenue += revenue;
    row.profit += revenue - cost;
    products.set(item.productId, row);

    const categoryId = input.categoryOf(item.productId);
    const cat = categories.get(categoryId) ?? {
      categoryId,
      qty: 0,
      revenue: 0,
      profit: 0,
    };
    cat.qty += qty;
    cat.revenue += revenue;
    cat.profit += revenue - cost;
    categories.set(categoryId, cat);
  };

  let salesCount = 0;
  let subtotal = 0;
  let discount = 0;
  let total = 0;
  let paid = 0;
  let due = 0;
  let creditUsed = 0;
  let cost = 0;

  for (const sale of input.sales) {
    if (sale.status !== "active" || sale.deletedAt) continue;
    const day = dayKey(sale.createdAt, tz);
    if (!inRange(day)) continue;
    const saleCost = sale.items.reduce((sum, i) => sum + costOf(i), 0);
    salesCount += 1;
    subtotal += sale.subtotal;
    discount += sale.discount;
    total += sale.total;
    paid += sale.paid;
    due += sale.due;
    creditUsed += sale.creditUsed ?? 0;
    cost += saleCost;

    const d = days.get(day);
    if (d) {
      d.sales += sale.total;
      d.profit += sale.total - saleCost;
      d.count += 1;
    }
    // How people paid is the money that came in, by method; what is still owed is the "credit" figure.
    if (sale.paid > 0) {
      const pay = payments.get(sale.paymentMethod) ?? {
        method: sale.paymentMethod,
        total: 0,
        count: 0,
      };
      pay.total += sale.paid;
      pay.count += 1;
      payments.set(sale.paymentMethod, pay);
    }
    for (const item of sale.items)
      addProduct(item, item.qty, lineShare(sale, item), costOf(item));
  }

  let returns = 0;
  let cashBack = 0;
  let credited = 0;
  let purchaseReturns = 0;
  for (const ret of input.returns) {
    const day = dayKey(ret.createdAt, tz);
    if (!inRange(day)) continue;
    if (ret.kind === "purchase") {
      purchaseReturns += ret.total;
      continue;
    }
    if (ret.kind !== "sale") continue;
    const sale = input.findSale(ret.refId);
    // A cancelled sale is not counted at all, so neither are its returns (that would count the
    // same goods and money twice).
    if (sale && sale.status !== "active") continue;
    let returnedCost = 0;
    for (const line of ret.lines) {
      const item = sale?.items[line.itemIndex];
      if (!item) continue;
      const lineCost = lineTotal(item.unitCost, line.qty);
      returnedCost += lineCost;
      addProduct(
        item,
        -line.qty,
        -(line.amount ?? lineTotal(line.unitAmount, line.qty)),
        -lineCost,
      );
    }
    returns += ret.total;
    const split = returnSplit(ret);
    cashBack += split.cashBack;
    credited += split.credited;
    cost -= returnedCost;
    const d = days.get(day);
    if (d) {
      d.sales -= ret.total;
      d.profit -= ret.total - returnedCost;
    }
  }

  const expenseByCategory = new Map<string, number>();
  let expenses = 0;
  for (const e of input.expenses) {
    if (e.status !== "active" || !inRange(e.date)) continue;
    expenses += e.amount;
    expenseByCategory.set(
      e.category,
      (expenseByCategory.get(e.category) ?? 0) + e.amount,
    );
  }

  let purchasesCount = 0;
  let purchasesTotal = 0;
  let purchasesDue = 0;
  for (const p of input.purchases) {
    if (p.deletedAt || !inRange(p.date)) continue;
    purchasesCount += 1;
    purchasesTotal += p.total;
    purchasesDue += p.due;
  }

  const netSales = total - returns;
  const profit = netSales - cost;
  return {
    range,
    salesCount,
    subtotal,
    discount,
    total,
    paid,
    due,
    creditUsed,
    cashBack,
    credited,
    received: paid - cashBack,
    unpaid: due - credited,
    purchaseReturns,
    returns,
    netSales,
    cost,
    profit,
    expenses,
    netProfit: profit - expenses,
    purchasesCount,
    purchasesTotal,
    purchasesDue,
    byDay: [...days.values()],
    byPayment: [...payments.values()].sort((a, b) => b.total - a.total),
    byProduct: [...products.values()].sort((a, b) => b.revenue - a.revenue),
    byCategory: [...categories.values()].sort((a, b) => b.revenue - a.revenue),
    expensesByCategory: [...expenseByCategory]
      .map(([category, t]) => ({ category, total: t }))
      .sort((a, b) => b.total - a.total),
  };
}

export interface StockRow {
  productId: string;
  name: string;
  nameBn: string;
  unit: Product["unit"];
  stock: number;
  lowStockThreshold: number;
  /** Value at purchase price, in poisha. */
  costValue: number;
  /** Value at selling price, in poisha. */
  retailValue: number;
}

export function stockRows(products: Product[]): StockRow[] {
  return products
    .filter((p) => p.isActive && !p.deletedAt)
    .map((p) => ({
      productId: p.id,
      name: p.name,
      nameBn: p.nameBn,
      unit: p.unit,
      stock: p.stock,
      lowStockThreshold: p.lowStockThreshold,
      costValue: Math.max(0, lineTotal(p.purchasePrice, p.stock)),
      retailValue: Math.max(0, lineTotal(p.sellingPrice, p.stock)),
    }));
}
