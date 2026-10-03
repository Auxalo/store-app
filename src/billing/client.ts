"use client";

import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { getLocalDb } from "@/db/local/db";
import { getMeta, setMeta } from "@/db/local/meta";
import {
  type BillingStamp,
  type BillingStatus,
  billingStateOf,
  effectiveNow,
} from "./state";

/**
 * The shop's billing on this device. The server sends it with every sync (head, pull) and with a
 * 402 refusal; it is kept on the device, so a device that is offline on the day the period ends
 * still locks itself (using the server's clock as last seen, never earlier than the latest server
 * time it has heard). Kept apart from the sync problems on purpose: a quiet sync cycle can never
 * clear it, only a newer word from the server.
 */
interface BillingClientState {
  stamp: BillingStamp | null;
  /** serverTime - deviceTime, from the last answer. */
  offsetMs: number;
  /** The latest server time heard (ms). */
  highWater: number;
  set: (patch: Partial<Omit<BillingClientState, "set">>) => void;
}

export const useBillingStore = create<BillingClientState>((set) => ({
  stamp: null,
  offsetMs: 0,
  highWater: 0,
  set: (patch) => set(patch),
}));

/**
 * What the server just said about billing. `sentAt` and `receivedAt` (device time around the
 * request) let the device's clock be corrected; without them the answer is taken as instant.
 */
export async function ingestStamp(
  stamp: BillingStamp | undefined | null,
  sentAt?: number,
  receivedAt?: number,
): Promise<void> {
  if (!stamp) return;
  const serverMs = Date.parse(stamp.serverTime);
  if (Number.isNaN(serverMs)) return;
  // Answers can arrive out of order (a slow request overtaken by a quicker one): the one the
  // server gave last is the truth, so an older one is ignored.
  const current = useBillingStore.getState().stamp;
  if (current && Date.parse(current.serverTime) > serverMs) return;
  const deviceMs =
    sentAt !== undefined && receivedAt !== undefined
      ? (sentAt + receivedAt) / 2
      : Date.now();
  const offsetMs = serverMs - deviceMs;
  const highWater = Math.max(useBillingStore.getState().highWater, serverMs);
  useBillingStore.getState().set({ stamp, offsetMs, highWater });
  try {
    const db = getLocalDb();
    await Promise.all([
      setMeta(db, "billing", stamp),
      setMeta(db, "billingClockHwm", highWater),
      setMeta(db, "clockOffsetMs", offsetMs),
    ]);
  } catch {
    /* the device database is unavailable: memory still has it for this session */
  }
}

/** Loads what this device last heard (when the app opens, before any answer from the server). */
export async function loadSavedBilling(): Promise<void> {
  try {
    const db = getLocalDb();
    const [stamp, highWater, offsetMs] = await Promise.all([
      getMeta(db, "billing"),
      getMeta(db, "billingClockHwm"),
      getMeta(db, "clockOffsetMs"),
    ]);
    // Something newer may already have arrived while this was loading.
    if (useBillingStore.getState().stamp) return;
    useBillingStore.getState().set({
      stamp: stamp ?? null,
      highWater: highWater ?? 0,
      offsetMs: offsetMs ?? 0,
    });
  } catch {
    /* nothing saved */
  }
}

/** "Now" as this device's best guess of the server's clock. */
export function billingNow(): number {
  const { offsetMs, highWater } = useBillingStore.getState();
  return effectiveNow(Date.now(), offsetMs, highWater);
}

const RECHECK_MS = 60_000;

/** Where the shop stands right now. Re-checked every minute, so the lock comes at midnight. */
export function useBillingStatus(): BillingStatus {
  const stamp = useBillingStore((s) => s.stamp);
  const offsetMs = useBillingStore((s) => s.offsetMs);
  const highWater = useBillingStore((s) => s.highWater);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), RECHECK_MS);
    return () => clearInterval(timer);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` re-runs it as time passes
  return useMemo(
    () => billingStateOf(stamp, effectiveNow(Date.now(), offsetMs, highWater)),
    [stamp, offsetMs, highWater, tick],
  );
}
