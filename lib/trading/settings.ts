import { z } from "zod";

import type { Network } from "@/lib/network";

import { MIN_ORDER_USD, TRADING_LIMITS } from "./config";

/*
 * Trading settings of one network, kept in this browser. Today it holds
 * only the per-order size cap. The cap is a safeguard: the sheet clamps the
 * size to it, and the order hook refuses a larger order.
 */

export interface TradingSettings {
  /** The largest order that the sheet sends, in USD at the mid. */
  maxOrderUsd: number;
}

/** `slipstream.trading.<network>`. */
export function tradingSettingsKey(network: Network): string {
  return `slipstream.trading.${network}`;
}

/** The lowest cap: the exchange minimum order. */
export const MIN_MAX_ORDER_USD = MIN_ORDER_USD;

/** A whole USD cap inside [$10, the network's hard maximum]. Not finite gives the default. */
export function clampMaxOrderUsd(value: number, network: Network): number {
  const { defaultMaxOrderUsd, hardMaxOrderUsd } = TRADING_LIMITS[network];
  if (!Number.isFinite(value)) return defaultMaxOrderUsd;
  return Math.min(hardMaxOrderUsd, Math.max(MIN_MAX_ORDER_USD, Math.floor(value)));
}

export function defaultTradingSettings(network: Network): TradingSettings {
  return { maxOrderUsd: TRADING_LIMITS[network].defaultMaxOrderUsd };
}

const storedSettingsSchema = z.object({ maxOrderUsd: z.number() });

/** Parse a stored value. A bad value gives the defaults; a cap out of range is clamped. */
export function parseTradingSettings(raw: string | null, network: Network): TradingSettings {
  if (raw === null) return defaultTradingSettings(network);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return defaultTradingSettings(network);
  }
  const parsed = storedSettingsSchema.safeParse(json);
  if (!parsed.success) return defaultTradingSettings(network);
  return { maxOrderUsd: clampMaxOrderUsd(parsed.data.maxOrderUsd, network) };
}

/**
 * The upper limit of the size slider: the cap, and when the balance is known
 * and positive, at most balance x leverage (rounded down to $10). Never below
 * the $10 minimum, so the slider always has a range.
 */
export function sizeLimitUsd(input: {
  maxOrderUsd: number;
  balanceUsd: number | undefined;
  leverage: number;
}): number {
  const { maxOrderUsd, balanceUsd, leverage } = input;
  let limit = maxOrderUsd;
  if (balanceUsd !== undefined && balanceUsd > 0 && Number.isFinite(leverage) && leverage >= 1) {
    limit = Math.min(limit, Math.floor((balanceUsd * leverage) / 10) * 10);
  }
  return Math.max(MIN_ORDER_USD, limit);
}
