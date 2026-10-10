import { refreshStaff } from "@/auth/staff-cache";
import { loadSavedBilling } from "@/billing/client";
import { resolveDataMode } from "@/data/mode";
import { useDataModeStore } from "@/data/mode-store";
import { getLocalDb, type StoreDB } from "@/db/local/db";
import { getDeviceId, getMeta, setMeta } from "@/db/local/meta";
import { APP_VERSION } from "@/lib/app-version";
import { useConnectivity } from "@/stores/connectivity";
import { recoverInterrupted, resetBackoff, syncOnce } from "./engine";
import { syncOnlineOnce } from "./online-cycle";
import { pruneIfDue } from "./prune";
import { registerDevice } from "./register-device";
import {
  currentStaffVersion,
  markStaffRead,
  staffVersionMoved,
} from "./staff-version";
import { type SyncProblem, useSyncStore } from "./store";
import { createFetchTransport, TransportError } from "./transport";

/** How often a visible tab syncs by itself (a hidden tab does not: see startPeriodic). */
const PERIODIC_MS = 5 * 60_000;
/**
 * While the server cannot be reached: how long to wait before each check whether it is back. It
 * backs off so a long outage is not a request every few seconds, and starts over on the browser's
 * "online" event, when the tab is shown, and when something is saved.
 */
const PROBE_STEPS_MS = [4_000, 8_000, 16_000, 32_000, 60_000];
const PROBE_TIMEOUT_MS = 4_000;
/** Saved changes that are waiting out a retry delay are retried at least this often. */
const WAKE_MAX_MS = 60_000;
/** After a save, wait this long so a burst of saves becomes one request. */
const NUDGE_DEBOUNCE_MS = 2_000;
/** Coming back to the tab syncs at once, but not more often than this (quick tab flips). */
const VISIBLE_SYNC_GAP_MS = 15_000;
/** The people list is also re-read this often, in case a change was missed. */
const STAFF_MAX_AGE_MS = 60 * 60_000;

type RunReason = "full" | "nudge";

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

/**
 * Wipes everything on this device, its identity included. Used when a different store signs in.
 * The server ties a device to the shop it was registered for, so the new shop gets a new device
 * (otherwise it could never sync, and the old shop's invoice numbers could be issued again).
 */
async function resetForNewStore(db: StoreDB): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
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
  private runAgainFull = false;
  private nudgeFull = false;
  private probeStep = 0;
  private lastFullRunAt = 0;
  private ready = false;
  private staffAt = 0;
  private stopped = false;
  private nudgeTimer?: ReturnType<typeof setTimeout>;
  private wakeTimer?: ReturnType<typeof setTimeout>;
  private probeTimer?: ReturnType<typeof setTimeout>;
  private periodic?: ReturnType<typeof setInterval>;
  private cleanups: Array<() => void> = [];

  constructor(private readonly session: SyncSession) {}

  async start(): Promise<void> {
    const db = this.db;
    let deviceId = await getDeviceId(db);

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
      deviceId = await getDeviceId(db); // a new one: this is another shop's device
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
      this.probeStep = 0;
      void resetBackoff(db).then(() => this.run());
    });
    on(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") this.becameVisible();
      else this.stopPeriodic();
    });
    if (document.visibilityState === "visible") this.startPeriodic();

    this.run();
  }

  /** One interval per manager, and only while the tab is shown (a hidden tab asks nobody). */
  private startPeriodic(): void {
    clearInterval(this.periodic);
    if (this.stopped) return;
    this.periodic = setInterval(() => {
      if (navigator.onLine && document.visibilityState === "visible")
        void this.run();
    }, PERIODIC_MS);
  }

  private stopPeriodic(): void {
    clearInterval(this.periodic);
    this.periodic = undefined;
  }

  /** The tab is shown again: sync once (unless it just did), then keep going on the interval. */
  private becameVisible(): void {
    this.probeStep = 0;
    this.startPeriodic();
    const recent = Date.now() - this.lastFullRunAt < VISIBLE_SYNC_GAP_MS;
    // Something wrong (offline, paused) is looked at again at once, however recent the last try.
    if (!recent || useSyncStore.getState().problem !== null) void this.run();
  }

  stop(): void {
    this.stopped = true;
    for (const cleanup of this.cleanups) cleanup();
    clearInterval(this.periodic);
    clearTimeout(this.nudgeTimer);
    clearTimeout(this.wakeTimer);
    clearTimeout(this.probeTimer);
  }

  /**
   * The server could not be reached. Check every few seconds whether it is back, and when it is,
   * send at once: waiting out the retry delays (up to minutes) or the browser's "online" event
   * (late or missing on many phones) kept the app saying "Offline" long after the internet was back.
   */
  private probeUntilBack(): void {
    clearTimeout(this.probeTimer);
    if (this.stopped) return;
    const wait =
      PROBE_STEPS_MS[Math.min(this.probeStep, PROBE_STEPS_MS.length - 1)];
    this.probeStep++;
    this.probeTimer = setTimeout(async () => {
      if (this.stopped) return;
      // A hidden tab does not probe: showing it again checks at once (becameVisible).
      if (document.visibilityState === "hidden") return;
      let reachable = false;
      try {
        const response = await fetch("/api/health?probe=1", {
          cache: "no-store",
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        reachable = response.status < 500;
      } catch {
        reachable = false;
      }
      if (!reachable) return this.probeUntilBack();
      this.probeStep = 0;
      await resetBackoff(this.db);
      void this.run();
    }, wait);
  }

  /**
   * "Something changed locally": send it soon (debounced so a burst becomes one request). A nudge
   * only sends; other devices' changes come with the periodic sync and when the tab is shown.
   */
  nudge(reason: RunReason = "nudge"): void {
    if (!this.ready) return;
    this.probeStep = 0;
    if (reason === "full") this.nudgeFull = true;
    clearTimeout(this.nudgeTimer);
    this.nudgeTimer = setTimeout(() => {
      const full = this.nudgeFull;
      this.nudgeFull = false;
      void this.run(full ? "full" : "nudge");
    }, NUDGE_DEBOUNCE_MS);
  }

  async syncNow(): Promise<void> {
    if (!this.ready) return;
    await resetBackoff(this.db);
    await this.run("full");
  }

  private async run(reason: RunReason = "full"): Promise<void> {
    if (!this.ready || this.stopped) return;
    if (this.running) {
      this.runAgain = true;
      if (reason === "full") this.runAgainFull = true;
      return;
    }
    this.running = true;
    if (reason === "full") this.lastFullRunAt = Date.now();
    this.patch({ running: true });
    try {
      await exclusively(() => this.cycle(reason === "nudge"));
    } finally {
      this.running = false;
      this.patch({ running: false });
      if (this.runAgain) {
        this.runAgain = false;
        const full = this.runAgainFull;
        this.runAgainFull = false;
        this.nudge(full ? "full" : "nudge");
      }
      void this.scheduleWake();
    }
  }

  private async registerDevice(): Promise<void> {
    const code = await registerDevice(this.db);
    this.patch({ deviceCode: code });
  }

  private async cycle(light: boolean): Promise<void> {
    this.patch({ lastAttemptAt: Date.now() });
    const db = this.db;
    try {
      if (!(await getMeta(db, "deviceCode"))) await this.registerDevice();
      const deviceId = await getDeviceId(db);
      // Offline mode keeps a full copy of the shop; online mode only sends what is queued.
      // A cycle that follows a save only sends, when all is well (nothing wrong, first download done).
      const state = useSyncStore.getState();
      const skipPull = light && state.problem === null && state.initialSyncDone;
      const sync = () =>
        (useDataModeStore.getState().mode === "online"
          ? syncOnlineOnce
          : syncOnce)(db, this.transport, {
          deviceId,
          appVersion: APP_VERSION,
          skipPull,
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
      // Keep the offline "who is working?" list current. It is read when this page opens, when the
      // server says a person or PIN changed (the number that comes with every sync answer), and
      // at the latest once an hour.
      if (
        this.staffAt === 0 ||
        staffVersionMoved() ||
        Date.now() - this.staffAt > STAFF_MAX_AGE_MS
      ) {
        this.staffAt = Date.now();
        const version = currentStaffVersion();
        void refreshStaff(db).then((ok) => ok && markStaffRead(version));
      }
      void pruneIfDue(db).catch(() => undefined);
      // The server answered: whatever the browser's own flag says, the app is online.
      useConnectivity.getState().setOnline(true);
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
      if (problem === "network") this.probeUntilBack();
    }
  }

  /** Come back when the earliest backed-off operation becomes due. */
  private async scheduleWake(): Promise<void> {
    clearTimeout(this.wakeTimer);
    if (this.stopped) return;
    const next = await this.db.outbox.where("status").equals("pending").first();
    if (!next) return;
    const delay = Math.max(next.nextAttemptAt - Date.now(), 1_000);
    this.wakeTimer = setTimeout(() => this.run(), Math.min(delay, WAKE_MAX_MS));
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
