import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { getDb } from "@/db/server/mongo";
import { exportShop } from "@/server/shop-export";

/**
 * Backs up ONE shop to a file (one record per line).
 *   pnpm shop:export --store <shop id or the owner's username> [--out file]
 * The file holds everything of that shop and nothing of any other. It includes password hashes (so
 * people can sign in after a restore): keep it as safe as a password file.
 */
const flags = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  const next = argv[i + 1];
  if (next !== undefined && !next.startsWith("--")) {
    flags.set(argv[i].slice(2), next);
    i++;
  } else flags.set(argv[i].slice(2), "true");
}

const target = flags.get("store");
if (!target) {
  console.error(
    "Say which shop: pnpm shop:export --store <shop id or owner username> [--out file]",
  );
  process.exit(1);
}

const db = await getDb();
let storeId = target;
if (!(await db.collection("stores").findOne({ _id: target as never }))) {
  const user = await db
    .collection("user")
    .findOne({ username: target.toLowerCase() });
  if (!user?.storeId) {
    console.error(
      `No shop or username "${target}" in database "${db.databaseName}".`,
    );
    process.exit(1);
  }
  storeId = String(user.storeId);
}

const stamp = new Date().toISOString().slice(0, 10);
const out = flags.get("out") ?? `shop-${storeId.slice(0, 8)}-${stamp}.ndjson`;
const stream = createWriteStream(out, { encoding: "utf8" });
const header = await exportShop(db, storeId, async (line) => {
  if (!stream.write(`${line}\n`)) await once(stream, "drain");
});
stream.end();
await once(stream, "finish");

console.log(
  `\nBacked up "${header.storeName}" (${storeId}) from database "${db.databaseName}" to ${out}`,
);
console.log(
  Object.entries(header.counts)
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `  ${name}: ${n}`)
    .join("\n"),
);
console.log("\nThis file contains password hashes. Keep it private.");
process.exit(0);
