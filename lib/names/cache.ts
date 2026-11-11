/*
 * A small in-memory TTL map. It stores misses (null) as well as hits, so a
 * repeated lookup for an address without a name costs nothing.
 * When it is full, the oldest entry goes first.
 */

export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(private readonly maxEntries = 10_000) {}

  /** The cached value in a box, or undefined when it is missing or expired. */
  get(key: string, now: number = Date.now()): { value: V } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return { value: entry.value };
  }

  set(key: string, value: V, ttlMs: number, now: number = Date.now()): void {
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expiresAt: now + ttlMs });
  }

  get size(): number {
    return this.entries.size;
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Forward results (name -> address): a hit stays 24 h, a miss 10 min. */
export const FORWARD_HIT_TTL_MS = 24 * HOUR;
export const FORWARD_MISS_TTL_MS = 10 * MINUTE;
/** Reverse results (address -> name), hit or miss. */
export const REVERSE_TTL_MS = HOUR;

/** One cache per server instance, keyed by `kind:value`. */
export const forwardCache = new TtlCache<string | null>();
export const reverseCache = new TtlCache<string | null>();
