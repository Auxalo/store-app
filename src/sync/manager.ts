import { refreshStaff } from "@/auth/staff-cache";
import { loadSavedBilling } from "@/billing/client";
import { resolveDataMode } from "@/data/mode";
import { useDataModeStore } from "@/data/mode-store";
import { getLocalDb, type StoreDB } from "@/db/local/db";
import { getDeviceId, getMeta, setMeta } from "@/db/local/meta";
import { APP_VERSION } from "@/lib/app-version";
import { recoverInterrupted, resetBackoff, syncOnce } from "./engine";
import { syncOnlineOnce } from "./online-cycle";
import { pruneIfDue } from "./prune";
import { registerDevice } from "./register-device";
import { type SyncProblem, useSyncStore } from "./store";
import { createFetchTransport, TransportError } from "./transport";

const PERIODIC_MS = 60_000;
const NUDGE_DEBOUNCE_MS = 1_000;
const STAFF_EVERY_MS = 5 * 60_000;

export interface SyncSession {
  storeId: string;
}

/** Runs `job` in only one tab at a time (other tabs simply skip: they see the same data via IndexedDB). */
async function exclusively(job: () => Promise<void>): Promise<void> {
  if (!navigator.locks) return job();
  await navigator.locks.request(
    "store-sync",
    { ifAvailable: true },
    async (lock) => {
      if (lock) await job();
    },
  );
}

/** Wipes everything on this device except its identity. Used when a different store signs in. */
async function resetForNewStore(db: StoreDB): Promise<void> {
  const deviceId = await getDeviceId(db);
  await db.transaction("rw", db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    await setMeta(db, "deviceId", deviceId);
  });
}

/**
 * Keeps this device in sync in the background (spec §32): on open, on reconnect, when the tab
 * becomes visible again, after every change, and periodically. Returns a stop function.
 */
class SyncManager {
  private readonly db = getLocalDb();
  private readonly transport = createFetchTransport();
  private readonly patch = useSyncStore.getState().patch;
  private running = false;
  private runAgain = false;
  private ready = false;
  private staffAt = 0;
  private stopped = false;
  private nudgeTimer?: ReturnType<typeof setTimeout>;
  private wakeTimer?: ReturnType<typeof setTimeout>;
  private periodic?: ReturnType<typeof setInterval>;
  private cleanups: Array<() => void> = [];

  constructor(private readonly session: SyncSession) {}

  async start(): Promise<void> {
    const db = this.db;
    const deviceId = await getDeviceId(db);

    const storedStore = await getMeta(db, "storeId");
    if (storedStore && storedStore !== this.session.storeId) {
      const unsynced = await db.outbox
        .where("status")
        .anyOf("pending", "syncing", "failed", "conflict")
        .count();
      if (unsynced > 0) {
        // Never wipe work that has not reached the server.
        this.patch({ problem: "storeMismatch", deviceId });
        return;
      }
      await resetForNewStore(db);
    }
    await setMeta(db, "storeId", this.session.storeId);
    await loadSavedBilling();
    await recoverInterrupted(db);
    // The app was just opened: whatever was waiting out a delay is tried now.
    await resetBackoff(db);
    useDataModeStore.getState().set(await resolveDataMode(db));
    // Ask the browser not to evict our data under storage pressure.
    void navigator.storage?.persist?.();

    this.patch({
      deviceId,
      deviceCode: await getMeta(db, "deviceCode"),
      lastSyncAt: await getMeta(db, "lastSyncAt"),
      initialSyncDone: (await getMeta(db, "cursor")) !== undefined,
      problem: null,
    });
    if (this.stopped) return;
    this.ready = true;

    const on = (target: EventTarget, type: string, handler: () => void) => {
      target.addEventListener(type, handler);
      this.cleanups.push(() => target.removeEventListener(type, handler));
    };
    on(window, "online", () => {
      void resetBackoff(db).then(() => this.run());
    });
    on(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") this.run();
    });
    this.periodic = setInterval(() => {
      if (navigator.onLine) this.run();
    }, PERIODIC_MS);

    this.run();
  }

  stop(): void {
    this.stopped = true;
    for (const cleanup of this.cleanups) cleanup();
    clearInterval(this.periodic);
    clearTimeout(this.nudgeTimer);
    clearTimeout(this.wakeTimer);
  }

  /** "Something changed locally": sync soon (debounced so a burst becomes one request). */
  nudge(): void {
    if (!this.ready) return;
    clearTimeout(this.nudgeTimer);
    this.nudgeTimer = setTimeout(() => this.run(), NUDGE_DEBOUNCE_MS);
  }

  async syncNow(): Promise<void> {
    if (!this.ready) return;
    await resetBackoff(this.db);
    await this.run();
  }

  private async run(): Promise<void> {
    if (!this.ready || this.stopped) return;
    if (this.running) {
      this.runAgain = true;
      return;
    }
    this.running = true;
    this.patch({ running: true });
    try {
      await exclusively(() => this.cycle());
    } finally {
      this.running = false;
      this.patch({ running: false });
      if (this.runAgain) {
        this.runAgain = false;
        this.nudge();
      }
      void this.scheduleWake();
    }
  }

  private async registerDevice(): Promise<void> {
    const code = await registerDevice(this.db);
    this.patch({ deviceCode: code });
  }

  private async cycle(): Promise<void> {
    this.patch({ lastAttemptAt: Date.now() });
    const db = this.db;
    try {
      if (!(await getMeta(db, "deviceCode"))) await this.registerDevice();
      const deviceId = await getDeviceId(db);
      // Offline mode keeps a full copy of the shop; online mode only sends what is queued.
      const sync = () =>
        (useDataModeStore.getState().mode === "online"
          ? syncOnlineOnce
          : syncOnce)(db, this.transport, {
          deviceId,
          appVersion: APP_VERSION,
          onPullProgress: (pulledTo) => this.patch({ pulledTo }),
        });
      try {
        await sync();
      } catch (error) {
        // The device cookie may have been cleared: register again once, then retry.
        if (
          error instanceof TransportError &&
          error.kind === "auth" &&
          error.status === 401
        ) {
          await this.registerDevice();
          // The failed try put the queue on hold; now that the device is registered, ask again.
          await resetBackoff(db);
          await sync();
        } else {
          throw error;
        }
      }
      // Keep the offline "who is working?" list current. People and PINs change rarely, so every
      // few minutes is plenty (this used to download every PIN hash on every minute-long cycle).
      if (Date.now() - this.staffAt > STAFF_EVERY_MS) {
        this.staffAt = Date.now();
        void refreshStaff(db);
      }
      void pruneIfDue(db).catch(() => undefined);
      this.patch({
        problem: null,
        lastSyncAt: await getMeta(db, "lastSyncAt"),
        clockOffsetMs: await getMeta(db, "clockOffsetMs"),
        initialSyncDone: true,
      });
    } catch (error) {
      const problem: SyncProblem =
        error instanceof TransportError
          ? (error.kind as SyncProblem)
          : "server";
      this.patch({ problem });
    }
  }

  /** Come back when the earliest backed-off operation becomes due. */
  private async scheduleWake(): Promise<void> {
    clearTimeout(this.wakeTimer);
    if (this.stopped) return;
    const next = await this.db.outbox.where("status").equals("pending").first();
    if (!next) return;
    const delay = Math.max(next.nextAttemptAt - Date.now(), 1_000);
    this.wakeTimer = setTimeout(() => this.run(), Math.min(delay, PERIODIC_MS));
  }
}

let active: SyncManager | undefined;

/** Starts background sync for the signed-in store. Safe to call again; returns a stop function. */
export function startSyncManager(session: SyncSession): () => void {
  active?.stop();
  const manager = new SyncManager(session);
  active = manager;
  void manager.start();
  return () => {
    manager.stop();
    if (active === manager) active = undefined;
  };
}

/** Call after any local change. */
export function nudgeSync(): void {
  active?.nudge();
}

/** The "Sync now" button. */
export function syncNow(): Promise<void> {
  return active?.syncNow() ?? Promise.resolve();
}
