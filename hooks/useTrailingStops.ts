"use client";

import { useCallback, useSyncExternalStore } from "react";

import { NETWORK } from "@/lib/network";
import { browserLocks, runExclusive } from "@/lib/trading/tabLock";
import {
  parseTrailingConfigs,
  trailingLockName,
  trailingStorageKey,
  type TrailingConfig,
} from "@/lib/trading/trailing";

import { createLocalStore, type LocalStore } from "./createLocalStore";

/*
 * The trailing stop configs of this browser, one localStorage key per
 * network and owner (`slipstream.trailing.<network>.<owner>`). An empty list
 * removes the key. Also a small flag that says whether the tracker runs in
 * this tab, so the sheet can say "Active in this tab".
 */

const EMPTY: readonly TrailingConfig[] = [];
const stores = new Map<string, LocalStore<TrailingConfig[] | null>>();

function parse(raw: string | null): TrailingConfig[] | null {
  const list = parseTrailingConfigs(raw);
  return list.length > 0 ? list : null;
}

function storeFor(owner: string): LocalStore<TrailingConfig[] | null> {
  const key = trailingStorageKey(NETWORK, owner);
  let store = stores.get(key);
  if (!store) {
    store = createLocalStore<TrailingConfig[] | null>(key, parse, null);
    stores.set(key, store);
  }
  return store;
}

/** The configs of an owner right now (for event handlers and the tracker). */
export function readTrailingConfigs(owner: string): readonly TrailingConfig[] {
  return storeFor(owner).getSnapshot() ?? EMPTY;
}

/**
 * The configs of an owner read again from localStorage, not from the cache.
 * Another tab may have written a moment ago, before its `storage` event
 * reached this tab. The tracker calls this inside the cross-tab lock.
 */
export function refreshTrailingConfigs(owner: string): readonly TrailingConfig[] {
  const store = storeFor(owner);
  let fresh: TrailingConfig[] | null;
  try {
    fresh = parse(window.localStorage.getItem(trailingStorageKey(NETWORK, owner)));
  } catch {
    return store.getSnapshot() ?? EMPTY;
  }
  if (JSON.stringify(fresh) !== JSON.stringify(store.getSnapshot())) store.update(() => fresh);
  return fresh ?? EMPTY;
}

/**
 * Run `fn` while this tab holds the cross-tab lock of the owner's trailing
 * stop on `coin` (see lib/trading/tabLock.ts). The tracker passes
 * `wait: false` and skips when another tab holds it; a user action passes
 * `wait: true`. Returns true when `fn` ran.
 */
export function withTrailingLock(
  owner: string,
  coin: string,
  fn: () => Promise<void>,
  options: { wait: boolean; isLeader?: () => boolean },
): Promise<boolean> {
  return runExclusive(trailingLockName(NETWORK, owner, coin), fn, {
    ...options,
    locks: browserLocks(),
  });
}

/**
 * Replace the configs of an owner with the result of `update`, and write
 * them. It reads localStorage again first, so a write for one coin (under
 * that coin's lock) never restores a stale entry of another coin that
 * another tab changed a moment ago.
 */
export function updateTrailingConfigs(
  owner: string,
  update: (current: readonly TrailingConfig[]) => readonly TrailingConfig[],
): void {
  refreshTrailingConfigs(owner);
  storeFor(owner).update((current) => {
    const next = update(current ?? EMPTY);
    return next.length > 0 ? [...next] : null;
  });
}

const noop = () => () => {};

/** The trailing stop configs of the owner, live. Empty without an owner. */
export function useTrailingConfigs(owner: string | undefined): readonly TrailingConfig[] {
  const subscribe = useCallback(
    (listener: () => void) => (owner ? storeFor(owner).subscribe(listener) : noop()),
    [owner],
  );
  const getSnapshot = useCallback(() => (owner ? storeFor(owner).getSnapshot() : null), [owner]);
  return useSyncExternalStore(subscribe, getSnapshot, () => null) ?? EMPTY;
}

// ---------------------------------------------------------------------------
// Tracker status
// ---------------------------------------------------------------------------

let trackerRunning = false;
const trackerListeners = new Set<() => void>();

/** The tracker calls this when it starts and stops watching (owner and agent present). */
export function setTrackerRunning(running: boolean): void {
  if (trackerRunning === running) return;
  trackerRunning = running;
  for (const listener of [...trackerListeners]) listener();
}

function subscribeTracker(listener: () => void): () => void {
  trackerListeners.add(listener);
  return () => {
    trackerListeners.delete(listener);
  };
}

/** True while the trailing stop tracker runs in this tab. */
export function useTrackerRunning(): boolean {
  return useSyncExternalStore(
    subscribeTracker,
    () => trackerRunning,
    () => false,
  );
}
