import { divRound } from "./money";
import { lineAmount } from "./sale-math";

/**
 * What a customer really paid, line by line, and what comes back when goods are returned.
 * One set of rules for the screen, the device and the server.
 */

export interface PaidLine {
  /** Milli-units. */
  qty: number;
  /** Poisha per 1 unit. */
  unitPrice: number;
  /** Poisha taken off this line. */
  discount?: number;
}

/**
 * The amount each line of a sale really cost the customer: its price × quantity, less its own
 * discount, less its share of the bill discount (shared out by value, so the lines add up to the
 * sale's total exactly).
 */
export function lineNets(lines: PaidLine[], billDiscount: number): number[] {
  const gross = lines.map((l) =>
    lineAmount({
      qty: l.qty,
      unitPrice: l.unitPrice,
      discount: l.discount ?? 0,
    }),
  );
  const subtotal = gross.reduce((a, b) => a + b, 0);
  const discount = Math.min(Math.max(0, billDiscount), subtotal);
  if (subtotal === 0 || discount === 0) return gross;
  let before = 0;
  let allocated = 0;
  return gross.map((g) => {
    before += g;
    const cumulative = divRound(discount * before, subtotal);
    const share = cumulative - allocated;
    allocated = cumulative;
    return g - share;
  });
}

/**
 * What goes back for returning `qty` of a line that cost `net` in all and had `itemQty` sold, when
 * `alreadyReturned` of it came back earlier. Worked out from the running total, so the pieces of
 * several returns always add up to exactly `net` and never more.
 */
export function refundFor(
  net: number,
  itemQty: number,
  alreadyReturned: number,
  qty: number,
): number {
  if (itemQty <= 0) return 0;
  return (
    divRound(net * (alreadyReturned + qty), itemQty) -
    divRound(net * alreadyReturned, itemQty)
  );
}

/** The refund for each requested line of a return (lines of the same item are counted in order). */
export function refundAmounts(
  items: PaidLine[],
  billDiscount: number,
  returnedBefore: Map<number, number>,
  lines: Array<{ itemIndex: number; qty: number }>,
): number[] {
  const nets = lineNets(items, billDiscount);
  const running = new Map(returnedBefore);
  return lines.map(({ itemIndex, qty }) => {
    const item = items[itemIndex];
    if (!item) return 0;
    const before = running.get(itemIndex) ?? 0;
    running.set(itemIndex, before + qty);
    return refundFor(nets[itemIndex], item.qty, before, qty);
  });
}

export interface EarlierReturn {
  lines: Array<{ itemIndex: number; qty: number }>;
  settlement: "cash" | "credit";
  restock?: boolean;
  total: number;
}

/**
 * What earlier returns of a sale already did: the quantity of each line put back into stock, and
 * the money taken off the customer's due. Cancelling the sale must reverse only what is left.
 */
export function returnedOf(returns: EarlierReturn[]) {
  const restocked = new Map<number, number>();
  let credited = 0;
  for (const r of returns) {
    if (r.restock !== false)
      for (const l of r.lines)
        restocked.set(l.itemIndex, (restocked.get(l.itemIndex) ?? 0) + l.qty);
    if (r.settlement === "credit") credited += r.total;
  }
  return { restocked, credited };
}
