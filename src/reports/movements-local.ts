import type { StoreDB } from "@/db/local/db";
import { type DayRange, rangeBounds } from "./compute";
import {
  aggregateMovements,
  foldMovements,
  type MovementSummary,
} from "./movements";

/** What went in and out of stock per product, from what is on this device. */
export async function loadMovementSummary(
  db: StoreDB,
  range: DayRange,
  timeZone: string,
): Promise<MovementSummary> {
  const { start, end } = rangeBounds(range, timeZone);
  const movements = await db.stockMovements
    .where("createdAt")
    .between(start, end, true, false)
    .toArray();
  const cards = foldMovements(aggregateMovements(movements));
  const products = await db.products.bulkGet(cards.map((c) => c.productId));
  return {
    rows: cards.map((card, i) => ({
      ...card,
      name: products[i]?.name ?? "",
      unit: products[i]?.unit ?? "pcs",
      stock: products[i]?.stock ?? 0,
    })),
  };
}
