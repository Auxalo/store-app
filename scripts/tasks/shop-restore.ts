import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { getDb } from "@/db/server/mongo";
import { RestoreError, restoreShop } from "@/server/shop-export";

/**
 * Puts ONE shop back from a backup file.
 *   pnpm shop:restore <file> [--dry-run] [--replace] [--yes]
 * --dry-run  checks the file and says what it holds, writes nothing.
 * --replace  deletes that shop's current records first (only that shop), then restores. Without it,
 *            a shop that already exists is refused.
 * The file is checked completely first (shape, checksum, counts, every record belongs to the one
 * shop it names); a wrong or changed file is refused before anything is written.
 */
const file = process.argv[2];
const flags = new Set(process.argv.slice(3));
if (!file || file.startsWith("--")) {
  console.error(
    "Usage: pnpm shop:restore <file> [--dry-run] [--replace] [--yes]",
  );
  process.exit(1);
}

const lines = () =>
  createInterface({
    input: createReadStream(file, "utf8"),
    crlfDelay: Number.POSITIVE_INFINITY,
  });

const db = await getDb();
try {
  const check = await restoreShop(db, lines, { dryRun: true });
  console.log(
    `\nFile is good: "${check.header.storeName}" (${check.header.storeId}), made ${check.header.exportedAt}`,
  );
  console.log(
    Object.entries(check.counts)
      .map(([name, n]) => `  ${name}: ${n}`)
      .join("\n"),
  );
  if (flags.has("--dry-run")) {
    console.log("\nDry run: nothing was written.");
    process.exit(0);
  }

  console.log(`\nTarget database: ${db.databaseName}`);
  if (flags.has("--replace"))
    console.log(
      "--replace: this shop's CURRENT records will be deleted first.",
    );
  if (!flags.has("--yes")) {
    if (!process.stdin.isTTY) {
      console.error("Run in a terminal, or add --yes.");
      process.exit(1);
    }
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await new Promise<string>((resolve) =>
      rl.question('Type "yes" to restore: ', resolve),
    );
    rl.close();
    if (answer.trim().toLowerCase() !== "yes") {
      console.log("Nothing was changed.");
      process.exit(0);
    }
  }
  await restoreShop(db, lines, { replace: flags.has("--replace") });
  console.log(
    "\nDone. The shop is back; its people can sign in with their old passwords.",
  );
  process.exit(0);
} catch (error) {
  if (error instanceof RestoreError) {
    const why: Record<string, string> = {
      BAD_FILE: "The file is not a complete backup made by this app.",
      BAD_CHECKSUM: "The file was changed or damaged after it was made.",
      COUNT_MISMATCH: "The file does not hold what its header says.",
      FOREIGN_RECORD: "The file holds a record that is not this shop's.",
      SHOP_EXISTS:
        "This shop already exists here. Add --replace to replace it.",
      USERNAME_TAKEN:
        "A person of this shop has a username that now belongs to someone else.",
    };
    console.error(
      `\nRefused: ${why[error.code] ?? error.code} (${error.message})`,
    );
    process.exit(1);
  }
  throw error;
}
