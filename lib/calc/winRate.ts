import type { Fill } from "@/lib/hyperliquid/schemas";

/*
 * Win rate from the closed PnL of fills. One order (oid) often fills in
 * many parts, so the parts of one order count as one close.
 */

export interface WinRate {
  /** Orders with a positive closed PnL. */
  wins: number;
  /** Orders with a negative closed PnL. */
  losses: number;
  /** wins + losses. */
  closes: number;
  /** wins / closes as a ratio, or null when there are no closes. */
  rate: number | null;
}

/**
 * Group fills by oid and sum closedPnl per order. Orders with a sum of
 * exactly 0 (opens) do not count.
 */
export function winRate(fills: readonly Fill[]): WinRate {
  const pnlByOrder = new Map<number, number>();
  for (const fill of fills) {
    pnlByOrder.set(fill.oid, (pnlByOrder.get(fill.oid) ?? 0) + fill.closedPnl);
  }
  let wins = 0;
  let losses = 0;
  for (const pnl of pnlByOrder.values()) {
    if (pnl > 0) wins += 1;
    else if (pnl < 0) losses += 1;
  }
  const closes = wins + losses;
  return { wins, losses, closes, rate: closes === 0 ? null : wins / closes };
}
