import "server-only";
import { type Db, ObjectId } from "mongodb";
import type { z } from "zod";
import { getAuth } from "@/auth/server";
import type { createStaffSchema, updateStaffSchema } from "@/schemas/staff";
import { createStoreUser } from "./onboarding";
import {
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
  if (patch.isActive === false && ObjectId.isValid(id)) {
    await db
      .collection("session")
      .deleteMany({ userId: { $in: [id, new ObjectId(id)] } as never });
  }
  return result;
}
