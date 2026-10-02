export type StockFilter = "all" | "low" | "out";
export type StockStatus = "ok" | "low" | "out";

/** out: nothing (or less than nothing) on hand · low: at or under the product's own threshold. */
export function stockStatus(product: {
  stock: number;
  lowStockThreshold: number;
}): StockStatus {
  if (product.stock <= 0) return "out";
  if (
    product.lowStockThreshold > 0 &&
    product.stock <= product.lowStockThreshold
  )
    return "low";
  return "ok";
}
