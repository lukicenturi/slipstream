import type { Fill } from "@/lib/hyperliquid/schemas";

import { describeFillAction, isSystemFill } from "./fillAction";
import { winRate } from "./winRate";

/*
 * Trade statistics for the trader profile. The figures use perp fills only.
 * One order (oid) often fills in many parts, so the parts of one order
 * count as one order, like the win rate.
 */

const DAY_MS = 86_400_000;

/** A position size below this value counts as 0. */
const SIZE_EPSILON = 1e-9;

/**
 * The perp fills of a list. Exchange-made fills (spot dust conversions),
 * spot buys and sells and unknown `dir` values do not count.
 */
export function perpFills(fills: readonly Fill[]): Fill[] {
  return fills.filter(
    (fill) => !isSystemFill(fill.dir) && describeFillAction(fill.dir).positionSide !== null,
  );
}

/** The closed PnL of one order: the sum of `closedPnl` over its fills. */
export interface OrderPnl {
  oid: number;
  pnl: number;
}

/** Group fills by oid and sum the closed PnL per order, in first-seen order. */
export function orderPnls(fills: readonly Fill[]): OrderPnl[] {
  const pnlByOrder = new Map<number, number>();
  for (const fill of fills) {
    pnlByOrder.set(fill.oid, (pnlByOrder.get(fill.oid) ?? 0) + fill.closedPnl);
  }
  return [...pnlByOrder].map(([oid, pnl]) => ({ oid, pnl }));
}

function signedSize(fill: Fill): number {
  return fill.side === "buy" ? fill.sz : -fill.sz;
}

function byTime(a: Fill, b: Fill): number {
  return a.time - b.time || a.tid - b.tid;
}

/**
 * The hold time in ms of each complete round trip, per coin. A trip starts
 * at a fill that opens from a flat position (startPosition 0). It ends at
 * the first later fill of the same coin that brings the position back to 0.
 * Trips with no end do not count. Only perp fills count.
 */
export function holdTimes(fills: readonly Fill[]): number[] {
  const byCoin = new Map<string, Fill[]>();
  for (const fill of perpFills(fills)) {
    const group = byCoin.get(fill.coin);
    if (group) group.push(fill);
    else byCoin.set(fill.coin, [fill]);
  }

  const durations: number[] = [];
  for (const group of byCoin.values()) {
    let start: number | null = null;
    for (const fill of group.sort(byTime)) {
      if (start === null) {
        if (Math.abs(fill.startPosition) < SIZE_EPSILON && fill.sz !== 0) start = fill.time;
        continue;
      }
      if (Math.abs(fill.startPosition + signedSize(fill)) < SIZE_EPSILON) {
        durations.push(fill.time - start);
        start = null;
      }
    }
  }
  return durations;
}

/** The median of a list, or null for an empty list. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  // `middle` is a valid index: the list is not empty.
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export interface TradeStats {
  /** The number of counted perp fills. */
  fills: number;
  /** The number of distinct orders (oids) in the counted fills. */
  orders: number;
  /** Orders with a positive closed PnL. */
  wins: number;
  /** Orders with a negative closed PnL. */
  losses: number;
  /** wins / (wins + losses), or null when there are no closes. */
  winRate: number | null;
  /** The sum of the winning orders' PnL. */
  grossProfit: number;
  /** The absolute sum of the losing orders' PnL (0 or above). */
  grossLoss: number;
  /** grossProfit / grossLoss, or null when grossLoss is 0. */
  profitFactor: number | null;
  /** grossProfit / wins, or null when there are no wins. */
  avgWin: number | null;
  /** grossLoss / losses (0 or above), or null when there are no losses. */
  avgLoss: number | null;
  /** The PnL of the best winning order, or null when there are no wins. */
  largestWin: number | null;
  /** The PnL of the worst losing order (below 0), or null when there are no losses. */
  largestLoss: number | null;
  /** The sum of `fee` over the counted fills, in USDC. */
  fees: number;
  /** The time from the first to the last counted fill in days, or null when there are no fills. */
  spanDays: number | null;
  /** Orders / span in days (the span is at least 1 day), or null when there are no orders. */
  ordersPerDay: number | null;
  /** The number of complete round trips. */
  roundTrips: number;
  /** The median hold time of complete round trips in ms, or null when there are none. */
  medianHoldMs: number | null;
}

/** The trade statistics of a trader from their fills. Only perp fills count. */
export function tradeStats(fills: readonly Fill[]): TradeStats {
  const counted = perpFills(fills);
  const pnls = orderPnls(counted);
  const rate = winRate(counted);

  let grossProfit = 0;
  let grossLoss = 0;
  let largestWin: number | null = null;
  let largestLoss: number | null = null;
  for (const { pnl } of pnls) {
    if (pnl > 0) {
      grossProfit += pnl;
      largestWin = largestWin === null ? pnl : Math.max(largestWin, pnl);
    } else if (pnl < 0) {
      grossLoss -= pnl;
      largestLoss = largestLoss === null ? pnl : Math.min(largestLoss, pnl);
    }
  }

  let fees = 0;
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const fill of counted) {
    fees += fill.fee;
    first = Math.min(first, fill.time);
    last = Math.max(last, fill.time);
  }
  const spanDays = counted.length === 0 ? null : (last - first) / DAY_MS;
  const trips = holdTimes(counted);

  return {
    fills: counted.length,
    orders: pnls.length,
    wins: rate.wins,
    losses: rate.losses,
    winRate: rate.rate,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss === 0 ? null : grossProfit / grossLoss,
    avgWin: rate.wins === 0 ? null : grossProfit / rate.wins,
    avgLoss: rate.losses === 0 ? null : grossLoss / rate.losses,
    largestWin,
    largestLoss,
    fees,
    spanDays,
    ordersPerDay:
      pnls.length === 0 || spanDays === null ? null : pnls.length / Math.max(1, spanDays),
    roundTrips: trips.length,
    medianHoldMs: median(trips),
  };
}
