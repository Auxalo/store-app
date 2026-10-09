import type { CommandInput, CommandType } from "@/commands/definitions";
import { onlineNumber, onlineSku, yearMonth } from "@/lib/doc-number";
import { storeTimeZone } from "../data/service";
import { PrepareRejection } from "../sync/push";
import type { ServerCtx } from "./types";

/**
 * Online, the browser sends only what the person did ("sell these, to this customer"). The server
 * works out the rest, from its own records, inside the same transaction as the change:
 *   - document numbers (2610-00042) and automatic SKUs (00042), from counters, so they are unique
 *     across the whole shop and can never equal a number a device made offline;
 *   - what things cost and what they are listed at (never taken from the browser, so a cashier
 *     cannot hide a price change or inflate a refund);
 *   - who the customer or supplier was, and what a cancelled sale touched;
 *   - the version an edit is based on.
 * The result is exactly the payload a device would have queued, so the same handlers apply it.
 */

type Doc = Record<string, unknown> & { _id: string };

/** The next number of a counter, reserved inside the transaction (it commits or rolls back with the document). */
async function nextCount(ctx: ServerCtx, key: string): Promise<number> {
  const counter = await ctx.db
    .collection<{ _id: string; seq: number }>("counters")
    .findOneAndUpdate(
      { _id: `${ctx.storeId}:${key}` },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after", session: ctx.session },
    );
  return counter?.seq ?? 1;
}

async function storeMonth(ctx: ServerCtx): Promise<string> {
  // The time zone is remembered for a few seconds (it almost never changes), so a sale does not
  // read the shop's record just to name the month.
  return yearMonth(ctx.opCreatedAt, await storeTimeZone(ctx.db, ctx.storeId));
}

async function documentNumber(ctx: ServerCtx, prefix: string) {
  const month = await storeMonth(ctx);
  return onlineNumber(
    prefix,
    month,
    await nextCount(ctx, `${prefix || "S"}:${month}`),
  );
}

const find = (ctx: ServerCtx, collection: string, id: string) =>
  ctx.db
    .collection<Doc>(collection)
    .findOne({ _id: id, storeId: ctx.storeId }, { session: ctx.session });

/** Edits carry the version the person was looking at, so a clash with someone else is noticed. */
const withBase = async <I extends object>(
  _ctx: ServerCtx,
  input: I,
  baseVersion?: number,
) => {
  if (baseVersion === undefined)
    throw new PrepareRejection("BASE_VERSION_REQUIRED");
  return { ...input, baseVersion };
};
const passthrough = async <I>(_ctx: ServerCtx, input: I) => input;

type Lines = Array<{ itemIndex: number; productId: string; qty: number }>;
interface StoredItem {
  productId: string;
  productName: string;
  productNameBn: string;
  unit: string;
  unitPrice?: number;
  unitCost?: number;
  qty: number;
}

/** Rebuilds a return's lines from the original document, so the refund is what was really paid. */
function rebuildLines(
  items: StoredItem[],
  lines: Lines,
  amountField: "unitPrice" | "unitCost",
) {
  return lines.map((line) => {
    const item = items[line.itemIndex];
    if (!item || item.productId !== line.productId)
      throw new PrepareRejection("INVALID_LINE");
    return {
      itemIndex: line.itemIndex,
      productId: item.productId,
      productName: item.productName,
      productNameBn: item.productNameBn ?? "",
      unit: item.unit,
      qty: line.qty,
      [amountField]: item[amountField] ?? 0,
    };
  });
}

/**
 * A SKU or barcode may belong to one product of the shop. Checked here, inside the same
 * transaction as the save, so two people saving at once cannot both take it (the form used to ask
 * the server first, in a separate request, and then save).
 */
async function ensureUniqueCodes(
  ctx: ServerCtx,
  codes: { sku?: string; barcode?: string },
  ignoreId?: string,
) {
  for (const field of ["barcode", "sku"] as const) {
    const value = (codes[field] ?? "").trim();
    if (!value) continue;
    const clash = await ctx.db.collection("products").findOne(
      {
        storeId: ctx.storeId,
        deletedAt: null,
        [field]: value,
        ...(ignoreId ? { _id: { $ne: ignoreId } } : {}),
      } as never,
      { session: ctx.session, projection: { _id: 1 } },
    );
    if (clash)
      throw new PrepareRejection(
        field === "sku" ? "DUPLICATE_SKU" : "DUPLICATE_BARCODE",
      );
  }
}

export const preparePayload: {
  [T in CommandType]: (
    ctx: ServerCtx,
    input: CommandInput<T>,
    baseVersion?: number,
  ) => Promise<unknown>;
} = {
  "category.create": passthrough,
  "category.update": withBase,
  "category.delete": withBase,

  "product.create": async (ctx, input) => {
    await ensureUniqueCodes(ctx, input);
    if (input.sku.trim()) return input;
    // A blank SKU gets the next free short number (skipping any already typed in by hand).
    const products = ctx.db.collection("products");
    for (let guard = 0; guard < 50; guard++) {
      const sku = onlineSku(await nextCount(ctx, "sku"));
      const taken = await products.findOne(
        { storeId: ctx.storeId, deletedAt: null, sku },
        { session: ctx.session, projection: { _id: 1 } },
      );
      if (!taken) return { ...input, sku };
    }
    throw new PrepareRejection("SKU_UNAVAILABLE");
  },
  "product.update": async (ctx, input, baseVersion) => {
    await ensureUniqueCodes(ctx, input.changes, input.id);
    return withBase(ctx, input, baseVersion);
  },
  "product.delete": withBase,
  "stock.adjust": passthrough,

  "customer.create": passthrough,
  "customer.update": withBase,
  "customer.delete": withBase,

  "sale.create": async (ctx, input) => {
    const ids = [...new Set(input.lines.map((l) => l.productId))];
    // Every product of THIS shop, deleted ones too (a product deleted a moment ago still sells).
    const found = await ctx.db
      .collection<Doc>("products")
      .find(
        { _id: { $in: ids }, storeId: ctx.storeId },
        { session: ctx.session },
      )
      .toArray();
    // An id that is not one of this shop's products at all (another shop's, or made up) is refused,
    // so a sale can never carry a reference into someone else's records.
    if (found.length !== ids.length) throw new PrepareRejection("NOT_FOUND");
    const products = new Map(found.map((p) => [p._id, p]));
    ctx.scratch?.set(
      `products:${ids.slice().sort().join(",")}`,
      new Map(found.filter((p) => p.deletedAt == null).map((p) => [p._id, p])),
    );
    // What an item costs and is listed at comes from the shop's records, not from the browser.
    const lines = input.lines.map((line) => {
      const product = products.get(line.productId);
      return product
        ? {
            ...line,
            listPrice: Number(product.sellingPrice ?? line.listPrice),
            unitCost: Number(product.purchasePrice ?? 0),
          }
        : line;
    });
    const customer = input.customerId
      ? await find(ctx, "customers", input.customerId)
      : null;
    // A customer that is not in THIS shop (an id of another shop, or a made-up one) is refused, so a
    // sale can never carry a reference into someone else's records.
    if (input.customerId && !customer) throw new PrepareRejection("NOT_FOUND");
    if (customer) ctx.scratch?.set(`customer:${customer._id}`, customer);
    return {
      ...input,
      lines,
      customerName: customer ? String(customer.name) : input.customerName,
      customerPhone: customer ? String(customer.phone ?? "") : "",
      invoiceNo: await documentNumber(ctx, ""),
    };
  },
  "sale.void": async (ctx, input) => {
    const sale = await find(ctx, "sales", input.saleId);
    if (!sale) throw new PrepareRejection("NOT_FOUND");
    const items = (sale.items as StoredItem[]) ?? [];
    return {
      ...input,
      customerId: (sale.customerId as string | null) ?? null,
      // What the sale put on the balance: its due plus the store credit it used up.
      due: Number(sale.due ?? 0) + Number(sale.creditUsed ?? 0),
      lines: items.map((i) => ({ productId: i.productId, qty: i.qty })),
    };
  },

  "supplier.create": passthrough,
  "supplier.update": withBase,
  "supplier.delete": withBase,
  "purchase.create": async (ctx, input) => ({
    ...input,
    purchaseNo: await documentNumber(ctx, "P"),
  }),

  "party.openingBalance": passthrough,
  "payment.collect": passthrough,
  "payment.pay": passthrough,
  "expense.create": passthrough,
  "expense.void": passthrough,
  "payment.void": passthrough,

  "saleReturn.create": async (ctx, input) => {
    const sale = await find(ctx, "sales", input.saleId);
    if (!sale || sale.status === "voided")
      throw new PrepareRejection("NOT_FOUND");
    if (
      input.cashBack === undefined &&
      input.settlement === "credit" &&
      !sale.customerId
    )
      throw new PrepareRejection("NO_CUSTOMER");
    return {
      ...input,
      lines: rebuildLines(
        (sale.items as StoredItem[]) ?? [],
        input.lines,
        "unitPrice",
      ),
      customerId: (sale.customerId as string | null) ?? null,
      returnNo: await documentNumber(ctx, "R"),
    };
  },
  "purchaseReturn.create": async (ctx, input) => {
    const purchase = await find(ctx, "purchases", input.purchaseId);
    if (!purchase) throw new PrepareRejection("NOT_FOUND");
    if (
      input.cashBack === undefined &&
      input.settlement === "credit" &&
      !purchase.supplierId
    )
      throw new PrepareRejection("NO_SUPPLIER");
    return {
      ...input,
      lines: rebuildLines(
        (purchase.items as StoredItem[]) ?? [],
        input.lines,
        "unitCost",
      ),
      supplierId: (purchase.supplierId as string | null) ?? null,
      returnNo: await documentNumber(ctx, "PR"),
    };
  },

  "setting.set": async (ctx, input) => {
    const existing = await ctx.db
      .collection<{ _id: string; version?: number }>("settings")
      .findOne(
        { _id: `${ctx.storeId}:${input.key}` },
        { session: ctx.session },
      );
    return { ...input, baseVersion: existing?.version ?? 0 };
  },
};
