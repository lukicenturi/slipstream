import type { Fill } from "@/lib/hyperliquid/schemas";

/*
 * Fill aggregation. One order (oid) often fills in many small parts.
 * The feed and the profile show one row per order, not one per part.
 */

/** Partial fills of one order that arrive within this gap merge into one item. */
export const MERGE_WINDOW_MS = 60_000;

/** All fills of one order, summed. */
export interface AggregatedFill {
  oid: number;
  coin: string;
  dir: string;
  side: Fill["side"];
  /** Total size in coin units. */
  sz: number;
  /** Size-weighted average price (notional / size). */
  px: number;
  /** Sum of px * sz in USD. */
  notional: number;
  closedPnl: number;
  fee: number;
  /** Time of the latest fill in ms. */
  time: number;
  /** Time of the earliest fill in ms. */
  firstTime: number;
  fillCount: number;
  /** Trade ids, oldest first. */
  tids: number[];
}

/** One row of the live feed: an aggregated order of one trader. */
export interface FeedItem extends AggregatedFill {
  /** Stable React key: user, oid and the first tid. */
  id: string;
  /** Lower-case trader address. */
  user: string;
  /** True for fills that arrived live (they animate in). False for snapshot fills. */
  live: boolean;
}

const FLIP_TO_SHORT = "Long > Short";
const FLIP_TO_LONG = "Short > Long";

/**
 * Pick one direction for an order whose parts carry different `dir` values.
 * A flip order can report "Close Long" for some parts and "Open Short" for others.
 */
function combineDirs(dirs: readonly string[], latest: string): string {
  const unique = new Set(dirs);
  if (unique.size === 1) return latest;
  if (unique.has(FLIP_TO_SHORT)) return FLIP_TO_SHORT;
  if (unique.has(FLIP_TO_LONG)) return FLIP_TO_LONG;
  if (unique.has("Close Long") && unique.has("Open Short")) return FLIP_TO_SHORT;
  if (unique.has("Close Short") && unique.has("Open Long")) return FLIP_TO_LONG;
  return latest;
}

function byTimeAsc(a: Fill, b: Fill): number {
  return a.time - b.time || a.tid - b.tid;
}

/** Sort newest first. Ties keep a stable order by the first tid. */
function byTimeDesc(a: AggregatedFill, b: AggregatedFill): number {
  return b.time - a.time || (b.tids[0] ?? 0) - (a.tids[0] ?? 0);
}

function fromFills(oid: number, fills: readonly Fill[]): AggregatedFill {
  const sorted = [...fills].sort(byTimeAsc);
  // `sorted` is never empty: each group holds at least one fill.
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  let sz = 0;
  let notional = 0;
  let closedPnl = 0;
  let fee = 0;
  for (const fill of sorted) {
    sz += fill.sz;
    notional += fill.px * fill.sz;
    closedPnl += fill.closedPnl;
    fee += fill.fee;
  }
  return {
    oid,
    coin: last.coin,
    dir: combineDirs(
      sorted.map((fill) => fill.dir),
      last.dir,
    ),
    side: last.side,
    sz,
    px: sz > 0 ? notional / sz : last.px,
    notional,
    closedPnl,
    fee,
    time: last.time,
    firstTime: first.time,
    fillCount: sorted.length,
    tids: sorted.map((fill) => fill.tid),
  };
}

/**
 * Group the fills of one trader by order id. Returns one item per order,
 * newest first.
 */
export function aggregateFills(fills: readonly Fill[]): AggregatedFill[] {
  const groups = new Map<number, Fill[]>();
  for (const fill of fills) {
    const group = groups.get(fill.oid);
    if (group) group.push(fill);
    else groups.set(fill.oid, [fill]);
  }
  return [...groups].map(([oid, group]) => fromFills(oid, group)).sort(byTimeDesc);
}

/** Build a feed item from an aggregated order. */
export function toFeedItem(aggregate: AggregatedFill, user: string, live: boolean): FeedItem {
  const lower = user.toLowerCase();
  return {
    ...aggregate,
    id: `${lower}:${aggregate.oid}:${aggregate.tids[0] ?? aggregate.firstTime}`,
    user: lower,
    live,
  };
}

/** The time gap between two items. 0 when their time ranges overlap. */
function gapMs(a: AggregatedFill, b: AggregatedFill): number {
  return Math.max(0, Math.max(a.firstTime, b.firstTime) - Math.min(a.time, b.time));
}

/** Add the parts of `incoming` to `existing`. Keeps the id and live flag of `existing`. */
function combine(existing: FeedItem, incoming: AggregatedFill): FeedItem {
  const sz = existing.sz + incoming.sz;
  const notional = existing.notional + incoming.notional;
  const latest = incoming.time >= existing.time ? incoming : existing;
  const earliestFirst = incoming.firstTime < existing.firstTime;
  return {
    ...existing,
    coin: latest.coin,
    dir: combineDirs([existing.dir, incoming.dir], latest.dir),
    side: latest.side,
    sz,
    px: sz > 0 ? notional / sz : latest.px,
    notional,
    closedPnl: existing.closedPnl + incoming.closedPnl,
    fee: existing.fee + incoming.fee,
    time: Math.max(existing.time, incoming.time),
    firstTime: Math.min(existing.firstTime, incoming.firstTime),
    fillCount: existing.fillCount + incoming.fillCount,
    tids: earliestFirst
      ? [...incoming.tids, ...existing.tids]
      : [...existing.tids, ...incoming.tids],
  };
}

/**
 * Merge an aggregated order into the list. When an item with the same user
 * and oid lies within `windowMs`, the parts join that item. Otherwise a new
 * item is added. Returns a new list, newest first.
 */
export function mergeItemIntoItems(
  items: readonly FeedItem[],
  incoming: FeedItem,
  windowMs: number = MERGE_WINDOW_MS,
): FeedItem[] {
  let target = -1;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.user !== incoming.user || item.oid !== incoming.oid) continue;
    if (gapMs(item, incoming) > windowMs) continue;
    // Prefer the most recent matching item.
    if (target === -1 || item.time > items[target].time) target = index;
  }

  const next = [...items];
  if (target === -1) next.push(incoming);
  else next[target] = combine(next[target], incoming);
  return next.sort(byTimeDesc);
}

export interface MergeFillOptions {
  user: string;
  live: boolean;
  windowMs?: number;
}

/**
 * Merge one fill into the list. A late partial fill of an order joins the
 * existing item when it arrives within 60 s of it; later parts start a new item.
 */
export function mergeFillIntoItems(
  items: readonly FeedItem[],
  fill: Fill,
  options: MergeFillOptions,
): FeedItem[] {
  // aggregateFills returns exactly one item for one fill.
  const [aggregate] = aggregateFills([fill]);
  const item = toFeedItem(aggregate, options.user, options.live);
  return mergeItemIntoItems(items, item, options.windowMs);
}
