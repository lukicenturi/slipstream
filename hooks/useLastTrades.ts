"use client";

import { useCallback, useSyncExternalStore } from "react";

import type { FeedItem } from "@/lib/calc/aggregateFills";

/*
 * The last known order of each watched trader, from the tracker's feed
 * (snapshot and live). In memory only. A newer order replaces an older one;
 * an order that falls out of the capped feed stays here.
 */

const listeners = new Set<() => void>();
let lastTrades: ReadonlyMap<string, FeedItem> = new Map();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Record the newest item per trader. Called by WatchlistTracker. */
export function recordLastTrades(items: readonly FeedItem[]): void {
  let next: Map<string, FeedItem> | null = null;
  for (const item of items) {
    const current = (next ?? lastTrades).get(item.user);
    if (current && (current.time > item.time || current === item)) continue;
    next ??= new Map(lastTrades);
    next.set(item.user, item);
  }
  if (!next) return;
  lastTrades = next;
  for (const listener of [...listeners]) listener();
}

/** The last known order of one trader, or undefined. */
export function useLastTrade(address: string): FeedItem | undefined {
  const lower = address.toLowerCase();
  const getSnapshot = useCallback(() => lastTrades.get(lower), [lower]);
  return useSyncExternalStore(subscribe, getSnapshot, () => undefined);
}
