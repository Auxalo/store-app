import "server-only";
import { MongoClient } from "mongodb";
import { serverEnv } from "@/lib/env";

// Cached on globalThis so dev hot-reloads don't open a new connection pool each time.
const g = globalThis as unknown as { __mongoClient?: Promise<MongoClient> };

export function getMongoClient(): Promise<MongoClient> {
  if (!g.__mongoClient) {
    const client = new MongoClient(serverEnv().MONGODB_URI, {
      maxPoolSize: 10,
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
