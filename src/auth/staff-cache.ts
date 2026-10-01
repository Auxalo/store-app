import type { StoreDB } from "@/db/local/db";
import type { LocalUser } from "@/db/local/types";

interface StaffRow {
  id: string;
  name: string;
  username: string;
  role: LocalUser["role"];
  isActive: boolean;
  pinSalt?: string;
  pinHash?: string;
}

/**
 * Copies the store's people (and their PIN hashes) onto this device so the lock screen works with
 * no internet. Wrong-PIN counters are kept across refreshes, and reset only when someone's PIN
 * actually changed. Failures are ignored: the device simply keeps the list it already has.
 */
export async function refreshStaff(db: StoreDB): Promise<void> {
  let rows: StaffRow[];
  try {
    const response = await fetch("/api/staff");
    if (!response.ok) return;
    rows = ((await response.json()) as { staff: StaffRow[] }).staff;
  } catch {
    return;
  }

  await db.transaction("rw", db.localUsers, async () => {
    const existing = new Map(
      (await db.localUsers.toArray()).map((u) => [u.userId, u]),
    );
    await db.localUsers.bulkPut(
      rows.map((row) => {
        const before = existing.get(row.id);
        const pinChanged = before?.pinHash !== row.pinHash;
        return {
          userId: row.id,
          name: row.name,
          username: row.username,
          role: row.role,
          isActive: row.isActive,
          pinSalt: row.pinSalt,
          pinHash: row.pinHash,
          failedPins: pinChanged ? 0 : (before?.failedPins ?? 0),
          lastFailedAt: pinChanged ? 0 : (before?.lastFailedAt ?? 0),
        };
      }),
    );
    const keep = new Set(rows.map((r) => r.id));
    await db.localUsers.bulkDelete(
      [...existing.keys()].filter((id) => !keep.has(id)),
    );
  });
}
