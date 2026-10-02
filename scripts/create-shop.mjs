// pnpm shop:create — creates a shop and its owner account in the database from .env.local.
// It asks for the shop name, the owner's name, a username and a password. See scripts/tasks/create-shop.ts.
import { runTs } from "./lib/run-ts.mjs";

await runTs("scripts/tasks/create-shop.ts");
