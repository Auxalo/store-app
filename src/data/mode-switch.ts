import { SYNC_COLLECTIONS } from "@/commands/definitions";
import type { StoreDB } from "@/db/local/db";
import { getMeta } from "@/db/local/meta";
import { pullAll, pushAll } from "@/sync/engine";
import { type SyncTransport, TransportError } from "@/sync/transport";
import { type DataMode, setDataMode } from "./mode";
import { fetchHead } from "./online";

/** Why a switch did not happen: each has its own message on screen. */
export type SwitchProblem =
  | "NO_INTERNET"
  | "NO_SPACE"
  | "UNSENT"
  | "AUTH"
  | "FAILED";

export class SwitchError extends Error {
  constructor(public readonly problem: SwitchProblem) {
    super(problem);
    this.name = "SwitchError";
  }
}

/** A change record is about this big on the device, with its search words and indexes (a rough guess). */
const BYTES_PER_CHANGE = 2_000;
/** Always leave this much room, whatever the shop's size. */
const MIN_FREE_BYTES = 50 * 1024 * 1024;
/** One-time download: the biggest page the server allows. */
const DOWNLOAD_PAGE = 1000;

export interface DownloadSize {
  /** Changes still to download (the whole shop on a new device, only what is new on an old one). */
  changes: number;
  /** The position of the newest change on the server. */
  head: number;
}

/** How much there is to download, from one tiny request. */
export async function estimateDownload(db: StoreDB): Promise<DownloadSize> {
  const head = await fetchHead().catch((error: unknown) => {
    throw new SwitchError(
      error instanceof Error && error.message === "OFFLINE"
        ? "NO_INTERNET"
        : "FAILED",
    );
  });
  const cursor = (await getMeta(db, "cursor")) ?? 0;
  return { changes: Math.max(0, head - cursor), head };
}

export interface StorageCheck {
  /** The browser promised not to clear the data when space is low. */
  persisted: boolean;
  /** Free bytes, when the browser says. */
  free?: number;
}

export async function checkStorage(): Promise<StorageCheck> {
  const persisted = (await navigator.storage?.persisted?.()) ?? false;
  const estimate = await navigator.storage?.estimate?.();
  const free =
    estimate?.quota !== undefined && estimate.usage !== undefined
      ? estimate.quota - estimate.usage
      : undefined;
  return { persisted, free };
}

/** Is there room for this many changes? (Unknown counts as yes: some browsers do not say.) */
export function hasRoomFor(changes: number, free?: number): boolean {
  return (
    free === undefined || free >= changes * BYTES_PER_CHANGE + MIN_FREE_BYTES
  );
}

/**
 * Waits until the app's own files are saved for offline use (the service worker finishes saving
 * them before it takes over, so "ready" means they are all there). There is none in development.
 */
export async function appFilesReady(timeoutMs = 30_000): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return true;
  if (!("serviceWorker" in navigator)) return false;
  const ready = navigator.serviceWorker.ready.then(() => true);
  const timeout = new Promise<boolean>((resolve) =>
    setTimeout(() => resolve(false), timeoutMs),
  );
  return Promise.race([ready, timeout]);
}

/**
 * The download for "Work offline": everything the shop has, page by page, with progress. It can
 * be stopped and started again; each page is saved together with the position reached, so it
 * carries on where it stopped. The mode itself does not change here.
 */
export async function downloadForOffline(
  db: StoreDB,
  transport: SyncTransport,
  size: DownloadSize,
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  const start = (await getMeta(db, "cursor")) ?? 0;
  const total = Math.max(1, size.head - start);
  onProgress(0, total);
  try {
    await pullAll(db, transport, {
      limit: DOWNLOAD_PAGE,
      onProgress: (cursor) =>
        onProgress(Math.min(total, Math.max(0, cursor - start)), total),
    });
  } catch (error) {
    if (error instanceof TransportError) {
      throw new SwitchError(
        error.kind === "network"
          ? "NO_INTERNET"
          : error.kind === "auth"
            ? "AUTH"
            : "FAILED",
      );
    }
    throw error;
  }
  onProgress(total, total);
}

const CHANNEL = "sa-data-mode";

/** Tells the other tabs of this device that the mode changed, so they reload into it. */
export function announceModeChange(mode: DataMode) {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(mode);
    channel.close();
  } catch {
    /* no BroadcastChannel: other tabs pick the mode up the next time they load */
  }
}

/** Reload this tab when another tab of the device changes mode. Returns a stop function. */
export function onModeChangedElsewhere(handler: (mode: DataMode) => void) {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event) => handler(event.data as DataMode);
    return () => channel.close();
  } catch {
    return () => undefined;
  }
}

/** Saves the new mode and tells the other tabs. The caller reloads this tab. */
export async function commitMode(db: StoreDB, mode: DataMode) {
  await setDataMode(db, mode);
  announceModeChange(mode);
}

const UNSENT = ["pending", "syncing"] as const;

export async function unsentCount(db: StoreDB): Promise<number> {
  return db.outbox
    .where("status")
    .anyOf(...UNSENT)
    .count();
}

/** Changes that were refused or clash with someone else's: a person has to look at them. */
export async function needsAttentionCount(db: StoreDB): Promise<number> {
  return db.outbox.where("status").anyOf("failed", "conflict").count();
}

/**
 * Before going online: send everything waiting on the device. If anything could not be sent
 * (no connection, or refused and needing a decision) the switch does not happen, so nothing is
 * left behind on a device that no longer syncs it.
 */
export async function drainForOnline(
  db: StoreDB,
  transport: SyncTransport,
  options: { deviceId: string; appVersion: string },
): Promise<void> {
  try {
    await pushAll(db, transport, options);
  } catch (error) {
    if (error instanceof TransportError && error.kind === "network")
      throw new SwitchError("NO_INTERNET");
    throw new SwitchError("FAILED");
  }
  if ((await unsentCount(db)) > 0 || (await needsAttentionCount(db)) > 0)
    throw new SwitchError("UNSENT");
}

/**
 * Frees the space the shop's copy uses. Only when nothing is waiting to be sent. The next time
 * Work offline is turned on, it downloads again from the start. This device's own identity
 * (its id and code) and the PIN list stay.
 */
export async function removeOfflineData(db: StoreDB): Promise<void> {
  if ((await unsentCount(db)) > 0 || (await needsAttentionCount(db)) > 0)
    throw new SwitchError("UNSENT");
  await db.transaction("rw", db.tables, async () => {
    for (const collection of SYNC_COLLECTIONS)
      await db.table(collection).clear();
    await db.outbox.clear();
    await db.syncMeta.delete("cursor");
  });
}
