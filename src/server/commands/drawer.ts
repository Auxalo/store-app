import { can } from "@/auth/permissions";
import type { CommandPayload } from "@/commands/definitions";
import { dayKey } from "@/reports/compute";
import type { WireChange } from "@/schemas/sync";
import { writeAudit } from "../audit";
import { storeTimeZone } from "../data/service";
import { allocSeq } from "../sync/txn";
import { type StoredDoc, toWire } from "./master-data";
import type { ApplyResult, ServerCtx } from "./types";

type Entry = StoredDoc & {
  storeId: string;
  day: string;
  amount: number;
  createdAt: string;
};

const wire = (doc: unknown): WireChange => ({
  collection: "cashDrawer",
  doc: toWire(doc as StoredDoc),
});

/**
 * Sets the cash in the drawer for a day. The first entry of a day is its opening (owner or manager,
 * for today in the shop's time zone); once a day has one, only the owner may add another (a
 * correction, any day). Entries are only ever added, so two devices can never overwrite each other.
 */
export async function drawerSet(
  ctx: ServerCtx,
  p: CommandPayload<"drawer.set">,
): Promise<ApplyResult> {
  const entries = ctx.db.collection<Entry>("cashDrawer");
  const existing = await entries.findOne({ _id: p.id } as never, {
    session: ctx.session,
  });
  if (existing) {
    return existing.storeId === ctx.storeId
      ? { status: "applied", docs: [wire(existing)] }
      : { status: "rejected", error: "ID_COLLISION" };
  }
  const canCorrect = can(ctx.role, "drawer.correct");
  const earlier = await entries
    .find({ storeId: ctx.storeId, day: p.day }, { session: ctx.session })
    .sort({ createdAt: -1 })
    .toArray();
  if (earlier.length > 0 && !canCorrect)
    return { status: "rejected", error: "DRAWER_ALREADY_SET" };
  if (!canCorrect) {
    const timeZone = await storeTimeZone(ctx.db, ctx.storeId);
    if (p.day !== dayKey(ctx.opCreatedAt, timeZone))
      return { status: "rejected", error: "FORBIDDEN" };
  }

  const syncSeq = await allocSeq(ctx.db, ctx.session, ctx.storeId);
  const kind = earlier.length > 0 ? "correct" : "open";
  const entry = {
    _id: p.id,
    storeId: ctx.storeId,
    day: p.day,
    amount: p.amount,
    kind,
    note: p.note,
    byName: p.byName,
    createdAt: ctx.opCreatedAt,
    updatedAt: ctx.opCreatedAt,
    createdBy: ctx.actorUserId,
    deviceId: ctx.deviceId,
    version: 1,
    syncSeq,
  };
  await entries.insertOne(entry as never, { session: ctx.session });
  if (kind === "correct")
    await writeAudit(ctx, {
      action: "drawer.correct",
      entity: "cashDrawer",
      entityId: p.id,
      oldValue: { day: p.day, amount: earlier[0]?.amount },
      newValue: { day: p.day, amount: p.amount },
    });
  return { status: "applied", docs: [wire(entry)] };
}
