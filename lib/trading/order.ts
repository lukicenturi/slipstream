import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import { z } from "zod";

import type { PerpAsset, PositionSide } from "@/lib/hyperliquid/schemas";
import type { Network } from "@/lib/network";

import { MIN_ORDER_USD } from "./config";

/*
 * Pure order logic for the copy trade on both networks. A "market" order on
 * Hyperliquid is a limit order with time in force IOC and a price a little
 * through the mid. Prices and sizes follow the exchange's tick and lot rules.
 */

export { MIN_ORDER_USD };
/** The IOC price goes 1 % through the mid. */
export const DEFAULT_SLIPPAGE = 0.01;

export class OrderTooSmallError extends Error {
  constructor() {
    super(`The order is below the $${MIN_ORDER_USD} minimum.`);
    this.name = "OrderTooSmallError";
  }
}

const usdFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** The order size is above the per-order cap of the trading settings. */
export class OrderTooLargeError extends Error {
  constructor(maxOrderUsd: number) {
    super(`The order is above your cap of $${usdFormat.format(maxOrderUsd)}.`);
    this.name = "OrderTooLargeError";
  }
}

/** Throws OrderTooLargeError when the size is above the cap (or not a number). */
export function assertWithinCap(sizeUsd: number, maxOrderUsd: number): void {
  if (!Number.isFinite(sizeUsd) || sizeUsd > maxOrderUsd) throw new OrderTooLargeError(maxOrderUsd);
}

/** The asset of a coin in the network's universe, or null when it is not listed. */
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

/**
 * The order wire shape that the SDK sends (`a` asset, `b` buy, `p` price,
 * `s` size, `r` reduce-only). Opening orders send `r: false`; a close sends
 * `r: true`, so it can only shrink the position.
 */
export interface IocOrder {
  a: number;
  b: boolean;
  p: string;
  s: string;
  r: boolean;
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
 * The IOC limit price: the worst price that the order can fill at.
 * Buy at mid * (1 + slippage), sell at mid * (1 - slippage), rounded down to
 * the exchange's price rules.
 */
export function limitPrice(input: {
  mid: number;
  side: PositionSide;
  slippage: number;
  szDecimals: number;
}): string {
  const { mid, side, slippage, szDecimals } = input;
  const px = side === "long" ? mid * (1 + slippage) : mid * (1 - slippage);
  return roundPrice(px, szDecimals);
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
  return {
    a: assetIndex,
    b: isBuy,
    p: limitPrice({ mid, side, slippage, szDecimals }),
    s: size,
    r: false,
    t: { limit: { tif: "Ioc" } },
  };
}

// ---------------------------------------------------------------------------
// Close a position
// ---------------------------------------------------------------------------

/** The share of a position that a close sends, as a ratio in (0, 1]. */
export const CLOSE_PERCENT_PRESETS = [25, 50, 75, 100] as const;

/** A close that rounds to a size of 0, or a partial close below the $10 minimum. */
export class CloseTooSmallError extends Error {
  constructor() {
    super(`This close is below the $${MIN_ORDER_USD} minimum. Close more, or close it all.`);
    this.name = "CloseTooSmallError";
  }
}

export interface CloseOrderInput {
  assetIndex: number;
  szDecimals: number;
  /** The side of the open position. The close goes the other way. */
  positionSide: PositionSide;
  /** The absolute size of the open position, in coin. */
  positionSize: number;
  /** The share to close, in (0, 1]. 1 closes the whole position. */
  fraction: number;
  mid: number;
  slippage?: number;
}

/** A share in (0, 1] from a whole percent; anything outside is clamped. */
export function closeFraction(percent: number): number {
  if (!Number.isFinite(percent)) return 1;
  return Math.min(100, Math.max(1, Math.round(percent))) / 100;
}

/**
 * The close order: reduce-only IOC, the opposite side of the position.
 * Closing a long sells at mid * (1 - slippage); closing a short buys at
 * mid * (1 + slippage). The size is |position| * fraction, rounded down to
 * szDecimals. A full close sends the whole position size. A partial close
 * below $10 at the mid throws CloseTooSmallError; a full close does not,
 * because reduce-only lets the exchange close a small position.
 */
export function buildCloseOrder(input: CloseOrderInput): IocOrder {
  const {
    assetIndex,
    szDecimals,
    positionSide,
    positionSize,
    fraction,
    mid,
    slippage = DEFAULT_SLIPPAGE,
  } = input;
  if (!Number.isFinite(mid) || mid <= 0) throw new Error("The mid price is not known.");
  if (!Number.isFinite(positionSize) || positionSize <= 0) throw new CloseTooSmallError();
  const share = Math.min(1, Math.max(0, fraction));
  if (!(share > 0)) throw new CloseTooSmallError();

  let size: string;
  try {
    size = roundSize(Math.abs(positionSize) * share, szDecimals);
  } catch {
    // The SDK throws when the size rounds to 0.
    throw new CloseTooSmallError();
  }
  if (share < 1 && Number(size) * mid < MIN_ORDER_USD) throw new CloseTooSmallError();

  // The close is the opposite side: a long closes with a sell.
  const closeSide: PositionSide = positionSide === "long" ? "short" : "long";
  return {
    a: assetIndex,
    b: closeSide === "long",
    p: limitPrice({ mid, side: closeSide, slippage, szDecimals }),
    s: size,
    r: true,
    t: { limit: { tif: "Ioc" } },
  };
}

export interface ClosePreview {
  /** The size that the close sends, in coin. */
  sizeCoin: number;
  /** That size at the mid, in USD. */
  sizeUsd: number;
  /** The worst fill price (the IOC limit price). */
  worstPrice: number;
  /** The PnL that the close realises at the mid, before fees. */
  estPnl: number;
}

/**
 * What a close sends and realises, for the sheet and the review. Null when
 * the close cannot be built (no mid, or a size that rounds to 0).
 */
export function closePreview(input: CloseOrderInput & { entryPx: number }): ClosePreview | null {
  let order: IocOrder;
  try {
    order = buildCloseOrder(input);
  } catch (error) {
    if (!(error instanceof CloseTooSmallError)) return null;
    // Still show the numbers for a partial close below the minimum.
    const raw = Math.abs(input.positionSize) * Math.min(1, Math.max(0, input.fraction));
    if (!(raw > 0) || !Number.isFinite(input.mid) || input.mid <= 0) return null;
    const pnl = (input.mid - input.entryPx) * raw * (input.positionSide === "short" ? -1 : 1);
    const closeSide: PositionSide = input.positionSide === "long" ? "short" : "long";
    let worst: number;
    try {
      worst = Number(
        limitPrice({
          mid: input.mid,
          side: closeSide,
          slippage: input.slippage ?? DEFAULT_SLIPPAGE,
          szDecimals: input.szDecimals,
        }),
      );
    } catch {
      return null;
    }
    return { sizeCoin: raw, sizeUsd: raw * input.mid, worstPrice: worst, estPnl: pnl };
  }
  const sizeCoin = Number(order.s);
  const direction = input.positionSide === "short" ? -1 : 1;
  return {
    sizeCoin,
    sizeUsd: sizeCoin * input.mid,
    worstPrice: Number(order.p),
    estPnl: (input.mid - input.entryPx) * sizeCoin * direction,
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
  network: Network;
  asset: PerpAsset | null;
  mid: number | undefined;
  /** Available balance in USD on the network, undefined while it loads. */
  balanceUsd: number | undefined;
  sizeUsd: number;
  leverage: number;
  /** The per-order cap of the trading settings. */
  maxOrderUsd: number;
}

/** The reason that blocks the order, or null when the order can go out. */
export function orderBlockReason(input: OrderBlockInput): string | null {
  const { network, asset, mid, balanceUsd, sizeUsd, leverage, maxOrderUsd } = input;
  if (!asset) return `Not listed on ${network}.`;
  if (asset.isDelisted) return `Delisted on ${network}.`;
  if (mid === undefined) return `Waiting for the ${network} price.`;
  if (sizeUsd < MIN_ORDER_USD) return `The minimum order is $${MIN_ORDER_USD}.`;
  if (sizeUsd > maxOrderUsd)
    return `The size is above your cap of $${usdFormat.format(maxOrderUsd)}.`;
  if (balanceUsd === undefined) return `Loading the ${network} balance.`;
  if (balanceUsd <= 0) return `No ${network} balance.`;
  if (sizeUsd / leverage > balanceUsd) return `The margin is above the ${network} balance.`;
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
