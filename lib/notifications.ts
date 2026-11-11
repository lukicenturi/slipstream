import { z } from "zod";

import type { FeedItem } from "@/lib/calc/aggregateFills";
import { describeFillAction } from "@/lib/calc/fillAction";
import { formatPrice, formatRelativeTime, formatSize, formatUsd } from "@/lib/format";
import { normalizeAddress } from "@/lib/address";

/*
 * Notices: one per live order of a watched trader. The list is JSON in
 * localStorage, newest first, capped at 50. hooks/useNotifications.ts does
 * the storage work. Everything here is pure.
 */

export const NOTIFICATIONS_STORAGE_KEY = "slipstream.notifications";
export const MAX_NOTICES = 50;

export interface Notice {
  /** The feed item id: `user:oid:firstTid`. Stable while later parts merge in. */
  id: string;
  /** Lower-case trader address. */
  address: string;
  coin: string;
  dir: string;
  side: "buy" | "sell";
  notionalUsd: number;
  sizeCoin: number;
  avgPx: number;
  closedPnl: number;
  /** Time of the latest fill in ms. */
  time: number;
  read: boolean;
}

const finite = z.number().refine(Number.isFinite);

const noticeSchema = z.object({
  id: z.string().min(1),
  address: z.string().transform((value, ctx) => {
    const address = normalizeAddress(value);
    if (address) return address;
    ctx.addIssue({ code: "custom", message: "Not an address" });
    return z.NEVER;
  }),
  coin: z.string().min(1),
  dir: z.string(),
  side: z.enum(["buy", "sell"]),
  notionalUsd: finite,
  sizeCoin: finite,
  avgPx: finite,
  closedPnl: finite,
  time: finite,
  read: z.boolean(),
});

const storedSchema = z.array(z.unknown());

function byTimeDesc(a: Notice, b: Notice): number {
  return b.time - a.time;
}

/**
 * Parse the stored list. Bad JSON or a value that is not an array gives an
 * empty list. Bad entries and repeated ids are dropped. The result is newest
 * first and holds at most 50 notices.
 */
export function parseNotices(raw: string | null): Notice[] {
  if (raw === null) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const parsed = storedSchema.safeParse(json);
  if (!parsed.success) return [];
  const seen = new Set<string>();
  const result: Notice[] = [];
  for (const entry of parsed.data) {
    const notice = noticeSchema.safeParse(entry);
    if (!notice.success || seen.has(notice.data.id)) continue;
    seen.add(notice.data.id);
    result.push(notice.data);
  }
  return result.sort(byTimeDesc).slice(0, MAX_NOTICES);
}

/** Build an unread notice from a feed item. */
export function noticeFromFeedItem(item: FeedItem): Notice {
  return {
    id: item.id,
    address: item.user.toLowerCase(),
    coin: item.coin,
    dir: item.dir,
    side: item.side,
    notionalUsd: item.notional,
    sizeCoin: item.sz,
    avgPx: item.px,
    closedPnl: item.closedPnl,
    time: item.time,
    read: false,
  };
}

/**
 * Add notices to the list. A notice with a known id replaces the old one
 * (later parts of an order make it bigger) but keeps its read state.
 * Returns a new list, newest first, capped at 50.
 */
export function addNotices(list: readonly Notice[], incoming: readonly Notice[]): Notice[] {
  if (incoming.length === 0) return [...list];
  const byId = new Map<string, Notice>();
  for (const notice of list) byId.set(notice.id, notice);
  for (const notice of incoming) {
    const existing = byId.get(notice.id);
    byId.set(notice.id, existing ? { ...notice, read: existing.read } : notice);
  }
  return [...byId.values()].sort(byTimeDesc).slice(0, MAX_NOTICES);
}

export function markAllRead(list: readonly Notice[]): Notice[] {
  return list.map((notice) => (notice.read ? notice : { ...notice, read: true }));
}

export function markRead(list: readonly Notice[], id: string): Notice[] {
  return list.map((notice) =>
    notice.id === id && !notice.read ? { ...notice, read: true } : notice,
  );
}

export function unreadCount(list: readonly Notice[]): number {
  let count = 0;
  for (const notice of list) if (!notice.read) count += 1;
  return count;
}

export function clearNotices(): Notice[] {
  return [];
}

/**
 * The title and body of a toast or a browser notification, for example
 * "testooor.hl opened long BTC" and "$12.4K · 0.17 BTC @ 74,650.00 · 2m ago".
 */
export function noticeText(
  notice: Notice,
  label: string,
  now: number = Date.now(),
): { title: string; body: string } {
  const { phrase } = describeFillAction(notice.dir);
  return {
    title: `${label} ${phrase} ${notice.coin}`,
    body: [
      formatUsd(notice.notionalUsd, { compact: true }),
      `${formatSize(notice.sizeCoin)} ${notice.coin} @ ${formatPrice(notice.avgPx)}`,
      formatRelativeTime(notice.time, Math.max(now, notice.time)),
    ].join(" · "),
  };
}

/** The badge text for an unread count: nothing for 0, "9+" above 9. */
export function unreadBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > 9 ? "9+" : String(count);
}

// ---------------------------------------------------------------------------
// Burst collapsing for toasts
// ---------------------------------------------------------------------------

export const BURST_WINDOW_MS = 5_000;
export const BURST_MAX = 3;

export interface BurstState {
  /** Arrival times (ms) of the toasts shown inside the window. */
  shownAt: readonly number[];
  /** Trades counted by the open summary toast. 0 when no summary is open. */
  summaryCount: number;
}

export const INITIAL_BURST_STATE: BurstState = { shownAt: [], summaryCount: 0 };

export type BurstDecision =
  | { kind: "each"; notices: Notice[]; state: BurstState }
  | { kind: "summary"; count: number; state: BurstState };

/**
 * Decide how to show the notices of one batch. When more than `max` toasts
 * would show inside `windowMs`, the batch becomes one summary
 * ("n new trades from traders you follow"). While toasts keep arriving
 * inside the window, the open summary counts up. A quiet window ends the burst.
 */
export function collapseBurst(
  incoming: readonly Notice[],
  state: BurstState,
  now: number,
  windowMs: number = BURST_WINDOW_MS,
  max: number = BURST_MAX,
): BurstDecision {
  const shownAt = state.shownAt.filter((time) => now - time < windowMs);
  const summaryOpen = state.summaryCount > 0 && shownAt.length > 0;
  if (incoming.length === 0) {
    return {
      kind: "each",
      notices: [],
      state: { shownAt, summaryCount: summaryOpen ? state.summaryCount : 0 },
    };
  }
  if (summaryOpen) {
    const count = state.summaryCount + incoming.length;
    return { kind: "summary", count, state: { shownAt: [...shownAt, now], summaryCount: count } };
  }
  if (shownAt.length + incoming.length > max) {
    const count = incoming.length;
    return { kind: "summary", count, state: { shownAt: [...shownAt, now], summaryCount: count } };
  }
  return {
    kind: "each",
    notices: [...incoming],
    state: { shownAt: [...shownAt, ...incoming.map(() => now)], summaryCount: 0 },
  };
}

/** The summary toast text. */
export function burstText(count: number): string {
  return `${count} new ${count === 1 ? "trade" : "trades"} from traders you follow`;
}

// ---------------------------------------------------------------------------
// Browser notifications
// ---------------------------------------------------------------------------

export type BrowserPermission = "default" | "granted" | "denied" | "unsupported";

/**
 * Browser notifications fire only when the setting is on, the browser
 * granted the permission, and the tab is hidden. Toasts cover the visible tab.
 */
export function shouldShowBrowserNotice({
  enabled,
  permission,
  visibility,
}: {
  enabled: boolean;
  permission: BrowserPermission;
  visibility: DocumentVisibilityState;
}): boolean {
  return enabled && permission === "granted" && visibility === "hidden";
}
