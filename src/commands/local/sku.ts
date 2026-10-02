import type { StoreDB } from "@/db/local/db";
import { getMeta, setMeta } from "@/db/local/meta";

/**
 * Automatic SKUs are short and easy to read: the device's code and a number, e.g. "A0042". Only this
 * device uses its code, so two devices working offline can never issue the same SKU. (Online, the
 * server issues plain numbers such as "00042", which can never clash with these.)
 */
const WIDTH = 4;

async function deviceCode(db: StoreDB, deviceId: string): Promise<string> {
  // Same fallback as document numbers: the random end of the id until the server assigns a code.
  return (
    (await getMeta(db, "deviceCode")) ??
    deviceId.replaceAll("-", "").slice(-4).toUpperCase()
  );
}

const format = (code: string, n: number) =>
  `${code}${String(n).padStart(WIDTH, "0")}`;

async function taken(db: StoreDB, sku: string): Promise<boolean> {
  const clash = await db.products
    .where("sku")
    .equals(sku)
    .filter((p) => !p.deletedAt)
    .first();
  return clash !== undefined;
}

/** The SKU the next product would get, without reserving it (shown as a hint in the form). */
export async function peekSku(db: StoreDB, deviceId: string): Promise<string> {
  const code = await deviceCode(db, deviceId);
  let n = ((await getMeta(db, "skuSeq")) ?? 0) + 1;
  while (await taken(db, format(code, n))) n++;
  return format(code, n);
}

/**
 * Gives a new product its SKU, inside the same transaction that creates it. A blank SKU gets the
 * next free number. A SKU typed by hand is kept as it is; if it happens to be in this device's own
 * series, the counter moves past it so it is never issued twice.
 */
export async function claimSku(
  db: StoreDB,
  deviceId: string,
  sku: string,
): Promise<string> {
  const code = await deviceCode(db, deviceId);
  const last = (await getMeta(db, "skuSeq")) ?? 0;
  const wanted = sku.trim();

  if (wanted) {
    const own = wanted.startsWith(code)
      ? /^\d+$/.exec(wanted.slice(code.length))
      : null;
    if (own && Number(own[0]) > last)
      await setMeta(db, "skuSeq", Number(own[0]));
    return wanted;
  }

  let n = last + 1;
  while (await taken(db, format(code, n))) n++;
  await setMeta(db, "skuSeq", n);
  return format(code, n);
}
