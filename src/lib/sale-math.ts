import { lineTotal } from "./qty";

export interface SaleLineAmounts {
  /** Milli-units. */
  qty: number;
  /** Poisha per 1 unit. */
  unitPrice: number;
  /** Poisha taken off this line. */
  discount: number;
}

export interface SaleTotals {
  subtotal: number;
  /** Cart-level discount actually applied (never more than the subtotal). */
  discount: number;
  total: number;
  /** Amount received now, capped at the total (change is not part of the sale). */
  paid: number;
  due: number;
}

/** What one line costs the customer: price × quantity, minus its discount, never negative. */
export function lineAmount(line: SaleLineAmounts): number {
  return Math.max(0, lineTotal(line.unitPrice, line.qty) - line.discount);
}

/**
 * The single source of truth for sale totals. The cashier's screen, the local database and the
 * server all call this, so they can never disagree about what a sale came to.
 */
export function computeTotals(
  lines: SaleLineAmounts[],
  cartDiscount: number,
  tendered: number,
): SaleTotals {
  const subtotal = lines.reduce((sum, line) => sum + lineAmount(line), 0);
  const discount = Math.min(Math.max(0, cartDiscount), subtotal);
  const total = subtotal - discount;
  const paid = Math.min(Math.max(0, tendered), total);
  return { subtotal, discount, total, paid, due: total - paid };
}

/** Quantity of each product across all lines (the same product may appear on several lines). */
export function qtyByProduct(
  lines: Array<{ productId: string; qty: number }>,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of lines)
    totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.qty);
  return totals;
}

/**
 * Ids of the records a sale creates besides the sale itself. They are derived from the sale id,
 * so the device and the server always agree on them and a retry can never create a second copy.
 */
export const saleRecordIds = {
  item: (saleId: string, index: number) => `${saleId}:i${index}`,
  movement: (saleId: string, index: number) => `${saleId}:m${index}`,
  ledger: (saleId: string) => `${saleId}:l`,
  voidMovement: (saleId: string, index: number) => `${saleId}:vm${index}`,
  voidLedger: (saleId: string) => `${saleId}:vl`,
};
