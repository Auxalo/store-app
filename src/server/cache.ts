/**
 * Tiny in-memory cache with an expiry, for the things every request would otherwise read from the
 * database again: who this device is, whether the shop uses PINs, a person's role, the shop's time
 * zone. Each server process has its own copy, so a change made on another instance can take up to
 * the expiry (10 to 30 seconds) to show here; a change made on THIS instance clears the cache at
 * once (see `clearStoreCaches`). Concurrent loads of the same key share one database read.
 */
export class TtlCache<V> {
  private readonly map = new Map<string, { value: V; expires: number }>();
  private readonly inflight = new Map<string, Promise<V | undefined>>();

  constructor(
    private readonly ttlMs: number,
    private readonly max = 5_000,
  ) {}

  get(key: string, now = Date.now()): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= now) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V, now = Date.now()): void {
    if (this.map.size >= this.max) {
      // Make room: drop what has expired, and if that is not enough, the oldest entry.
      for (const [k, v] of this.map) if (v.expires <= now) this.map.delete(k);
      if (this.map.size >= this.max) {
        const oldest = this.map.keys().next().value;
        if (oldest !== undefined) this.map.delete(oldest);
      }
    }
    this.map.set(key, { value, expires: now + this.ttlMs });
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
    this.inflight.clear();
  }

  /**
   * The cached value, or the result of `load`. Only a found value is remembered: `undefined`
   * ("not there") is asked again next time, so something created a moment later is seen at once.
   */
  async load(
    key: string,
    load: () => Promise<V | undefined>,
  ): Promise<V | undefined> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const running = this.inflight.get(key);
    if (running) return running;
    const promise = load()
      .then((value) => {
        if (value !== undefined) this.set(key, value);
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }
}

/** The caches themselves. Kept on globalThis so a hot reload in development starts fresh once. */
const g = globalThis as unknown as {
  __caches?: {
    devices: TtlCache<unknown>;
    users: TtlCache<unknown>;
    pins: TtlCache<boolean>;
    timeZones: TtlCache<string>;
    status: TtlCache<string>;
  };
};

g.__caches ??= {
  devices: new TtlCache(10_000),
  users: new TtlCache(10_000),
  pins: new TtlCache(10_000),
  timeZones: new TtlCache(30_000),
  status: new TtlCache(10_000),
};

export const caches = g.__caches;

/** After this server changes staff, PINs, devices or the shop itself, forget what it remembered. */
export function clearStoreCaches(): void {
  caches.devices.clear();
  caches.users.clear();
  caches.pins.clear();
  caches.timeZones.clear();
  caches.status.clear();
}
