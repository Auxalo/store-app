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

/** How much of each line came back through returns, whether or not it went back into stock. */
export function returnedQuantities(
  returns: Array<{ lines: Array<{ itemIndex: number; qty: number }> }>,
): Map<number, number> {
  const back = new Map<number, number>();
  for (const r of returns)
    for (const l of r.lines)
      back.set(l.itemIndex, (back.get(l.itemIndex) ?? 0) + l.qty);
  return back;
}

/**
 * Every line has come back in full. Such a sale has nothing left to cancel (the goods and the money
 * were already reversed by the returns), and cancelling it would only make its returns disappear
 * from the reports.
 */
export function isFullyReturned(
  itemQtys: number[],
  returns: Array<{ lines: Array<{ itemIndex: number; qty: number }> }>,
): boolean {
  if (itemQtys.length === 0) return false;
  const back = returnedQuantities(returns);
  return itemQtys.every((qty, index) => (back.get(index) ?? 0) >= qty);
}

/**
 * How a refund is settled: part comes off what the customer owes (or what the shop owes a supplier),
 * and the rest is handed over in cash. `credited + cashBack` is always the whole refund.
 */
export interface Split {
  cashBack: number;
  credited: number;
}

/**
 * The part of a refund that was paid for with the customer's store credit: it goes back as store
 * credit, never as cash. Spread over the sale in proportion to what has come back, so all the
 * returns of a sale together give back exactly what was used.
 */
export function creditShare(
  creditUsed: number,
  saleTotal: number,
  refundedBefore: number,
  refund: number,
): number {
  if (creditUsed <= 0 || saleTotal <= 0) return 0;
  const upTo = (amount: number) =>
    Math.round((creditUsed * Math.min(amount, saleTotal)) / saleTotal);
  return upTo(refundedBefore + refund) - upTo(refundedBefore);
}

/**
 * What the screen offers first: the store credit the sale used goes back as credit, what the
 * customer still owes is cleared next, and only the rest is handed back (or kept as credit).
 */
export function defaultSplit(
  refund: number,
  balance: number,
  options: { hasParty: boolean; keepAsCredit?: boolean; creditShare?: number },
): Split {
  if (!options.hasParty) return { cashBack: refund, credited: 0 };
  if (options.keepAsCredit) return { cashBack: 0, credited: refund };
  const share = Math.min(options.creditShare ?? 0, refund);
  const offDue = Math.min(refund - share, Math.max(0, balance));
  const credited = share + offDue;
  return { cashBack: refund - credited, credited };
}

/**
 * The split a return is saved with. A new return says how much goes back in cash; an older one only
 * said "cash" or "credit", which means all of it one way or the other. Without a person on the
 * invoice (a walk-in sale) there is nobody to credit, so it is all cash.
 */
export function resolveSplit(
  total: number,
  asked: { cashBack?: number; settlement?: "cash" | "credit" },
  hasParty: boolean,
): Split {
  if (!hasParty) return { cashBack: total, credited: 0 };
  const cashBack =
    typeof asked.cashBack === "number"
      ? Math.min(total, Math.max(0, asked.cashBack))
      : asked.settlement === "credit"
        ? 0
        : total;
  return { cashBack, credited: total - cashBack };
}

/** The split of a saved return, new or old. */
export function returnSplit(ret: {
  total: number;
  cashBack?: number;
  credited?: number;
  settlement?: "cash" | "credit";
}): Split {
  if (typeof ret.cashBack === "number") {
    const cashBack = Math.min(ret.total, Math.max(0, ret.cashBack));
    return { cashBack, credited: ret.total - cashBack };
  }
  return ret.settlement === "credit"
    ? { cashBack: 0, credited: ret.total }
    : { cashBack: ret.total, credited: 0 };
}

export interface EarlierReturn {
  lines: Array<{ itemIndex: number; qty: number }>;
  settlement?: "cash" | "credit";
  cashBack?: number;
  credited?: number;
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
    credited += returnSplit(r).credited;
  }
  return { restocked, credited };
}
