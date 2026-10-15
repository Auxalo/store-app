import type { Db } from "mongodb";
import { type DayRange, rangeBounds } from "@/reports/compute";
import {
  foldMovements,
  type MovementAgg,
  type MovementSummary,
} from "@/reports/movements";

const MAX_TIME_MS = 8_000;

/** What went in and out of stock per product, from the server's copy (same fold as the device). */
export async function serverMovementSummary(
  db: Db,
  storeId: string,
  range: DayRange,
  timeZone: string,
): Promise<MovementSummary> {
  const { start, end } = rangeBounds(range, timeZone);
  const grouped = await db
    .collection("stockMovements")
    .aggregate<{
      _id: { productId: string; type: string; reversal: boolean };
      qtyIn: number;
      qtyOut: number;
    }>(
      [
        { $match: { storeId, createdAt: { $gte: start, $lt: end } } },
        {
          $group: {
            _id: {
              productId: "$productId",
              type: "$type",
              reversal: {
                $and: [
                  { $eq: ["$type", "sale_return"] },
                  { $eq: ["$refType", "sale_void"] },
                ],
              },
            },
            qtyIn: {
              $sum: { $cond: [{ $gt: ["$qtyDelta", 0] }, "$qtyDelta", 0] },
            },
            qtyOut: {
              $sum: {
                $cond: [
                  { $lt: ["$qtyDelta", 0] },
                  { $multiply: ["$qtyDelta", -1] },
                  0,
                ],
              },
            },
          },
        },
      ],
      { maxTimeMS: MAX_TIME_MS },
    )
    .toArray();
  const rows: MovementAgg[] = grouped.map((g) => ({
    productId: g._id.productId,
    type: g._id.type,
    reversal: g._id.reversal === true,
    qtyIn: g.qtyIn,
    qtyOut: g.qtyOut,
  }));
  const cards = foldMovements(rows);
  const products = await db
    .collection<{ _id: string; name?: string; unit?: string; stock?: number }>(
      "products",
    )
    .find(
      { _id: { $in: cards.map((c) => c.productId) }, storeId },
      { projection: { name: 1, unit: 1, stock: 1 } },
    )
    .maxTimeMS(MAX_TIME_MS)
    .toArray();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  return {
    rows: cards.map((card) => {
      const p = byId.get(card.productId);
      return {
        ...card,
        name: p?.name ?? "",
        unit: p?.unit ?? "pcs",
        stock: Number(p?.stock ?? 0),
      };
    }),
  };
}
