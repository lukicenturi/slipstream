import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import { z } from "zod";

import type { PerpAsset, PositionSide } from "@/lib/hyperliquid/schemas";

/*
 * Pure order logic for the testnet copy trade. A "market" order on
 * Hyperliquid is a limit order with time in force IOC and a price a little
 * through the mid. Prices and sizes follow the exchange's tick and lot rules.
 */

/** The exchange rejects orders below $10 notional. */
export const MIN_ORDER_USD = 10;
/** The IOC price goes 1 % through the mid. */
export const DEFAULT_SLIPPAGE = 0.01;

export class OrderTooSmallError extends Error {
  constructor() {
    super(`The order is below the $${MIN_ORDER_USD} minimum.`);
    this.name = "OrderTooSmallError";
  }
}

/** The asset of a coin in the testnet universe, or null when it is not listed. */
export function findAsset(universe: readonly PerpAsset[], coin: string): PerpAsset | null {
  return universe.find((asset) => asset.name === coin) ?? null;
}

/**
 * A perp price as the exchange accepts it: at most 5 significant figures and
 * at most 6 - szDecimals decimals, rounded down. Integers are always valid.
 * Throws when the price rounds to 0.
 */
export function roundPrice(px: number, szDecimals: number): string {
  return formatPrice(px, szDecimals, "perp");
}

/** A size rounded down to szDecimals. Throws when the size rounds to 0. */
export function roundSize(sz: number, szDecimals: number): string {
  return formatSize(sz, szDecimals);
}

/** A whole leverage inside [1, maxLeverage]. */
export function clampLeverage(wanted: number, maxLeverage: number): number {
  const max = Math.max(1, Math.floor(maxLeverage));
  if (!Number.isFinite(wanted)) return 1;
  return Math.min(max, Math.max(1, Math.round(wanted)));
}

/** The order wire shape that the SDK sends (`a` asset, `b` buy, `p` price, `s` size). */
export interface IocOrder {
  a: number;
  b: boolean;
  p: string;
  s: string;
  r: false;
  t: { limit: { tif: "Ioc" } };
}

export interface IocOrderInput {
  assetIndex: number;
  szDecimals: number;
  side: PositionSide;
  sizeUsd: number;
  mid: number;
  slippage?: number;
}

/**
 * Build an IOC order. Buy at mid * (1 + slippage), sell at mid * (1 - slippage).
 * The size is sizeUsd / mid, rounded down to szDecimals.
 * Throws OrderTooSmallError when the rounded size is 0 or below $10 at the mid.
 */
export function buildIocOrder(input: IocOrderInput): IocOrder {
  const { assetIndex, szDecimals, side, sizeUsd, mid, slippage = DEFAULT_SLIPPAGE } = input;
  if (!Number.isFinite(mid) || mid <= 0) throw new Error("The mid price is not known.");
  if (!Number.isFinite(sizeUsd) || sizeUsd < MIN_ORDER_USD) throw new OrderTooSmallError();

  let size: string;
  try {
    size = roundSize(sizeUsd / mid, szDecimals);
  } catch {
    // The SDK throws when the size rounds to 0.
    throw new OrderTooSmallError();
  }
  if (Number(size) * mid < MIN_ORDER_USD) throw new OrderTooSmallError();

  const isBuy = side === "long";
  const limitPx = isBuy ? mid * (1 + slippage) : mid * (1 - slippage);
  return {
    a: assetIndex,
    b: isBuy,
    p: roundPrice(limitPx, szDecimals),
    s: size,
    r: false,
    t: { limit: { tif: "Ioc" } },
  };
}

// ---------------------------------------------------------------------------
// Order response
// ---------------------------------------------------------------------------

const decimal = z.string().transform((value, ctx) => {
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isFinite(parsed)) {
    ctx.addIssue({ code: "custom", message: `Not a number: "${value}"` });
    return z.NEVER;
  }
  return parsed;
});

const orderStatusSchema = z.union([
  z.object({ filled: z.object({ totalSz: decimal, avgPx: decimal, oid: z.number() }) }),
  z.object({ resting: z.object({ oid: z.number() }) }),
  z.object({ error: z.string() }),
]);

/** `response.data.statuses` of an order response. */
export const OrderStatusesSchema = z.array(orderStatusSchema);

/** The body of a successful order request, and of an order with a per-order error. */
export const orderResponseSchema = z.object({
  status: z.literal("ok"),
  response: z.object({
    type: z.literal("order"),
    data: z.object({ statuses: z.array(z.unknown()) }),
  }),
});

export type OrderResult =
  | { kind: "filled"; totalSz: number; avgPx: number; oid: number }
  | { kind: "resting"; oid: number }
  | { kind: "error"; message: string };

/** The result of the first (and only) order in a response. */
export function summarizeOrderStatuses(statuses: unknown): OrderResult {
  const parsed = OrderStatusesSchema.safeParse(statuses);
  if (!parsed.success) return { kind: "error", message: "Unknown order status." };
  const [status] = parsed.data;
  if (!status) return { kind: "error", message: "The exchange returned no order status." };
  if ("filled" in status) return { kind: "filled", ...status.filled };
  if ("resting" in status) return { kind: "resting", oid: status.resting.oid };
  return { kind: "error", message: status.error };
}

/** Summarise a raw order response body, or null when it is not an order response. */
export function summarizeOrderResponse(body: unknown): OrderResult | null {
  const parsed = orderResponseSchema.safeParse(body);
  return parsed.success ? summarizeOrderStatuses(parsed.data.response.data.statuses) : null;
}

// ---------------------------------------------------------------------------
// Why the order button is disabled
// ---------------------------------------------------------------------------

export interface OrderBlockInput {
  asset: PerpAsset | null;
  mid: number | undefined;
  /** Available testnet balance in USD, undefined while it loads. */
  balanceUsd: number | undefined;
  sizeUsd: number;
  leverage: number;
}

/** The reason that blocks the order, or null when the order can go out. */
export function orderBlockReason(input: OrderBlockInput): string | null {
  const { asset, mid, balanceUsd, sizeUsd, leverage } = input;
  if (!asset) return "Not listed on testnet.";
  if (asset.isDelisted) return "Delisted on testnet.";
  if (mid === undefined) return "Waiting for the testnet price.";
  if (sizeUsd < MIN_ORDER_USD) return `The minimum order is $${MIN_ORDER_USD}.`;
  if (balanceUsd === undefined) return "Loading the testnet balance.";
  if (balanceUsd <= 0) return "No testnet balance.";
  if (sizeUsd / leverage > balanceUsd) return "The margin is above the testnet balance.";
  return null;
}

// ---------------------------------------------------------------------------
// Leverage before the order
// ---------------------------------------------------------------------------

/**
 * Whether to send updateLeverage before the order, and in which margin mode.
 * Without a position: always, cross unless the asset is isolated-only.
 * With a position: only when the leverage differs, in the position's mode.
 */
export function leverageUpdate(input: {
  asset: Pick<PerpAsset, "onlyIsolated">;
  leverage: number;
  position: { leverage: number; leverageType: "cross" | "isolated" } | undefined;
}): { isCross: boolean } | null {
  const { asset, leverage, position } = input;
  if (!position) return { isCross: !asset.onlyIsolated };
  if (position.leverage === leverage) return null;
  return { isCross: position.leverageType === "cross" && !asset.onlyIsolated };
}
