// Demo data: pnpm db:seed [--reset]. See scripts/seed/seed.ts. The database must be running
// (pnpm db:dev for the local one).
import { runTs } from "./lib/run-ts.mjs";

await runTs("scripts/seed/seed.ts");
