/*
 * Limits and defaults for the demo copy-trade sheet. Pure functions, so
 * the sheet stays presentational and the rules have tests.
 */

export const SIZE_MIN_USD = 50;
export const SIZE_MAX_USD = 10_000;
export const SIZE_STEP_USD = 50;
export const DEFAULT_SIZE_USD = 1_000;

/** The max leverage when the coin's limit is not known (feed rows). */
export const DEFAULT_MAX_LEVERAGE = 20;
/** The leverage when the trader's leverage is not known. */
export const DEFAULT_LEVERAGE = 5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Keep a USD size inside [50, 10,000]. A value that is not finite gives the default. */
export function clampSizeUsd(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SIZE_USD;
  return clamp(value, SIZE_MIN_USD, SIZE_MAX_USD);
}

/**
 * Parse the text of the size input. Accepts "1,250", "$1250" and "1250.5".
 * Returns null when the text is not a number.
 */
export function parseSizeInput(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** The slider's upper limit: the coin's max leverage (whole, 1 or more), else 20. */
export function resolveMaxLeverage(maxLeverage: number | undefined): number {
  if (maxLeverage === undefined || !Number.isFinite(maxLeverage) || maxLeverage < 1) {
    return DEFAULT_MAX_LEVERAGE;
  }
  return Math.floor(maxLeverage);
}

/**
 * The first leverage of the sheet: the trader's leverage when known, else 5x.
 * Always a whole number inside [1, maxLeverage].
 */
export function initialLeverage(leverage: number | undefined, maxLeverage: number): number {
  const base = leverage !== undefined && Number.isFinite(leverage) ? leverage : DEFAULT_LEVERAGE;
  return clamp(Math.round(base), 1, maxLeverage);
}
