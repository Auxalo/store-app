import { getDb } from "@/db/server/mongo";
import { backfillSearchFields } from "@/server/backfill-search";

const db = await getDb();
const updated = await backfillSearchFields(db);
console.log("Search fields filled in:", JSON.stringify(updated));
process.exit(0);
