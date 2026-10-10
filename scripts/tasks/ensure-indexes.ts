import { getDb } from "@/db/server/mongo";
import {
  ensureSyncIndexes,
  ensureUserIndexes,
} from "@/server/sync/collections";

const db = await getDb();
await ensureSyncIndexes(db);
await ensureUserIndexes(db);
console.log(`Indexes are in place in database "${db.databaseName}".`);
process.exit(0);
