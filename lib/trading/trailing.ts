import { z } from "zod";

import type { OpenOrder, PositionSide } from "@/lib/hyperliquid/schemas";
import type { Network } from "@/lib/network";

import { roundPrice } from "./order";
import { classifyOpenOrder, validateTriggerPx } from "./tpsl";

/*
 * Pure logic for the trailing stop. The protection is an on-chain
 * stop-loss trigger order (reduce-only, market on trigger). While a
 * Slipstream tab is open, the browser moves that order with `modify` as
 * the price moves in the position's favour: up for a long, down for a
 * short. It never moves the stop the other way, at most every 15 s, and
 * only for a step of at least 0.1 % of the price.
 */

/**
 * False until a real `modify` of a trailing stop is seen on a funded
 * account. While false, the Trailing tab says that the updates are not yet
 * verified (see DECISIONS.md, 2026-11-12).
 */
export const TRAILING_MODIFY_VERIFIED = false;

export const TRAILING_STORAGE_ROOT = "slipstream.trailing.";
/** The trail distance presets, in percent. */
export const TRAIL_PRESETS_PCT = [1, 2, 5, 10] as const;
/** The trail distance range, in percent. */
export const TRAIL_MIN_PCT = 0.5;
export const TRAIL_MAX_PCT = 50;
/** A move smaller than this (0.1 % of the price) is not sent. */
export const TRAIL_MIN_STEP_PCT = 0.1;
/** At most one update per coin in this time. */
export const TRAIL_MIN_INTERVAL_MS = 15_000;
/**
 * An open-orders snapshot this soon after the last change may predate it,
 * so it cannot say that the order is gone.
 */
export const RECONCILE_GRACE_MS = 3_000;

export interface TrailingConfig {
  coin: string;
  positionSide: PositionSide;
  /** The trail distance as a ratio (0.02 = 2 %), in [0.005, 0.5]. */
  trailPct: number;
  assetIndex: number;
  szDecimals: number;
  /** The position size in coin when the trailing stop started; the fallback size of an update. */
  size: number;
  /** The order id of the on-chain stop. */
  oid: number;
  /** The trigger price of the on-chain stop. */
  stopPx: number;
  /** The best mid seen since the start: the highest for a long, the lowest for a short. */
  highWater: number;
  createdAt: number;
  updatedAt: number;
  /** The time of the last placement or modify of the stop. */
  lastModifyAt: number;
  /**
   * The oid of the stop before the last `modify`, until a snapshot shows the
   * move. A `modify` with `a: true` can leave this order open (when its
   * cancel failed) and can give the new order a new oid. The cleanup cancels
   * exactly this oid when it is still open and is not the tracked stop.
   */
  previousOid?: number;
  /**
   * True after a `modify` that did not answer (a network error): it may or
   * may not have reached the exchange. `pendingStopPx` holds the price that
   * it sent. The next reconcile accepts a stop at either price, then clears
   * both fields.
   */
  unsettled?: boolean;
  /** The trigger price of the unanswered `modify`, while `unsettled` is true. */
  pendingStopPx?: number;
}

const positive = z.number().finite().positive();

export const trailingConfigSchema = z.object({
  coin: z.string().min(1),
  positionSide: z.enum(["long", "short"]),
  trailPct: z
    .number()
    .min(TRAIL_MIN_PCT / 100)
    .max(TRAIL_MAX_PCT / 100),
  assetIndex: z.number().int().nonnegative(),
  szDecimals: z.number().int().min(0),
  size: positive,
  oid: z.number().int().nonnegative(),
  stopPx: positive,
  highWater: positive,
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  lastModifyAt: z.number().int().positive(),
  previousOid: z.number().int().nonnegative().optional(),
  unsettled: z.boolean().optional(),
  pendingStopPx: positive.optional(),
});

/** `slipstream.trailing.<network>.<owner lower-case>`. */
export function trailingStorageKey(network: Network, owner: string): string {
  return `${TRAILING_STORAGE_ROOT}${network}.${owner.toLowerCase()}`;
}

/**
 * The name of the cross-tab lock around one trailing update:
 * `slipstream.trailing.<network>.<owner lower-case>.<coin>`.
 */
export function trailingLockName(network: Network, owner: string, coin: string): string {
  return `${trailingStorageKey(network, owner)}.${coin}`;
}

/** A trail distance in percent, clamped to [0.5, 50]; NaN gives null. */
export function clampTrailPct(percent: number): number | null {
  if (!Number.isFinite(percent)) return null;
  return Math.min(TRAIL_MAX_PCT, Math.max(TRAIL_MIN_PCT, percent));
}

/** The first stop: `trailPct` under the mid for a long, above it for a short, rounded. */
export function initialStop(
  positionSide: PositionSide,
  mid: number,
  trailPct: number,
  szDecimals: number,
): string {
  if (!Number.isFinite(mid) || mid <= 0) throw new Error("The mid price is not known.");
  const px = positionSide === "long" ? mid * (1 - trailPct) : mid * (1 + trailPct);
  return roundPrice(px, szDecimals);
}

/** True when moving the stop from `from` to `to` only reduces the risk of the position. */
export function isFavourableMove(positionSide: PositionSide, from: number, to: number): boolean {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
  return positionSide === "long" ? to > from : to < from;
}

/** The best mid so far: the higher one for a long, the lower one for a short. */
export function bestMid(positionSide: PositionSide, current: number, mid: number): number {
  if (!Number.isFinite(mid) || mid <= 0) return current;
  return positionSide === "long" ? Math.max(current, mid) : Math.min(current, mid);
}

/**
 * The next stop, or null when nothing is to be sent. For a long, the high
 * water mark follows the mid up and the candidate stop is
 * `highWater * (1 - trailPct)`, rounded. It is returned only when it is
 * above the current stop by at least 0.1 % of the stop and the last update
 * is at least 15 s old. A short is the mirror. The result is never worse
 * for the position than the current stop. A candidate on the wrong side of
 * the mid, or inside 0.1 % of it, gives null (after a spike and a fall the
 * candidate can sit above the mid of a long); the caller keeps the high
 * water mark, so the next valid move still goes out.
 */
export function nextTrailingStop(
  config: Pick<
    TrailingConfig,
    "positionSide" | "trailPct" | "szDecimals" | "stopPx" | "highWater" | "lastModifyAt"
  >,
  mid: number,
  now: number,
): { stopPx: number; highWater: number } | null {
  if (!Number.isFinite(mid) || mid <= 0) return null;
  if (now - config.lastModifyAt < TRAIL_MIN_INTERVAL_MS) return null;
  const { positionSide, trailPct, szDecimals, stopPx } = config;
  const highWater = bestMid(positionSide, config.highWater, mid);
  let candidate: number;
  try {
    candidate = Number(initialStop(positionSide, highWater, trailPct, szDecimals));
  } catch {
    return null;
  }
  if (!isFavourableMove(positionSide, stopPx, candidate)) return null;
  if (Math.abs(candidate - stopPx) < (stopPx * TRAIL_MIN_STEP_PCT) / 100) return null;
  if (validateTriggerPx({ kind: "sl", positionSide, triggerPx: candidate, mid }) !== null)
    return null;
  return { stopPx: candidate, highWater };
}

/** Parse the stored list. Bad JSON gives []; a bad entry is dropped; one entry per coin (the last). */
export function parseTrailingConfigs(raw: string | null): TrailingConfig[] {
  if (raw === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const byCoin = new Map<string, TrailingConfig>();
  for (const entry of value) {
    const parsed = trailingConfigSchema.safeParse(entry);
    if (parsed.success) byCoin.set(parsed.data.coin, parsed.data);
  }
  return [...byCoin.values()];
}

/** The list with this coin's config added or replaced. */
export function upsertTrailing(
  list: readonly TrailingConfig[],
  config: TrailingConfig,
): TrailingConfig[] {
  return [...list.filter((entry) => entry.coin !== config.coin), config];
}

/** The list without this coin's config. */
export function removeTrailing(list: readonly TrailingConfig[], coin: string): TrailingConfig[] {
  return list.filter((entry) => entry.coin !== coin);
}

export type ReconcileResult =
  | { kind: "keep"; stopPx?: number }
  | { kind: "wait" }
  | { kind: "adopt"; oid: number }
  | { kind: "gone" };

/** True for a reduce-only stop-loss trigger order of the coin. */
function isCoinStop(order: OpenOrder, coin: string): order is OpenOrder & { triggerPx: number } {
  return (
    order.coin === coin &&
    order.isTrigger &&
    order.reduceOnly &&
    classifyOpenOrder(order).kind === "sl" &&
    order.triggerPx !== null
  );
}

function samePx(a: number, b: number): boolean {
  return Math.abs(a - b) <= b * 1e-9;
}

/**
 * Compare a config with an open-orders snapshot fetched at `fetchedAt`.
 * - "wait": the snapshot may predate the last change of the stop.
 * - "keep": the stop is open. When its on-chain trigger price is better for
 *   the position than the stored one, `stopPx` holds it, so the caller
 *   stores it (the on-chain stop is the truth).
 * - "adopt": the oid is not open, but a reduce-only stop-market trigger of
 *   the coin has the same trigger price (the exchange may give a modified
 *   order a new oid). It must not be older than the config (`createdAt`), so
 *   a stop that the user placed by hand before the trailing stop, or a stop
 *   limit, is never adopted.
 * - "gone": the stop filled or was cancelled.
 */
export function reconcileTrailing(
  config: Pick<
    TrailingConfig,
    "coin" | "oid" | "stopPx" | "updatedAt" | "createdAt" | "positionSide"
  >,
  openOrders: readonly OpenOrder[],
  fetchedAt: number,
): ReconcileResult {
  if (fetchedAt < config.updatedAt + RECONCILE_GRACE_MS) return { kind: "wait" };
  const own = openOrders.find((order) => order.oid === config.oid);
  if (own) {
    const px = own.triggerPx;
    return px !== null && isFavourableMove(config.positionSide, config.stopPx, px)
      ? { kind: "keep", stopPx: px }
      : { kind: "keep" };
  }
  const same = openOrders.find(
    (order) =>
      isCoinStop(order, config.coin) &&
      order.orderType === "Stop Market" &&
      order.timestamp >= config.createdAt &&
      samePx(order.triggerPx, config.stopPx),
  );
  return same ? { kind: "adopt", oid: same.oid } : { kind: "gone" };
}

/**
 * The second check before a `modify`: the candidate must also be better
 * for the position than the on-chain trigger price of the tracked stop in
 * the latest open-orders snapshot. Without a snapshot, or when the stop is
 * not in it, only the stored stop counts (the caller checks that).
 */
export function isFavourableOnChain(
  config: Pick<TrailingConfig, "oid" | "positionSide">,
  candidate: number,
  openOrders: readonly OpenOrder[] | undefined,
): boolean {
  const onChain = openOrders?.find((order) => order.oid === config.oid)?.triggerPx;
  if (onChain === undefined || onChain === null) return true;
  return isFavourableMove(config.positionSide, onChain, candidate);
}

export interface ModifyCleanup {
  /** False when no stop of the coin has the stored price yet: check again on the next snapshot. */
  found: boolean;
  /** The oid of the stop at the stored price, when it is not the stored oid. */
  adoptOid?: number;
  /** The previous oid of the tracked stop, when it is still open next to the moved stop. */
  cancelOid?: number;
}

/**
 * After a successful `modify` (sent with `a: true`, so the new order goes
 * out even when the cancel of the old one fails), find what to clean up in
 * the next open-orders snapshot. The tracked stop is the stop of the coin
 * at the stored price (the stored oid first). The only order that the
 * cleanup may cancel is `previousOid`, the order that the `modify`
 * replaced: when it is still open, is not the tracked stop, and is not
 * better for the position than the stored price. Every other order stays,
 * also a stop loss that the user placed by hand. Without a stop at the
 * stored price, nothing is done (`found: false`), and the caller checks
 * again on the next snapshot.
 */
export function planModifyCleanup(
  config: Pick<TrailingConfig, "coin" | "oid" | "previousOid" | "stopPx" | "positionSide">,
  openOrders: readonly OpenOrder[],
): ModifyCleanup {
  const stops = openOrders.filter((order) => isCoinStop(order, config.coin));
  const atPrice = stops.filter((order) => samePx(order.triggerPx, config.stopPx));
  const previous = config.previousOid;
  const tracked =
    atPrice.find((order) => order.oid === config.oid) ??
    atPrice.find((order) => order.oid !== previous) ??
    atPrice[0];
  if (!tracked) return { found: false };
  const leftover =
    previous !== undefined && previous !== tracked.oid
      ? stops.find(
          (order) =>
            order.oid === previous &&
            !isFavourableMove(config.positionSide, config.stopPx, order.triggerPx),
        )
      : undefined;
  return {
    found: true,
    ...(tracked.oid !== config.oid ? { adoptOid: tracked.oid } : {}),
    ...(leftover ? { cancelOid: leftover.oid } : {}),
  };
}

export interface TrailingStopOids {
  /** The oid of the tracked stop on the book, if the book shows it. */
  tracked?: number;
  /** The previous oid of the tracked stop, when it is still open and is not the tracked stop. */
  previous?: number;
}

/**
 * Find the trailing stop of a config in a fresh open-orders snapshot.
 * Without a move that settles, the tracked stop is the stored oid when it
 * is open, else a reduce-only stop of the coin at the stored price (the
 * exchange may give a modified order a new oid). While a move settles
 * (`previousOid` set, or `unsettled`), the stop at the price of the move
 * comes first: the pending price, then the stored price, and at each price
 * the stored oid first, then an oid that is not the previous one. The
 * stored oid is the last fallback. `previous` is the previous oid when it
 * is still open next to the tracked stop.
 */
export function trailingStopOids(
  config: Pick<
    TrailingConfig,
    "coin" | "oid" | "previousOid" | "stopPx" | "unsettled" | "pendingStopPx"
  >,
  openOrders: readonly OpenOrder[],
): TrailingStopOids {
  const isOpen = (oid: number) => openOrders.some((order) => order.oid === oid);
  const stops = openOrders.filter((order) => isCoinStop(order, config.coin));
  const at = (px: number) => stops.filter((order) => samePx(order.triggerPx, px));
  const settling = config.previousOid !== undefined || config.unsettled === true;

  let tracked: number | undefined;
  if (!settling) {
    tracked = isOpen(config.oid) ? config.oid : at(config.stopPx)[0]?.oid;
  } else {
    const prices =
      config.unsettled && config.pendingStopPx !== undefined
        ? [config.pendingStopPx, config.stopPx]
        : [config.stopPx];
    for (const px of prices) {
      const list = at(px);
      const pick =
        list.find((order) => order.oid === config.oid) ??
        list.find((order) => order.oid !== config.previousOid) ??
        list[0];
      if (pick) {
        tracked = pick.oid;
        break;
      }
    }
    tracked ??= isOpen(config.oid) ? config.oid : undefined;
  }
  const previous = config.previousOid;
  return {
    ...(tracked !== undefined ? { tracked } : {}),
    ...(previous !== undefined && previous !== tracked && isOpen(previous) ? { previous } : {}),
  };
}

/**
 * What these oids are for a trailing config, in a fresh open-orders
 * snapshot (read inside the coin lock):
 * - "stop": one of them is the live tracked stop, or the stored oid.
 *   Cancelling it ends the trailing. The stored oid counts as the stop also
 *   in the settle window after a move (when it is the previous oid too):
 *   every older snapshot showed it as the trailing stop, so the user who
 *   picks it wants the trailing stop gone.
 * - "previous": one of them is the previous oid after a reconcile adopted
 *   the new oid (the order that a move left behind). Cancelling it needs the
 *   coin lock, but the trailing goes on.
 * - null: none of them belongs to this trailing stop.
 */
export function trailingRoleOf(
  config: Pick<
    TrailingConfig,
    "coin" | "oid" | "previousOid" | "stopPx" | "unsettled" | "pendingStopPx"
  >,
  oids: readonly number[],
  openOrders: readonly OpenOrder[],
): "stop" | "previous" | null {
  const ids = new Set(oids);
  const { tracked } = trailingStopOids(config, openOrders);
  if ((tracked !== undefined && ids.has(tracked)) || ids.has(config.oid)) return "stop";
  if (config.previousOid !== undefined && ids.has(config.previousOid)) return "previous";
  return null;
}

/**
 * The oids to label "Trailing stop" in an open-orders snapshot: per config,
 * the live tracked stop (which can have a new oid after a move), else the
 * stored oid.
 */
export function trailingLabelOids(
  configs: readonly Pick<
    TrailingConfig,
    "coin" | "oid" | "previousOid" | "stopPx" | "unsettled" | "pendingStopPx"
  >[],
  openOrders: readonly OpenOrder[],
): Set<number> {
  return new Set(
    configs.map((config) => trailingStopOids(config, openOrders).tracked ?? config.oid),
  );
}

export interface TrailingCancelPlan {
  /** The oids for one cancel request: the asked oids first (in order), then the extras. */
  oids: number[];
  /** Per trailing config that this cancel ends: its coin and the oid of its live stop. */
  ending: { coin: string; stop: number }[];
}

/**
 * Plan one cancel request for these oids with a fresh open-orders snapshot.
 * For each config whose role is "stop", add its live tracked stop (it can
 * have a new oid after a move; else the stored oid) and its previous oid
 * when the snapshot still shows it open, so the trailing stop and the order
 * that its last move left behind go in the same request (as "Stop and
 * cancel" does). The config ends only when the cancel of its live stop is
 * done (`ending`). No other order is added.
 */
export function planTrailingCancel(
  configs: readonly Pick<
    TrailingConfig,
    "coin" | "oid" | "previousOid" | "stopPx" | "unsettled" | "pendingStopPx"
  >[],
  oids: readonly number[],
  openOrders: readonly OpenOrder[],
): TrailingCancelPlan {
  const list = [...oids];
  const ending: { coin: string; stop: number }[] = [];
  for (const config of configs) {
    if (trailingRoleOf(config, oids, openOrders) !== "stop") continue;
    const { tracked, previous } = trailingStopOids(config, openOrders);
    const stop = tracked ?? config.oid;
    for (const extra of [stop, previous]) {
      if (extra !== undefined && !list.includes(extra)) list.push(extra);
    }
    ending.push({ coin: config.coin, stop });
  }
  return { oids: list, ending };
}
