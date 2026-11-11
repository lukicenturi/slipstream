"use client";

import { useCallback, useSyncExternalStore } from "react";

import { parseWatchlist, toggleWatchlist, WATCHLIST_STORAGE_KEY } from "@/lib/watchlist";

/*
 * The watchlist store. One module-level list and one listener set, so
 * every FollowButton and the home strip stay in sync. localStorage can
 * throw (private mode, blocked storage), so every read and write is in
 * try/catch. When storage fails, the list still works for this session.
 */

const EMPTY: readonly string[] = [];
const listeners = new Set<() => void>();
let list: readonly string[] | null = null;

function readStorage(): readonly string[] {
  try {
    return parseWatchlist(window.localStorage.getItem(WATCHLIST_STORAGE_KEY));
  } catch {
    return EMPTY;
  }
}

function writeStorage(next: readonly string[]): void {
  try {
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage is not available. The in-memory list still holds the change.
  }
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** Another tab changed the list. */
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== WATCHLIST_STORAGE_KEY) return;
  list = readStorage();
  notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): readonly string[] {
  list ??= readStorage();
  return list;
}

function getServerSnapshot(): readonly string[] {
  return EMPTY;
}

function toggle(address: string): void {
  const next = toggleWatchlist(getSnapshot(), address);
  list = next;
  writeStorage(next);
  notify();
}

function isWatched(address: string): boolean {
  return getSnapshot().includes(address.toLowerCase());
}

/** Add an address. Does nothing when it is already in the list. */
function add(address: string): void {
  if (!isWatched(address)) toggle(address);
}

/** Remove an address. Does nothing when it is not in the list. */
function remove(address: string): void {
  if (isWatched(address)) toggle(address);
}

/** The followed addresses (lower-case) and helpers to change the list. */
export function useWatchlist() {
  const addresses = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isFollowing = useCallback(
    (address: string) => addresses.includes(address.toLowerCase()),
    [addresses],
  );
  return { addresses, isFollowing, toggle, add, remove };
}

/**
 * True when one address is in the watchlist. The snapshot is a boolean, so
 * a row re-renders only when its own address is added or removed.
 */
export function useIsWatched(address: string): boolean {
  const getAddressSnapshot = useCallback(() => isWatched(address), [address]);
  return useSyncExternalStore(subscribe, getAddressSnapshot, () => false);
}

export { toggle as toggleWatched };
