// pnpm db:check-duplicates — lists live products that share a SKU or barcode inside one shop.
import { runTs } from "./lib/run-ts.mjs";

await runTs("scripts/tasks/check-duplicates.ts");
