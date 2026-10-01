import { newId } from "@/lib/ids";
import type { StoreDB } from "./db";
import type { MetaValues } from "./types";

export async function getMeta<K extends keyof MetaValues>(
  db: StoreDB,
  key: K,
): Promise<MetaValues[K] | undefined> {
  return (await db.syncMeta.get(key))?.value as MetaValues[K] | undefined;
}

export async function setMeta<K extends keyof MetaValues>(
  db: StoreDB,
  key: K,
  value: MetaValues[K],
): Promise<void> {
  await db.syncMeta.put({ key, value });
}

/** This installation's identity. Created once and never changes (spec §47). */
export function getDeviceId(db: StoreDB): Promise<string> {
  return db.transaction("rw", db.syncMeta, async () => {
    const existing = await getMeta(db, "deviceId");
    if (existing) return existing;
    const id = newId();
    await setMeta(db, "deviceId", id);
    return id;
  });
}
