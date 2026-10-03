import { getDb } from "@/db/server/mongo";
import { ownerSignupSchema } from "@/schemas/auth";
import { createStoreWithOwner, UsernameTakenError } from "@/server/onboarding";
import { ask, parseFlags } from "../lib/prompt";

/**
 * Creates a shop and its owner account in the database from .env.local (or from MONGODB_URI /
 * MONGODB_DB if they are set). Asks for the shop name, the owner's name, the username to sign in
 * with (letters, numbers, . _ - ; a phone number works) and a password (typed without showing).
 * For scripting, pass --store, --name, --username and --password; --yes skips the question.
 */

const flags = parseFlags();

async function main() {
  const dbName =
    process.env.MONGODB_DB ?? "(default database of the connection)";
  console.log(`\nCreate a shop in the database: ${dbName}\n`);

  const input = {
    storeName: flags.get("store") ?? (await ask("Shop name: ")),
    ownerName: flags.get("name") ?? (await ask("Owner's name: ")),
    username:
      flags.get("username") ??
      (await ask("Username to sign in with (a phone number works): ")),
    password:
      flags.get("password") ??
      (await ask("Password (min 8 letters, hidden): ", true)),
  };

  const parsed = ownerSignupSchema.safeParse(input);
  if (!parsed.success) {
    const problems: Record<string, string> = {
      storeNameMin: "The shop name needs at least 2 letters.",
      ownerNameMin: "The owner's name needs at least 2 letters.",
      usernameMin: "The username needs at least 3 characters.",
      usernameMax: "The username can be at most 30 characters.",
      usernameFormat: "The username can only use letters, numbers, . _ and -",
      passwordMin: "The password needs at least 8 characters.",
      passwordMax: "The password can be at most 100 characters.",
    };
    for (const issue of parsed.error.issues)
      console.error(`- ${problems[issue.message] ?? issue.message}`);
    process.exit(1);
  }

  if (!flags.has("yes")) {
    console.log(
      `\nShop:      ${parsed.data.storeName}\nOwner:     ${parsed.data.ownerName}\nUsername:  ${parsed.data.username.toLowerCase()}\nDatabase:  ${dbName}\n`,
    );
    const answer = (await ask('Type "yes" to create it: '))
      .trim()
      .toLowerCase();
    if (answer !== "yes") {
      console.log("Nothing was created.");
      process.exit(0);
    }
  }

  await getDb(); // fail early, with a clear message, if the database cannot be reached
  try {
    const result = await createStoreWithOwner(parsed.data);
    console.log(
      `\nDone. The shop "${parsed.data.storeName}" was created (id ${result.storeId}).\nSign in with username "${parsed.data.username.toLowerCase()}" and the password you typed. The owner will be guided through first-time setup.`,
    );
  } catch (error) {
    if (error instanceof UsernameTakenError) {
      console.error(
        `\nThe username "${parsed.data.username.toLowerCase()}" is already used. Run it again with another one.`,
      );
      process.exit(1);
    }
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(
      "\nCould not create the shop:",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  });
