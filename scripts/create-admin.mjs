// pnpm admin:create — creates an operator account for the /admin panel. See scripts/tasks/create-admin.ts.
import { runTs } from "./lib/run-ts.mjs";

await runTs("scripts/tasks/create-admin.ts");
