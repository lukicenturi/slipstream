import type { Fill, Network, WatchRow } from "./schemas";
import { parseSeenTids } from "./schemas";
import { burstText, isSystemFill, noticeText, shortAddress } from "./text";

/*
 * The pure parts of the watcher: cursors, fill grouping, target selection,
 * delivery planning and push payloads. watch.ts wires them to D1, the info
 * endpoint and the push services.
 */

/** A new cursor starts this far back, so a new watch never notifies history. */
export const NEW_CURSOR_LOOKBACK_MS = 2 * 60_000;

/** More than this many trades for one subscription in one tick become one summary push. */
export const BURST_MAX = 3;

/** Deliveries older than this are pruned on each tick. */
export const DELIVERY_RETENTION_MS = 2 * 24 * 60 * 60_000;

/** A subscription is removed after this many push failures in a row. */
export const MAX_FAILURES = 10;

export interface Cursor {
  /** The newest fill time seen (ms). */
  lastTime: number;
  /** The tids of the fills at `lastTime`. */
  seenTids: readonly number[];
}

/** The cursor for an address. A missing cursor starts two minutes back. */
export function cursorOrStart(cursor: Cursor | null, now: number): Cursor {
  return cursor ?? { lastTime: now - NEW_CURSOR_LOOKBACK_MS, seenTids: [] };
}

/**
 * Keep the fills after the cursor. A fill at the cursor time is new only
 * when its tid is not in the seen list (the info call includes `startTime`).
 */
export function newFills(fills: readonly Fill[], cursor: Cursor): Fill[] {
  const seen = new Set(cursor.seenTids);
  return fills.filter(
    (fill) => fill.time > cursor.lastTime || (fill.time === cursor.lastTime && !seen.has(fill.tid)),
  );
}

/** Move the cursor to the newest fill. The tids at that time are kept for the next call. */
export function advanceCursor(cursor: Cursor, fills: readonly Fill[]): Cursor {
  let lastTime = cursor.lastTime;
  for (const fill of fills) if (fill.time > lastTime) lastTime = fill.time;
  const tids = new Set<number>(lastTime === cursor.lastTime ? cursor.seenTids : []);
  for (const fill of fills) if (fill.time === lastTime) tids.add(fill.tid);
  return { lastTime, seenTids: [...tids].sort((a, b) => a - b) };
}

/** One aggregated order of one trader: the unit of a push. */
export interface Item {
  /** `network:user:oid`. The push tag and the delivery key. */
  id: string;
  network: Network;
  user: string;
  oid: number;
  coin: string;
  dir: string;
  side: "buy" | "sell";
  sizeCoin: number;
  avgPx: number;
  notionalUsd: number;
  closedPnl: number;
  /** Time of the latest fill (ms). */
  time: number;
}

/** The tag of a system notification for one order. The app uses the same scheme. */
export function itemId(network: Network, user: string, oid: number): string {
  return `${network}:${user.toLowerCase()}:${oid}`;
}

function combineDirs(dirs: readonly string[], latest: string): string {
  const unique = new Set(dirs);
  if (unique.size === 1) return latest;
  if (unique.has("Long > Short")) return "Long > Short";
  if (unique.has("Short > Long")) return "Short > Long";
  if (unique.has("Close Long") && unique.has("Open Short")) return "Long > Short";
  if (unique.has("Close Short") && unique.has("Open Long")) return "Short > Long";
  return latest;
}

/**
 * Group new fills by order id. System fills are dropped. The price is
 * notional-weighted, size and closed PnL are sums, the time is the latest.
 * Returns the items oldest first.
 */
export function buildItems(network: Network, user: string, fills: readonly Fill[]): Item[] {
  const groups = new Map<number, Fill[]>();
  for (const fill of fills) {
    if (isSystemFill(fill.dir)) continue;
    const group = groups.get(fill.oid);
    if (group) group.push(fill);
    else groups.set(fill.oid, [fill]);
  }
  const items: Item[] = [];
  for (const [oid, group] of groups) {
    const sorted = [...group].sort((a, b) => a.time - b.time || a.tid - b.tid);
    const last = sorted[sorted.length - 1];
    if (!last) continue;
    let sizeCoin = 0;
    let notionalUsd = 0;
    let closedPnl = 0;
    for (const fill of sorted) {
      sizeCoin += fill.sz;
      notionalUsd += fill.px * fill.sz;
      closedPnl += fill.closedPnl;
    }
    items.push({
      id: itemId(network, user, oid),
      network,
      user: user.toLowerCase(),
      oid,
      coin: last.coin,
      dir: combineDirs(
        sorted.map((fill) => fill.dir),
        last.dir,
      ),
      side: last.side,
      sizeCoin,
      avgPx: sizeCoin > 0 ? notionalUsd / sizeCoin : last.px,
      notionalUsd,
      closedPnl,
      time: last.time,
    });
  }
  return items.sort((a, b) => a.time - b.time);
}

// ---------------------------------------------------------------------------
// Targets: which addresses to poll in this tick
// ---------------------------------------------------------------------------

export interface Target {
  network: Network;
  address: string;
  /** Null for an address that has no cursor yet. */
  cursor: Cursor | null;
  polledAt: number;
}

export function targetKey(network: Network, address: string): string {
  return `${network}:${address}`;
}

/**
 * The distinct (network, address) pairs of all watches, least recently
 * polled first (never polled first of all), capped at `max`.
 */
export function selectTargets(rows: readonly WatchRow[], max: number): Target[] {
  const byKey = new Map<string, Target>();
  for (const row of rows) {
    const key = targetKey(row.network, row.address);
    if (byKey.has(key)) continue;
    byKey.set(key, {
      network: row.network,
      address: row.address,
      cursor:
        row.last_time === null
          ? null
          : { lastTime: row.last_time, seenTids: parseSeenTids(row.seen_tids) },
      polledAt: row.polled_at ?? 0,
    });
  }
  return [...byKey.values()]
    .sort((a, b) => a.polledAt - b.polledAt || a.address.localeCompare(b.address))
    .slice(0, Math.max(0, max));
}

/** The networks that have at least one watch. */
export function activeNetworks(rows: readonly WatchRow[]): Network[] {
  return [...new Set(rows.map((row) => row.network))].sort();
}

// ---------------------------------------------------------------------------
// Delivery planning
// ---------------------------------------------------------------------------

export interface PushPayload {
  title: string;
  body: string;
  /** A path on the app's origin. */
  url: string;
  tag: string;
  time: number;
}

export interface SubscriptionTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failures: number;
}

export interface PlannedPush {
  subscription: SubscriptionTarget;
  payload: PushPayload;
  /** The items that this push covers (one, or all of a burst). */
  itemIds: string[];
  /** The `network:address` keys of those items. */
  targetKeys: string[];
}

/** The payload of a push for one order. */
export function itemPayload(item: Item, label: string, now: number): PushPayload {
  const { title, body } = noticeText(item, label, now);
  return { title, body, url: `/trader/${item.user}`, tag: item.id, time: item.time };
}

/** The payload of a summary push. */
export function burstPayload(
  network: Network,
  labels: readonly string[],
  count: number,
  now: number,
): PushPayload {
  const unique = [...new Set(labels)];
  const shown = unique.slice(0, 3).join(", ");
  const rest = unique.length > 3 ? ` and ${unique.length - 3} more` : "";
  return {
    title: burstText(count),
    body: `${shown}${rest}`,
    url: "/watchlist",
    tag: `${network}:burst`,
    time: now,
  };
}

export function deliveryKey(subscriptionId: string, itemId: string): string {
  return `${subscriptionId}|${itemId}`;
}

/**
 * Decide the pushes of one tick. A subscription gets the items of the
 * addresses it watches on that network when the notional reaches its
 * minimum and the item was not delivered before. More than BURST_MAX items
 * for one subscription become one summary push.
 */
export function planDeliveries({
  items,
  rows,
  delivered,
  now,
}: {
  items: readonly Item[];
  rows: readonly WatchRow[];
  /** deliveryKey(subscription, item) of the items already sent. */
  delivered: ReadonlySet<string>;
  now: number;
}): PlannedPush[] {
  const watchers = new Map<string, WatchRow[]>();
  for (const row of rows) {
    const key = targetKey(row.network, row.address);
    const list = watchers.get(key);
    if (list) list.push(row);
    else watchers.set(key, [row]);
  }

  const perSubscription = new Map<
    string,
    { subscription: SubscriptionTarget; entries: { item: Item; label: string }[] }
  >();
  for (const item of items) {
    for (const row of watchers.get(targetKey(item.network, item.user)) ?? []) {
      if (item.notionalUsd < row.min_notional) continue;
      if (delivered.has(deliveryKey(row.id, item.id))) continue;
      const label = row.label ?? shortAddress(item.user);
      const entry = perSubscription.get(row.id);
      if (entry) entry.entries.push({ item, label });
      else {
        perSubscription.set(row.id, {
          subscription: {
            id: row.id,
            endpoint: row.endpoint,
            p256dh: row.p256dh,
            auth: row.auth,
            failures: row.failures,
          },
          entries: [{ item, label }],
        });
      }
    }
  }

  const pushes: PlannedPush[] = [];
  for (const { subscription, entries } of perSubscription.values()) {
    if (entries.length > BURST_MAX) {
      const first = entries[0];
      if (!first) continue;
      pushes.push({
        subscription,
        payload: burstPayload(
          first.item.network,
          entries.map((entry) => entry.label),
          entries.length,
          now,
        ),
        itemIds: entries.map((entry) => entry.item.id),
        targetKeys: [
          ...new Set(entries.map((entry) => targetKey(entry.item.network, entry.item.user))),
        ],
      });
      continue;
    }
    for (const { item, label } of entries) {
      pushes.push({
        subscription,
        payload: itemPayload(item, label, now),
        itemIds: [item.id],
        targetKeys: [targetKey(item.network, item.user)],
      });
    }
  }
  return pushes;
}

// ---------------------------------------------------------------------------
// Push results
// ---------------------------------------------------------------------------

export type PushOutcome = "sent" | "gone" | "failed";

/** 2xx: sent. 404 and 410: the subscription is gone. Anything else: a failure. */
export function classifyPushStatus(status: number): PushOutcome {
  if (status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) return "gone";
  return "failed";
}

/** The failure count after one more failure, and whether to remove the subscription. */
export function nextFailures(failures: number): { failures: number; remove: boolean } {
  const next = failures + 1;
  return { failures: next, remove: next >= MAX_FAILURES };
}

/** A budget of outgoing requests for one tick. */
export interface Budget {
  take: () => boolean;
  remaining: () => number;
}

export function createBudget(limit: number): Budget {
  let left = Math.max(0, Math.floor(limit));
  return {
    take() {
      if (left <= 0) return false;
      left -= 1;
      return true;
    },
    remaining: () => left,
  };
}

/** How many addresses one tick polls: the address cap, and 60 % of the request budget. */
export function pollLimit(maxAddresses: number, maxSubrequests: number): number {
  return Math.max(1, Math.min(maxAddresses, Math.floor(maxSubrequests * 0.6)));
}

/** Run `task` over `values` with at most `limit` tasks at a time. */
export async function mapLimit<T, R>(
  values: readonly T[],
  limit: number,
  task: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next;
      next += 1;
      // `index` is below values.length, so the value exists.
      results[index] = await task(values[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}
