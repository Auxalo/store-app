"use client";

import { useCallback } from "react";
import { ensureSigningKey } from "@/auth/signing-key";
import { useProfile } from "@/auth/use-auth";
import type { CommandArgs, CommandType } from "@/commands/definitions";
import { runCommand } from "@/commands/local/run";
import { getLocalDb } from "@/db/local/db";
import { getDeviceId } from "@/db/local/meta";
import { useActiveUser } from "@/stores/active-user";
import { nudgeSync } from "./manager";

/** The signing key of the person working, when it is for this person. */
function signingKey(userId: string): string | undefined {
  const { proof } = useActiveUser.getState();
  return proof?.userId === userId ? proof.key : undefined;
}

/**
 * `run("category.create", {...})` — saves on this device immediately, queues it for the server,
 * and asks the sync manager to send it soon. Resolves as soon as it is saved locally.
 */
export function useCommands() {
  const profile = useProfile();

  return useCallback(
    async <T extends CommandType>(type: T, input: CommandArgs<T>) => {
      const db = getLocalDb();
      const ctx = {
        storeId: profile.storeId,
        actorUserId: profile.userId,
        role: profile.role,
        deviceId: await getDeviceId(db),
        // Signs the action so the server knows this person made it (src/auth/op-proof.ts). A tab
        // that has no key yet asks for it briefly; offline it saves unsigned and signs later.
        proofKey:
          signingKey(profile.userId) ??
          (await ensureSigningKey(profile.userId, 1_500)),
      };
      const result = await runCommand(db, ctx, type, input);
      nudgeSync();
      return result;
    },
    [profile.storeId, profile.userId, profile.role],
  );
}
