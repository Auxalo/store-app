import "server-only";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins";
import { ObjectId } from "mongodb";
import { getMongoClient } from "@/db/server/mongo";
import { serverEnv } from "@/lib/env";

async function createAuth() {
  const env = serverEnv();
  const client = await getMongoClient();
  const db = client.db(env.MONGODB_DB);

  // The Mongo adapter does not create indexes; usernames must be unique across stores.
  await Promise.all([
    db
      .collection("user")
      .createIndex({ username: 1 }, { unique: true, sparse: true }),
    db.collection("user").createIndex({ email: 1 }, { unique: true }),
    db.collection("user").createIndex({ storeId: 1 }),
  ]);

  return betterAuth({
    appName: "Store Manager",
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: mongodbAdapter(db, { client }),
    // Accounts are created only by our own onboarding/staff routes (a user belongs to a store).
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 8,
    },
    user: {
      additionalFields: {
        storeId: { type: "string", required: true, input: false },
        role: {
          type: "string",
          required: true,
          input: false,
          defaultValue: "cashier",
        },
        isActive: {
          type: "boolean",
          required: false,
          input: false,
          defaultValue: true,
        },
      },
    },
    session: {
      // Shop terminals stay signed in for a long time; offline unlock (Phase 6) covers the gaps.
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    // A deactivated person cannot start a new session (existing ones are ended when they are
    // deactivated), so their password stops working at once.
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const user = ObjectId.isValid(session.userId)
              ? await db
                  .collection("user")
                  .findOne({ _id: new ObjectId(session.userId) })
              : null;
            if (user?.isActive === false) return false;
          },
        },
      },
    },
    // Brute-force protection stays on in production. Counters live in the database so they hold
    // across serverless instances. Only the e2e suite opts out, with an explicit variable.
    rateLimit: {
      storage: "database",
      ...(process.env.E2E_DISABLE_RATE_LIMIT === "1" ? { enabled: false } : {}),
    },
    plugins: [
      username({ minUsernameLength: 3, maxUsernameLength: 30 }),
      nextCookies(),
    ],
  });
}

export type Auth = Awaited<ReturnType<typeof createAuth>>;

const g = globalThis as unknown as { __auth?: Promise<Auth> };

export function getAuth(): Promise<Auth> {
  if (!g.__auth) {
    g.__auth = createAuth().catch((error) => {
      g.__auth = undefined;
      throw error;
    });
  }
  return g.__auth;
}
