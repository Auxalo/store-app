// pnpm db:backfill-search — fills in the search fields on records saved before the server kept them.
// Safe to run again. Run once after deploying server-side search.
import { runTs } from "./lib/run-ts.mjs";

await runTs("scripts/tasks/backfill-search.ts");
