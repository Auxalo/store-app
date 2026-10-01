"use client";

import { useCallback } from "react";
import { useProfile } from "@/auth/use-auth";
import type { CommandInput, CommandType } from "@/commands/definitions";
import { runCommand } from "@/commands/local/run";
import { getLocalDb } from "@/db/local/db";
import { getDeviceId } from "@/db/local/meta";
import { nudgeSync } from "./manager";

/**
 * `run("category.create", {...})` — saves on this device immediately, queues it for the server,
 * and asks the sync manager to send it soon. Resolves as soon as it is saved locally.
 */
export function useCommands() {
  const profile = useProfile();

  return useCallback(
    async <T extends CommandType>(type: T, input: CommandInput<T>) => {
      const db = getLocalDb();
      const ctx = {
        storeId: profile.storeId,
        actorUserId: profile.userId,
        role: profile.role,
        deviceId: await getDeviceId(db),
      };
      const result = await runCommand(db, ctx, type, input);
      nudgeSync();
      return result;
    },
    [profile.storeId, profile.userId, profile.role],
  );
}
