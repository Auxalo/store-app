import { can } from "@/auth/permissions";
import type { StoreDB } from "@/db/local/db";
import type { CommandInput, CommandPayload } from "../definitions";
import { AlreadyExistsError, ConflictError } from "../errors";
import type { LocalContext } from "./registry";

/**
 * Sets the cash in the drawer for a day. The first entry of a day is its opening (owner or manager);
 * once a day has one, only the owner may add another (a correction). Entries are never edited.
 */
export async function drawerSet(
  db: StoreDB,
  ctx: LocalContext,
  input: CommandInput<"drawer.set">,
  now: string,
): Promise<CommandPayload<"drawer.set">> {
  if (await db.cashDrawer.get(input.id)) throw new AlreadyExistsError("drawer");
  const already = await db.cashDrawer.where("day").equals(input.day).count();
  if (already > 0 && !can(ctx.role, "drawer.correct"))
    throw new ConflictError("DRAWER_ALREADY_SET");
  const kind = already > 0 ? "correct" : "open";
  await db.cashDrawer.add({
    id: input.id,
    storeId: ctx.storeId,
    day: input.day,
    amount: input.amount,
    kind,
    note: input.note,
    byName: input.byName,
    createdAt: now,
    updatedAt: now,
    createdBy: ctx.actorUserId,
    deviceId: ctx.deviceId,
    version: 1,
  });
  return { ...input, kind };
}
