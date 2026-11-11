import type { Position } from "@/lib/hyperliquid/schemas";

/*
 * Live position values. The mark price is the live mid from the shared
 * socket. Until a mid arrives, the values from the API are used.
 */

type PnlInput = Pick<Position, "side" | "size" | "entryPx" | "unrealizedPnl">;
type RoeInput = Pick<Position, "size" | "entryPx" | "leverage" | "roe">;

function hasMark(mark: number | undefined): mark is number {
  return mark !== undefined && Number.isFinite(mark);
}

/**
 * Unrealized PnL at the mark: (mark - entry) * size for a long, negated
 * for a short. Returns the API value when there is no mark.
 */
export function unrealizedPnl(position: PnlInput, mark: number | undefined): number {
  if (!hasMark(mark)) return position.unrealizedPnl;
  const pnl = (mark - position.entryPx) * Math.abs(position.size);
  return position.side === "short" ? -pnl : pnl;
}

/**
 * Return on equity as a ratio: PnL over the initial margin
 * (|size| * entry / leverage). Returns the API value when there is no
 * mark or the margin is not positive.
 */
export function returnOnEquity(position: RoeInput, pnl: number, mark: number | undefined): number {
  if (!hasMark(mark)) return position.roe;
  const margin = (Math.abs(position.size) * position.entryPx) / position.leverage;
  if (!Number.isFinite(margin) || margin <= 0) return position.roe;
  return pnl / margin;
}

/** The sum of the live unrealized PnL of all positions. */
export function totalUnrealizedPnl(
  positions: readonly (PnlInput & Pick<Position, "coin">)[],
  getMark: (coin: string) => number | undefined,
): number {
  let total = 0;
  for (const position of positions) total += unrealizedPnl(position, getMark(position.coin));
  return total;
}

/** Below this account value (USD) an address counts as having no funds. */
export const DUST_ACCOUNT_VALUE = 1;

/**
 * True when an address has no funds, no positions and no fills.
 * Unknown addresses report an account value of "0.0" or "0.1", not 0.
 */
export function hasNoActivity(input: {
  accountValue: number;
  positionCount: number;
  fillCount: number;
}): boolean {
  return (
    input.accountValue < DUST_ACCOUNT_VALUE && input.positionCount === 0 && input.fillCount === 0
  );
}
