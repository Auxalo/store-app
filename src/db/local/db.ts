import Dexie, { type EntityTable } from "dexie";
import { derivedSearchFields } from "@/lib/search-fields";
import type {
  Category,
  Customer,
  Draft,
  Expense,
  LedgerEntry,
  LocalUser,
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
  localUsers!: EntityTable<LocalUser, "userId">;
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

    // v5: the people who can work on this device (for offline PIN sign-in).
    this.version(5).stores({ localUsers: "userId" });

    // v6: what lists search and sort by. Sales and purchases become searchable by number and by
    // buyer or supplier; products, customers and suppliers sort A-Z by a normalised `nameKey`.
    // The upgrade fills the new fields for what is already on the device.
    this.version(6)
      .stores({
        products:
          "id, sku, barcode, categoryId, name, nameKey, *searchWords, isActive, updatedAt, deletedAt",
        customers: "id, phone, name, nameKey, *searchWords, deletedAt",
        suppliers: "id, phone, name, nameKey, *searchWords, deletedAt",
        sales:
          "id, invoiceNo, createdAt, customerId, status, paymentMethod, *searchWords, [status+createdAt], [customerId+createdAt]",
        purchases: "id, purchaseNo, date, createdAt, supplierId, *searchWords",
      })
      .upgrade(async (tx) => {
        for (const name of ["products", "customers", "suppliers"] as const) {
          await tx
            .table(name)
            .toCollection()
            .modify((doc: Record<string, unknown>) => {
              Object.assign(doc, derivedSearchFields(name, doc));
            });
        }
        // A sale remembers its buyer's phone so it can be found by it; older ones read it from the customer.
        const phones = new Map<string, string>();
        for (const c of await tx.table("customers").toArray())
          phones.set(c.id, c.phone ?? "");
        await tx
          .table("sales")
          .toCollection()
          .modify((doc: Record<string, unknown>) => {
            doc.customerPhone ??= phones.get(String(doc.customerId)) ?? "";
            Object.assign(doc, derivedSearchFields("sales", doc));
          });
        await tx
          .table("purchases")
          .toCollection()
          .modify((doc: Record<string, unknown>) => {
            Object.assign(doc, derivedSearchFields("purchases", doc));
          });
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
