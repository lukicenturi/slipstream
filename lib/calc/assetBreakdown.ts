import type { Fill } from "@/lib/hyperliquid/schemas";

import { perpFills } from "./traderStats";

/*
 * The asset breakdown of a trader: realized PnL and volume per coin.
 * Only perp fills count.
 */

export interface AssetRow {
  /** The coin name, or "Other" for the row that groups the rest. */
  coin: string;
  /** True for the row that groups the coins after the top rows. */
  other: boolean;
  /** The sum of `closedPnl`. */
  realizedPnl: number;
  /** The sum of px * sz in USD. */
  volume: number;
  /** The number of distinct orders (oids). */
  orders: number;
  /** volume / total volume, or 0 when the total volume is 0. */
  share: number;
}

/** One row per coin, sorted by volume (largest first). */
export function assetBreakdown(fills: readonly Fill[]): AssetRow[] {
  const byCoin = new Map<string, { realizedPnl: number; volume: number; oids: Set<number> }>();
  let total = 0;
  for (const fill of perpFills(fills)) {
    let entry = byCoin.get(fill.coin);
    if (!entry) {
      entry = { realizedPnl: 0, volume: 0, oids: new Set() };
      byCoin.set(fill.coin, entry);
    }
    const volume = fill.px * fill.sz;
    entry.realizedPnl += fill.closedPnl;
    entry.volume += volume;
    entry.oids.add(fill.oid);
    total += volume;
  }
  return [...byCoin]
    .map(([coin, entry]) => ({
      coin,
      other: false,
      realizedPnl: entry.realizedPnl,
      volume: entry.volume,
      orders: entry.oids.size,
      share: total > 0 ? entry.volume / total : 0,
    }))
    .sort((a, b) => b.volume - a.volume || a.coin.localeCompare(b.coin));
}

/**
 * The first `limit` rows. When there are more rows, one more row named
 * "Other" holds the sums of the rest.
 */
export function topAssets(rows: readonly AssetRow[], limit: number): AssetRow[] {
  if (rows.length <= limit) return [...rows];
  const rest = rows.slice(limit);
  const other: AssetRow = {
    coin: "Other",
    other: true,
    realizedPnl: 0,
    volume: 0,
    orders: 0,
    share: 0,
  };
  for (const row of rest) {
    other.realizedPnl += row.realizedPnl;
    other.volume += row.volume;
    // An order trades one coin, so the order counts add up without overlap.
    other.orders += row.orders;
    other.share += row.share;
  }
  return [...rows.slice(0, limit), other];
}
