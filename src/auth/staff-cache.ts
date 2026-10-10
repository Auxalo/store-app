import type { StoreDB } from "@/db/local/db";
import type { LocalUser } from "@/db/local/types";

interface StaffRow {
  id: string;
  name: string;
  username: string;
  role: LocalUser["role"];
  isActive: boolean;
  hasPin?: boolean;
  pinSalt?: string;
  pinHash?: string;
}

/**
 * Copies the store's people (and the PIN hashes this device may hold) onto this device so the lock screen works with
 * no internet. Wrong-PIN counters are kept across refreshes, and reset only when someone's PIN
 * actually changed. Failures are ignored: the device simply keeps the list it already has.
 */
export async function refreshStaff(db: StoreDB): Promise<boolean> {
  let rows: StaffRow[];
  try {
    const response = await fetch("/api/staff");
    if (!response.ok) return false;
    rows = ((await response.json()) as { staff: StaffRow[] }).staff;
  } catch {
    return false;
  }

  await db.transaction("rw", db.localUsers, async () => {
    const existing = new Map(
      (await db.localUsers.toArray()).map((u) => [u.userId, u]),
    );
    await db.localUsers.bulkPut(
      rows.map((row) => {
        const before = existing.get(row.id);
        // The server sends a person's hash only where they may keep it; a hash this device already
        // has stays (as long as it is for the same PIN).
        const pinHash =
          row.pinHash ??
          (before?.pinSalt === row.pinSalt ? before?.pinHash : undefined);
        const pinChanged = before?.pinSalt !== row.pinSalt;
        return {
          userId: row.id,
          name: row.name,
          username: row.username,
          role: row.role,
          isActive: row.isActive,
          hasPin: row.hasPin ?? !!row.pinHash,
          pinSalt: row.pinSalt,
          pinHash,
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
  return true;
}
