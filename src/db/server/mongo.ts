import "server-only";
import { MongoClient } from "mongodb";
import { serverEnv } from "@/lib/env";

// Cached on globalThis so dev hot-reloads don't open a new connection pool each time.
const g = globalThis as unknown as { __mongoClient?: Promise<MongoClient> };

export function getMongoClient(): Promise<MongoClient> {
  if (!g.__mongoClient) {
    const client = new MongoClient(serverEnv().MONGODB_URI, {
      maxPoolSize: 10,
      // If the database is unreachable, fail in seconds (the default is 30 s, which made the whole
      // app look frozen). The sync engine backs off and retries on its own.
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    g.__mongoClient = client.connect().catch((error) => {
      g.__mongoClient = undefined; // allow a retry on the next request
      throw error;
    });
  }
  return g.__mongoClient;
}

export async function getDb() {
  const client = await getMongoClient();
  return client.db(serverEnv().MONGODB_DB);
}
