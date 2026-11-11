import type { Fill, UserFillsMessage } from "@/lib/hyperliquid/schemas";

import {
  aggregateFills,
  mergeFillIntoItems,
  mergeItemIntoItems,
  toFeedItem,
  type FeedItem,
} from "./aggregateFills";

/*
 * The live feed reducer. It is pure, so React StrictMode can run it twice.
 *
 * De-duplication has two layers:
 * - `seenTids`: every `user:tid` pair that is already in the feed (capped).
 *   The key holds the user because both sides of one trade share a tid,
 *   and two top traders can trade against each other.
 * - `watermarks`: the newest fill time per trader. After a reconnect the
 *   server sends the snapshot again. Snapshot fills older than the
 *   watermark are history that the feed already handled, even when their
 *   tid fell out of the capped `seenTids` set.
 */

export const MAX_FEED_ITEMS = 100;
export const MAX_SEEN_TIDS = 5_000;
export const SNAPSHOT_ITEMS_PER_TRADER = 20;

export interface LiveFeedStats {
  snapshots: number;
  liveMessages: number;
  /** Fills that were dropped because the feed already had them. */
  duplicatesDropped: number;
}

export interface LiveFeedState {
  /** Newest first, at most MAX_FEED_ITEMS. */
  items: FeedItem[];
  /** Insertion order is age order, so the oldest tids drop first. */
  seenTids: ReadonlySet<string>;
  watermarks: Readonly<Record<string, number>>;
  stats: LiveFeedStats;
}

export type LiveFeedAction = { type: "message"; message: UserFillsMessage };

export const initialLiveFeedState: LiveFeedState = {
  items: [],
  seenTids: new Set(),
  watermarks: {},
  stats: { snapshots: 0, liveMessages: 0, duplicatesDropped: 0 },
};

/** The de-duplication key of one fill. */
export function seenKey(user: string, tid: number): string {
  return `${user}:${tid}`;
}

function addTids(
  seen: ReadonlySet<string>,
  user: string,
  tids: readonly number[],
): ReadonlySet<string> {
  if (tids.length === 0) return seen;
  const next = new Set(seen);
  for (const tid of tids) next.add(seenKey(user, tid));
  if (next.size <= MAX_SEEN_TIDS) return next;
  return new Set([...next].slice(next.size - MAX_SEEN_TIDS));
}

function maxTime(fills: readonly Fill[], start: number | undefined): number | undefined {
  let max = start;
  for (const fill of fills) if (max === undefined || fill.time > max) max = fill.time;
  return max;
}

function applySnapshot(state: LiveFeedState, message: UserFillsMessage): LiveFeedState {
  const { user, fills } = message;
  const watermark = state.watermarks[user];
  const fresh = fills.filter(
    (fill) =>
      !state.seenTids.has(seenKey(user, fill.tid)) &&
      (watermark === undefined || fill.time >= watermark),
  );

  // Seed with the most recent orders only. Older history stays out of the feed.
  const kept = aggregateFills(fresh).slice(0, SNAPSHOT_ITEMS_PER_TRADER);
  let items = state.items;
  for (const aggregate of [...kept].reverse()) {
    items = mergeItemIntoItems(items, toFeedItem(aggregate, user, false));
  }

  const nextWatermark = maxTime(fills, watermark);
  return {
    items: items.slice(0, MAX_FEED_ITEMS),
    seenTids: addTids(
      state.seenTids,
      user,
      kept.flatMap((aggregate) => aggregate.tids),
    ),
    watermarks:
      nextWatermark === undefined
        ? state.watermarks
        : { ...state.watermarks, [user]: nextWatermark },
    stats: {
      ...state.stats,
      snapshots: state.stats.snapshots + 1,
      duplicatesDropped: state.stats.duplicatesDropped + (fills.length - fresh.length),
    },
  };
}

function applyLive(state: LiveFeedState, message: UserFillsMessage): LiveFeedState {
  const { user, fills } = message;
  const fresh = fills
    .filter((fill, index) => {
      if (state.seenTids.has(seenKey(user, fill.tid))) return false;
      // Drop a tid that repeats inside the same message.
      return fills.findIndex((other) => other.tid === fill.tid) === index;
    })
    .sort((a, b) => a.time - b.time || a.tid - b.tid);

  let items = state.items;
  for (const fill of fresh) items = mergeFillIntoItems(items, fill, { user, live: true });

  const watermark = state.watermarks[user];
  const nextWatermark = maxTime(fresh, watermark);
  return {
    items: items.slice(0, MAX_FEED_ITEMS),
    seenTids: addTids(
      state.seenTids,
      user,
      fresh.map((fill) => fill.tid),
    ),
    watermarks:
      nextWatermark === undefined || nextWatermark === watermark
        ? state.watermarks
        : { ...state.watermarks, [user]: nextWatermark },
    stats: {
      ...state.stats,
      liveMessages: state.stats.liveMessages + 1,
      duplicatesDropped: state.stats.duplicatesDropped + (fills.length - fresh.length),
    },
  };
}

export function liveFeedReducer(state: LiveFeedState, action: LiveFeedAction): LiveFeedState {
  switch (action.type) {
    case "message":
      return action.message.isSnapshot
        ? applySnapshot(state, action.message)
        : applyLive(state, action.message);
  }
}

export interface FeedIntegrity {
  items: number;
  /** Distinct user + oid pairs. Equal to `items` when no order shows twice. */
  uniqueOrders: number;
  /** user:tid pairs across all items. */
  tids: number;
  /** Distinct user:tid pairs. Equal to `tids` when no fill shows twice. */
  uniqueTids: number;
}

/** Counts that make duplicates visible on the dev page and in tests. */
export function feedIntegrity(items: readonly FeedItem[]): FeedIntegrity {
  const orders = new Set(items.map((item) => `${item.user}:${item.oid}`));
  const allTids = items.flatMap((item) => item.tids.map((tid) => seenKey(item.user, tid)));
  return {
    items: items.length,
    uniqueOrders: orders.size,
    tids: allTids.length,
    uniqueTids: new Set(allTids).size,
  };
}
