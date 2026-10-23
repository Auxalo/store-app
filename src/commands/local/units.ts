import type { StoreDB } from "@/db/local/db";
import { unitSettingKey } from "@/lib/units";
import type { CommandInput, CommandPayload } from "../definitions";
import { ConflictError } from "../errors";
import type { LocalContext } from "./registry";

/**
 * Saves one of the shop's units (adds it, renames it, changes whole/loose, removes or restores it).
 * It is a shop setting, one record per unit, so two devices adding different units never clash.
 * A unit that a product still uses cannot be removed: those products would be left with a unit
 * nobody can pick.
 */
export async function unitSave(
  db: StoreDB,
  ctx: LocalContext,
  input: CommandInput<"unit.save">,
  now: string,
): Promise<CommandPayload<"unit.save">> {
  if (input.removed) {
    const inUse = await db.products
      .filter((p) => !p.deletedAt && p.unit === input.code)
      .count();
    if (inUse > 0) throw new ConflictError("UNIT_IN_USE");
  }
  const key = unitSettingKey(input.code);
  const existing = await db.settings.get(key);
  await db.settings.put({
    id: key,
    key,
    value: {
      name: input.name,
      decimals: input.decimals,
      removed: input.removed,
    },
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
