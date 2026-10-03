import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { type Db, MongoClient } from "mongodb";
import { serverEnv } from "@/lib/env";

// Cached on globalThis so dev hot-reloads don't open a new connection pool each time, and so a
// warm serverless instance reuses one pool and one `Db` handle for every request.
const g = globalThis as unknown as {
  __mongoClient?: Promise<MongoClient>;
  __mongoDb?: Db;
};

export function getMongoClient(): Promise<MongoClient> {
  if (!g.__mongoClient) {
    const client = new MongoClient(serverEnv().MONGODB_URI, {
      maxPoolSize: 20,
      // Idle connections are closed after a minute, so a quiet instance does not hold them open.
      maxIdleTimeMS: 60_000,
      // If the database is unreachable, fail in seconds (the default is 30 s, which made the whole
      // app look frozen). The sync engine backs off and retries on its own.
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    // On Vercel, close idle connections before the function is paused (their recommendation for
    // MongoDB pools on serverless functions).
    if (process.env.VERCEL) attachDatabasePool(client);
    g.__mongoClient = client.connect().catch((error) => {
      g.__mongoClient = undefined; // allow a retry on the next request
      g.__mongoDb = undefined;
      throw error;
    });
  }
  return g.__mongoClient;
}

/**
 * The shop database. The same `Db` object is returned every time: the driver builds a new one on
 * every `client.db()` call, and code that remembers "set up once per Db" depends on that.
 */
export async function getDb() {
  const client = await getMongoClient();
  g.__mongoDb ??= client.db(serverEnv().MONGODB_DB);
  return g.__mongoDb;
}
