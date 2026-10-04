import "server-only";
import { type Db, ObjectId } from "mongodb";
import type { z } from "zod";
import { getAuth } from "@/auth/server";
import type { createStaffSchema, updateStaffSchema } from "@/schemas/staff";
import { clearStoreCaches } from "./cache";
import { createStoreUser } from "./onboarding";
import {
  clearPinAttempts,
  getStaffMember,
  type StaffMember,
  setStaffPin,
  updateStaff,
} from "./staff";

/**
 * Creates a staff login (needs Better Auth to hash the password) and, if given, stores their PIN
 * hash. Usernames are unique across all stores (see onboarding).
 */
export async function createStaffMember(
  db: Db,
  storeId: string,
  input: z.infer<typeof createStaffSchema>,
): Promise<StaffMember> {
  const user = await createStoreUser({
    storeId,
    username: input.username,
    displayName: input.name,
    password: input.password,
    role: input.role,
  });
  if (input.pin) await setStaffPin(db, storeId, user.id, input.pin);
  return (await getStaffMember(db, storeId, user.id)) as StaffMember;
}

/**
 * Applies an owner's edit. A deactivated person's sessions are ended at once (their next request
 * is refused), and a password reset replaces the stored credential.
 */
export async function updateStaffMember(
  db: Db,
  storeId: string,
  id: string,
  patch: z.infer<typeof updateStaffSchema>,
) {
  const { password, ...rest } = patch;
  const result = await updateStaff(db, storeId, id, rest);
  if (!result.ok) return result;

  if (password) {
    const ctx = await (await getAuth()).$context;
    await ctx.internalAdapter.updatePassword(
      id,
      await ctx.password.hash(password),
    );
  }
  if ((password || patch.isActive === false) && ObjectId.isValid(id)) {
    // A new password ends every session of that person (someone who had it must sign in again);
    // so does deactivating them.
    await db
      .collection("session")
      .deleteMany({ userId: { $in: [id, new ObjectId(id)] } as never });
  }
  if (password) await clearPinAttempts(db, id); // they signed in with a password: PIN tries start over
  if (patch.isActive === false) {
    // Devices the person registered stop working with them: a phone must not keep the shop's data
    // after its owner was let go. (The owner signs the shared counter in again.)
    await db
      .collection("devices")
      .updateMany(
        { storeId, createdBy: id, revokedAt: null } as never,
        { $set: { revokedAt: new Date() } } as never,
      );
    clearStoreCaches();
  }
  return result;
}
