import Dexie, { type EntityTable } from "dexie";
import type { Category, MetaRow, OutboxOp, Setting } from "./types";

/**
 * The on-device database. The UI reads and writes only this; the sync engine moves data
 * between it and the server in the background.
 *
 * Schema rules: versions only add tables/indexes, and an upgrade never discards unsynced work.
 */
export class StoreDB extends Dexie {
  categories!: EntityTable<Category, "id">;
  settings!: EntityTable<Setting, "id">;
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
