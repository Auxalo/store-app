// Big-shop load test: MONGODB_DB=store_app_load node scripts/loadtest.mjs. See scripts/loadtest/loadtest.ts.
import { runTs } from "./lib/run-ts.mjs";

await runTs("scripts/loadtest/loadtest.ts");
