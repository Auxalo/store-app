import Dexie, { type EntityTable } from "dexie";
import type {
  Category,
  Customer,
  Draft,
  Expense,
  LedgerEntry,
  MetaRow,
  OutboxOp,
  Payment,
  Product,
  Purchase,
  PurchaseItem,
  ReturnDoc,
  Sale,
  SaleItem,
  Setting,
  StockMovement,
  Supplier,
} from "./types";

/**
 * The on-device database. The UI reads and writes only this; the sync engine moves data
 * between it and the server in the background.
 *
 * Schema rules: versions only add tables/indexes, and an upgrade never discards unsynced work.
 */
export class StoreDB extends Dexie {
  categories!: EntityTable<Category, "id">;
  settings!: EntityTable<Setting, "id">;
  products!: EntityTable<Product, "id">;
  stockMovements!: EntityTable<StockMovement, "id">;
  customers!: EntityTable<Customer, "id">;
  sales!: EntityTable<Sale, "id">;
  saleItems!: EntityTable<SaleItem, "id">;
  ledgerEntries!: EntityTable<LedgerEntry, "id">;
  drafts!: EntityTable<Draft, "key">;
  suppliers!: EntityTable<Supplier, "id">;
  purchases!: EntityTable<Purchase, "id">;
  purchaseItems!: EntityTable<PurchaseItem, "id">;
  payments!: EntityTable<Payment, "id">;
  expenses!: EntityTable<Expense, "id">;
  returns!: EntityTable<ReturnDoc, "id">;
  outbox!: EntityTable<OutboxOp, "seq">;
  syncMeta!: EntityTable<MetaRow, "key">;

  constructor(name = "store-app") {
    super(name);
    this.version(1).stores({
      categories: "id, name, updatedAt, deletedAt",
      settings: "id",
      // seq gives strict creation order; [status+seq] serves "next pending batch".
      outbox: "++seq, &operationId, entityId, status, [status+seq]",
      syncMeta: "key",
    });

    // v2: products, the stock ledger, and a multi-entry index on the outbox so one operation can
    // touch several records. Existing queued operations get their entityIds filled in.
    this.version(2)
      .stores({
        products:
          "id, sku, barcode, categoryId, name, *searchWords, isActive, updatedAt, deletedAt",
        stockMovements: "id, productId, createdAt, [productId+createdAt]",
        outbox:
          "++seq, &operationId, entityId, *entityIds, status, [status+seq]",
      })
      .upgrade((tx) =>
        tx
          .table("outbox")
          .toCollection()
          .modify((op: { entityId: string; entityIds?: string[] }) => {
            op.entityIds ??= [op.entityId];
          }),
      );

    // v3: customers, sales (with their lines), the money ledger and unsaved drafts (the cart).
    this.version(3).stores({
      customers: "id, phone, name, *searchWords, deletedAt",
      sales: "id, invoiceNo, createdAt, customerId, status, [status+createdAt]",
      saleItems: "id, saleId, productId, createdAt",
      ledgerEntries: "id, partyId, createdAt, [partyId+createdAt]",
      drafts: "key",
    });

    // v4: suppliers, purchases (with their lines), payments, expenses and returns.
    this.version(4).stores({
      suppliers: "id, phone, name, *searchWords, deletedAt",
      purchases: "id, purchaseNo, date, createdAt, supplierId",
      purchaseItems: "id, purchaseId, productId, createdAt",
      payments: "id, partyId, partyType, createdAt",
      expenses: "id, date, category, status, createdAt",
      returns: "id, kind, refId, createdAt",
    });
  }
}

let instance: StoreDB | undefined;

/** The app-wide database (browser only). Tests create their own `StoreDB("name")` instead. */
export function getLocalDb(): StoreDB {
  if (!instance) {
    instance = new StoreDB();
    // Another tab upgraded the schema: release our connection so it can proceed, then reload.
    instance.on("versionchange", () => {
      instance?.close();
      if (typeof window !== "undefined") window.location.reload();
    });
  }
  return instance;
}
