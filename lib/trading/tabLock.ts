import { z } from "zod";

/*
 * One trailing update at a time across every tab of this browser. Each
 * open tab runs the trailing stop tracker, so two tabs could send two
 * `modify` calls for one stop, and the slower one could move the stop
 * back. The tracker holds a Web Lock (`navigator.locks`) per owner and
 * coin around read, compute, `modify` and store, and skips the tick when
 * another tab holds it. Without Web Locks (an insecure context or an old
 * browser), a BroadcastChannel election picks one leader tab per owner,
 * and only the leader trails. Without either, the tab does not trail.
 */

/** The part of the browser's LockManager that the tracker uses. */
export interface TabLocks {
  request(
    name: string,
    options: { ifAvailable?: boolean },
    callback: (lock: object | null) => Promise<void>,
  ): Promise<void>;
}

/** The browser's Web Locks, or null when this context has none. */
export function browserLocks(): TabLocks | null {
  if (typeof navigator === "undefined" || !("locks" in navigator) || !navigator.locks) return null;
  return navigator.locks;
}

/**
 * Run `fn` while this tab holds the lock `name`.
 * - With Web Locks: `wait: false` (the tracker) runs only when the lock is
 *   free and skips otherwise; `wait: true` (a user action) waits for it.
 * - Without Web Locks: a user action runs; the tracker runs only in the
 *   leader tab (`isLeader`), else it skips.
 * Returns true when `fn` ran. Errors of `fn` pass through.
 */
export async function runExclusive(
  name: string,
  fn: () => Promise<void>,
  options: { wait: boolean; locks: TabLocks | null; isLeader?: () => boolean },
): Promise<boolean> {
  const { wait, locks, isLeader } = options;
  if (locks) {
    let ran = false;
    await locks.request(name, wait ? {} : { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      ran = true;
      await fn();
    });
    return ran;
  }
  if (!wait && !(isLeader?.() ?? false)) return false;
  await fn();
  return true;
}

// ---------------------------------------------------------------------------
// Fallback: one leader tab per owner, chosen over a BroadcastChannel
// ---------------------------------------------------------------------------

/** Each tab says "I am here" this often. */
export const LEADER_BEAT_MS = 2_000;
/** A tab not heard from for this long is gone; a new tab waits this long before it may lead. */
export const LEADER_STALE_MS = 6_000;

export interface TabBeat {
  id: string;
  startedAt: number;
  /** When this tab last heard the beat. */
  at: number;
}

/**
 * True when this tab leads: it has listened for a full stale period, and no
 * live peer started before it (the id breaks a tie). The oldest tab leads,
 * so a new tab never takes over from a running one; when the leader closes,
 * the next one takes over only after its last beat is stale.
 */
export function isLeaderTab(
  self: { id: string; startedAt: number },
  peers: Iterable<TabBeat>,
  now: number,
): boolean {
  if (now - self.startedAt < LEADER_STALE_MS) return false;
  for (const peer of peers) {
    if (peer.id === self.id || now - peer.at > LEADER_STALE_MS) continue;
    if (peer.startedAt < self.startedAt) return false;
    if (peer.startedAt === self.startedAt && peer.id < self.id) return false;
  }
  return true;
}

const beatSchema = z.object({ id: z.string().min(1).max(64), startedAt: z.number().finite() });

export interface TabLeader {
  isLeader: () => boolean;
  close: () => void;
}

/** Join the election on channel `name`. Null when the browser has no BroadcastChannel. */
export function createTabLeader(name: string): TabLeader | null {
  if (typeof BroadcastChannel === "undefined") return null;
  const self = { id: Math.random().toString(36).slice(2, 12), startedAt: Date.now() };
  const peers = new Map<string, TabBeat>();
  const channel = new BroadcastChannel(name);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const beat = beatSchema.safeParse(event.data);
    if (beat.success) peers.set(beat.data.id, { ...beat.data, at: Date.now() });
  };
  const send = () => channel.postMessage({ id: self.id, startedAt: self.startedAt });
  send();
  const timer = setInterval(send, LEADER_BEAT_MS);
  return {
    isLeader: () => isLeaderTab(self, peers.values(), Date.now()),
    close: () => {
      clearInterval(timer);
      channel.close();
    },
  };
}
