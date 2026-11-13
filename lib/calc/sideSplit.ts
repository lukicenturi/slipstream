import type { Fill, PositionSide } from "@/lib/hyperliquid/schemas";

import { describeFillAction } from "./fillAction";
import { perpFills } from "./traderStats";

/*
 * The long versus short split of a trader. Each order (oid) takes the side
 * of its first fill, so a flip order ("Long > Short") counts as short.
 * Only perp fills count.
 */

export interface SideStats {
  /** The number of orders on this side. */
  orders: number;
  /** Orders with a positive closed PnL. */
  wins: number;
  /** Orders with a negative closed PnL. */
  losses: number;
  /** wins / (wins + losses), or null when there are no closes. */
  winRate: number | null;
  /** The sum of px * sz in USD. */
  volume: number;
  /** orders / all orders, or null when there are no orders. */
  share: number | null;
}

export interface SideSplit {
  long: SideStats;
  short: SideStats;
  /** All orders of both sides. */
  orders: number;
}

interface OrderSummary {
  side: PositionSide;
  firstTime: number;
  firstTid: number;
  pnl: number;
  volume: number;
}

/** Orders, wins, losses and volume per position side. */
export function sideSplit(fills: readonly Fill[]): SideSplit {
  const orders = new Map<number, OrderSummary>();
  for (const fill of perpFills(fills)) {
    const side = describeFillAction(fill.dir).positionSide;
    // perpFills keeps only fills with a side; this check is for the type.
    if (side === null) continue;
    const volume = fill.px * fill.sz;
    const order = orders.get(fill.oid);
    if (!order) {
      orders.set(fill.oid, {
        side,
        firstTime: fill.time,
        firstTid: fill.tid,
        pnl: fill.closedPnl,
        volume,
      });
      continue;
    }
    order.pnl += fill.closedPnl;
    order.volume += volume;
    // The earliest fill sets the side of the order.
    if (
      fill.time < order.firstTime ||
      (fill.time === order.firstTime && fill.tid < order.firstTid)
    ) {
      order.side = side;
      order.firstTime = fill.time;
      order.firstTid = fill.tid;
    }
  }

  const empty = () => ({ orders: 0, wins: 0, losses: 0, volume: 0 });
  const totals = { long: empty(), short: empty() };
  for (const order of orders.values()) {
    const entry = totals[order.side];
    entry.orders += 1;
    entry.volume += order.volume;
    if (order.pnl > 0) entry.wins += 1;
    else if (order.pnl < 0) entry.losses += 1;
  }

  const all = orders.size;
  const finish = (entry: ReturnType<typeof empty>): SideStats => {
    const closes = entry.wins + entry.losses;
    return {
      ...entry,
      winRate: closes === 0 ? null : entry.wins / closes,
      share: all === 0 ? null : entry.orders / all,
    };
  };
  return { long: finish(totals.long), short: finish(totals.short), orders: all };
}
