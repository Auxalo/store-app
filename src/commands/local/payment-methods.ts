import type { StoreDB } from "@/db/local/db";
import { methodSettingKey } from "@/lib/payment-methods";
import type { CommandInput, CommandPayload } from "../definitions";
import type { LocalContext } from "./registry";

/**
 * Saves one of the shop's payment methods (adds it, renames it, hides or shows it). It is a shop
 * setting, one record per method, so two devices adding different methods never clash. Hiding only
 * takes it out of the pickers: old records keep its name, so there is nothing to block.
 */
export async function paymentMethodSave(
  db: StoreDB,
  ctx: LocalContext,
  input: CommandInput<"paymentMethod.save">,
  now: string,
): Promise<CommandPayload<"paymentMethod.save">> {
  const key = methodSettingKey(input.code);
  const existing = await db.settings.get(key);
  await db.settings.put({
    id: key,
    key,
    value: { name: input.name, removed: input.removed },
    storeId: ctx.storeId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    updatedBy: ctx.actorUserId,
    deviceId: ctx.deviceId,
    version: (existing?.version ?? 0) + 1,
    deletedAt: null,
    syncSeq: existing?.syncSeq,
  });
  return { ...input, baseVersion: existing?.version ?? 0 };
}
