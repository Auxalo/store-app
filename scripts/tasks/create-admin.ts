import { getDb } from "@/db/server/mongo";
import { PLATFORM_STORE_ID } from "@/lib/constants";
import { passwordSchema, usernameSchema } from "@/schemas/auth";
import { createStoreUser, UsernameTakenError } from "@/server/onboarding";
import { ask, parseFlags } from "../lib/prompt";

/**
 * Creates an operator account (the person who runs the service) for the /admin panel.
 *   pnpm admin:create
 * It asks for a name, a username and a password (typed without showing). An operator belongs to no
 * shop and cannot open any shop's data; the flag that makes them one can only be set here.
 */
const flags = parseFlags();
const db = await getDb();
console.log(
  `\nCreate an operator account in the database: ${db.databaseName}\n`,
);

const name = flags.get("name") ?? (await ask("Your name: "));
const username =
  flags.get("username") ?? (await ask("Username to sign in with: "));
const password =
  flags.get("password") ??
  (await ask("Password (min 8 letters, hidden): ", true));

const u = usernameSchema.safeParse(username);
const p = passwordSchema.safeParse(password);
if (name.trim().length < 2 || !u.success || !p.success) {
  console.error(
    "The name needs 2+ letters, the username 3-30 letters/numbers/. _ -, the password 8+ characters.",
  );
  process.exit(1);
}
if (!flags.has("yes")) {
  const answer = (
    await ask(`Type "yes" to create operator "${username.toLowerCase()}": `)
  )
    .trim()
    .toLowerCase();
  if (answer !== "yes") {
    console.log("Nothing was created.");
    process.exit(0);
  }
}
try {
  const user = await createStoreUser({
    storeId: PLATFORM_STORE_ID,
    username,
    displayName: name.trim(),
    password,
    role: "owner",
  });
  await db
    .collection("user")
    .updateOne(
      { username: username.toLowerCase() },
      { $set: { platformAdmin: true } },
    );
  console.log(
    `\nDone (id ${user.id}). Open /admin on your site and sign in with "${username.toLowerCase()}".`,
  );
} catch (error) {
  if (error instanceof UsernameTakenError) {
    console.error(
      `\nThe username "${username.toLowerCase()}" is already used.`,
    );
    process.exit(1);
  }
  throw error;
}
process.exit(0);
