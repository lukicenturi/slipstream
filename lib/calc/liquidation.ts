import type { PositionSide } from "@/lib/hyperliquid/schemas";

/*
 * Estimates for the demo copy-trade sheet. The formulas are for an
 * isolated-margin position. They ignore cross margin, funding and fees,
 * so the result is an approximation, not the exchange's number.
 */

/** The maintenance margin rate when the max leverage of the coin is not known. */
export const DEFAULT_MAINTENANCE_MARGIN_RATE = 0.005;

export interface LiquidationInput {
  /** Entry price of the new position (the mark price for a copy). */
  entryPx: number;
  /** Leverage, 1 or more. */
  leverage: number;
  side: PositionSide;
  /** Overrides the default rate. A ratio, for example 0.005 for 0.5%. */
  maintenanceMarginRate?: number;
  /** Max leverage of the coin. The default rate is 1 / (2 * maxLeverage). */
  maxLeverage?: number;
}

export interface LiquidationEstimate {
  liquidationPx: number;
  /** The maintenance margin rate that the estimate used. */
  maintenanceMarginRate: number;
}

function isValidLeverage(leverage: number): boolean {
  return Number.isFinite(leverage) && leverage >= 1;
}

/**
 * The maintenance margin rate: the given rate, else 1 / (2 * maxLeverage)
 * when the max leverage is known, else 0.5%.
 */
export function maintenanceMarginRate(input: {
  maintenanceMarginRate?: number;
  maxLeverage?: number;
}): number {
  if (input.maintenanceMarginRate !== undefined) return input.maintenanceMarginRate;
  if (input.maxLeverage !== undefined && isValidLeverage(input.maxLeverage)) {
    return 1 / (2 * input.maxLeverage);
  }
  return DEFAULT_MAINTENANCE_MARGIN_RATE;
}

/**
 * Estimated liquidation price of an isolated position.
 * Long: entry * (1 - 1 / leverage + mmr). Short: entry * (1 + 1 / leverage - mmr).
 * The result is never below 0. Returns null for a leverage below 1, an
 * entry price that is not positive, or a rate outside [0, 1).
 */
export function estimateLiquidation(input: LiquidationInput): LiquidationEstimate | null {
  const { entryPx, leverage, side } = input;
  if (!isValidLeverage(leverage)) return null;
  if (!Number.isFinite(entryPx) || entryPx <= 0) return null;
  const mmr = maintenanceMarginRate(input);
  if (!Number.isFinite(mmr) || mmr < 0 || mmr >= 1) return null;

  const factor = side === "long" ? 1 - 1 / leverage + mmr : 1 + 1 / leverage - mmr;
  return { liquidationPx: Math.max(0, entryPx * factor), maintenanceMarginRate: mmr };
}

/** The margin that a position of `sizeUsd` needs at `leverage`. Null for bad input. */
export function estimateMargin(sizeUsd: number, leverage: number): number | null {
  if (!isValidLeverage(leverage)) return null;
  if (!Number.isFinite(sizeUsd) || sizeUsd < 0) return null;
  return sizeUsd / leverage;
}

/** The position size in coin units: sizeUsd / price. Null when the price is not known. */
export function positionSizeInCoin(sizeUsd: number, price: number | undefined): number | null {
  if (price === undefined || !Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(sizeUsd) || sizeUsd < 0) return null;
  return sizeUsd / price;
}
