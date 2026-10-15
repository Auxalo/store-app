/**
 * What went in and out of stock, product by product, for a period. ONE fold used by the device and
 * the server (the server groups in the database first, the device groups in memory; both give the
 * same rows to `foldMovements`, so they cannot disagree: see src/reports/__tests__/movements.test.ts).
 *
 * In and out follow the sign of each movement, not its type. The one exception: cancelling a sale
 * puts the goods back as a "sale_return" movement (refType "sale_void"); that undoes the sale
 * instead of counting as goods coming in, so it reduces "sold".
 */

export interface MovementAgg {
  productId: string;
  type: string;
  /** A cancelled sale putting its goods back. */
  reversal: boolean;
  /** Sum of the positive changes (milli-units). */
  qtyIn: number;
  /** Sum of the negative changes, as a positive number (milli-units). */
  qtyOut: number;
}

export interface MovementCard {
  productId: string;
  /** Goods in, by kind of movement (milli-units). */
  in: Record<string, number>;
  /** Goods out, by kind (milli-units). "sale" is net of cancelled sales. */
  out: Record<string, number>;
  totalIn: number;
  totalOut: number;
}

/** The device's grouping of raw movements into the shape the server's database query returns. */
export function aggregateMovements(
  movements: Array<{
    productId: string;
    type: string;
    refType?: string | null;
    qtyDelta: number;
  }>,
): MovementAgg[] {
  const groups = new Map<string, MovementAgg>();
  for (const m of movements) {
    const reversal = m.type === "sale_return" && m.refType === "sale_void";
    const key = `${m.productId}|${m.type}|${reversal ? 1 : 0}`;
    const group = groups.get(key) ?? {
      productId: m.productId,
      type: m.type,
      reversal,
      qtyIn: 0,
      qtyOut: 0,
    };
    if (m.qtyDelta > 0) group.qtyIn += m.qtyDelta;
    else group.qtyOut += -m.qtyDelta;
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function foldMovements(rows: MovementAgg[]): MovementCard[] {
  const cards = new Map<string, MovementCard>();
  for (const row of rows) {
    const card = cards.get(row.productId) ?? {
      productId: row.productId,
      in: {},
      out: {},
      totalIn: 0,
      totalOut: 0,
    };
    if (row.reversal) {
      card.out.sale = (card.out.sale ?? 0) - row.qtyIn;
      if (row.qtyOut)
        card.out[row.type] = (card.out[row.type] ?? 0) + row.qtyOut;
    } else {
      if (row.qtyIn) card.in[row.type] = (card.in[row.type] ?? 0) + row.qtyIn;
      if (row.qtyOut)
        card.out[row.type] = (card.out[row.type] ?? 0) + row.qtyOut;
    }
    cards.set(row.productId, card);
  }
  const result: MovementCard[] = [];
  for (const card of cards.values()) {
    for (const side of [card.in, card.out])
      for (const [type, qty] of Object.entries(side))
        if (qty === 0) delete side[type];
    card.totalIn = Object.values(card.in).reduce((a, b) => a + b, 0);
    card.totalOut = Object.values(card.out).reduce((a, b) => a + b, 0);
    if (card.totalIn !== 0 || card.totalOut !== 0) result.push(card);
  }
  // The most movement first (a stable order, so device and server list products alike).
  return result.sort(
    (a, b) =>
      b.totalIn + Math.abs(b.totalOut) - (a.totalIn + Math.abs(a.totalOut)) ||
      a.productId.localeCompare(b.productId),
  );
}

export interface MovementRow extends MovementCard {
  name: string;
  unit: string;
  /** In stock now (milli-units). */
  stock: number;
}

export interface MovementSummary {
  rows: MovementRow[];
}
