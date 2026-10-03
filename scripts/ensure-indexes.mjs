// pnpm db:indexes — creates every index the app needs (safe to run again). Run it as part of a
// deploy, then set SKIP_RUNTIME_INDEXES=1 so servers do not re-check at start-up.
import { runTs } from "./lib/run-ts.mjs";

await runTs("scripts/tasks/ensure-indexes.ts");
