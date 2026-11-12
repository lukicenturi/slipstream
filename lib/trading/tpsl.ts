import type { OpenOrder, PositionSide } from "@/lib/hyperliquid/schemas";

import { roundPrice, roundSize } from "./order";

/*
 * Pure logic for take-profit and stop-loss trigger orders on an open
 * position. They are on-chain trigger orders: reduce-only, on the opposite
 * side of the position, sized to the whole position, and they execute as a
 * market order with a 10 % slippage limit when the mark price reaches the
 * trigger (the same as Hyperliquid's own UI). They go out with
 * `grouping: "positionTpsl"`, so they follow the position size.
 */

/** Hyperliquid's UI uses 10 % slippage for market TP/SL. */
export const TPSL_MARKET_SLIPPAGE = 0.1;
/** A trigger closer than this to the mid (0.1 %) is refused. */
export const TRIGGER_MIN_DISTANCE = 0.001;

export type TpslKind = "tp" | "sl";

/** The trigger order wire shape (`t.trigger`). Always reduce-only and market. */
export interface TriggerOrder {
  a: number;
  b: boolean;
  p: string;
  s: string;
  r: true;
  t: { trigger: { isMarket: true; triggerPx: string; tpsl: TpslKind } };
}

/** The side of the order that closes a position: a long closes with a sell ("short"). */
export function triggerSide(positionSide: PositionSide): PositionSide {
  return positionSide === "long" ? "short" : "long";
}

/** +1 when the price must rise to reach the trigger, -1 when it must fall. */
function triggerDirection(kind: TpslKind, positionSide: PositionSide): 1 | -1 {
  const profit = positionSide === "long" ? 1 : -1;
  return kind === "tp" ? profit : profit === 1 ? -1 : 1;
}

const KIND_NAME: Record<TpslKind, string> = { tp: "take profit", sl: "stop loss" };

/**
 * Why a trigger price cannot be used, or null when it can. A take profit
 * must be beyond the mid in the profit direction, a stop loss in the loss
 * direction (long TP above, long SL below; short TP below, short SL above).
 * A trigger inside 0.1 % of the mid is refused too.
 */
export function validateTriggerPx(input: {
  kind: TpslKind;
  positionSide: PositionSide;
  triggerPx: number;
  mid: number | undefined;
}): string | null {
  const { kind, positionSide, triggerPx, mid } = input;
  if (!Number.isFinite(triggerPx) || triggerPx <= 0) return "Enter a price above 0.";
  if (mid === undefined || !Number.isFinite(mid) || mid <= 0) return "Waiting for the price.";
  const direction = triggerDirection(kind, positionSide);
  if ((triggerPx - mid) * direction <= 0) {
    const where = direction === 1 ? "above" : "below";
    const name = KIND_NAME[kind];
    return `A ${name} for a ${positionSide} must be ${where} the current price.`;
  }
  if (Math.abs(triggerPx - mid) / mid < TRIGGER_MIN_DISTANCE)
    return "Too close to the current price.";
  return null;
}

/** The position size rounds to 0, so no trigger order can cover it. */
export class TriggerSizeError extends Error {
  constructor() {
    super("The position is too small for a trigger order.");
    this.name = "TriggerSizeError";
  }
}

export interface TriggerOrderInput {
  assetIndex: number;
  szDecimals: number;
  positionSide: PositionSide;
  /** The position size in coin (the sign is ignored). */
  positionSize: number;
  kind: TpslKind;
  triggerPx: number;
  slippage?: number;
}

/** The limit price of a market trigger order: `slippage` through the trigger, rounded. */
export function triggerLimitPx(input: {
  triggerPx: number;
  positionSide: PositionSide;
  szDecimals: number;
  slippage?: number;
}): string {
  const slippage = input.slippage ?? TPSL_MARKET_SLIPPAGE;
  const isBuy = triggerSide(input.positionSide) === "long";
  const px = isBuy ? input.triggerPx * (1 + slippage) : input.triggerPx * (1 - slippage);
  return roundPrice(px, input.szDecimals);
}

/**
 * A take-profit or stop-loss trigger order for the whole position:
 * reduce-only, the opposite side, market on trigger with `p` 10 % through
 * the trigger price. Both prices follow the exchange's price rules.
 * Throws TriggerSizeError when the size rounds to 0.
 */
export function buildTriggerOrder(input: TriggerOrderInput): TriggerOrder {
  const { assetIndex, szDecimals, positionSide, positionSize, kind, triggerPx } = input;
  if (!Number.isFinite(triggerPx) || triggerPx <= 0) throw new Error("No trigger price.");
  let size: string;
  try {
    size = roundSize(Math.abs(positionSize), szDecimals);
  } catch {
    // The SDK throws when the size rounds to 0.
    throw new TriggerSizeError();
  }
  const trigger = roundPrice(triggerPx, szDecimals);
  return {
    a: assetIndex,
    b: triggerSide(positionSide) === "long",
    p: triggerLimitPx({
      triggerPx: Number(trigger),
      positionSide,
      szDecimals,
      slippage: input.slippage,
    }),
    s: size,
    r: true,
    t: { trigger: { isMarket: true, triggerPx: trigger, tpsl: kind } },
  };
}

/** The quick levels, in percent of the entry price. */
export const TP_LEVELS_PCT = [5, 10, 25, 50] as const;
export const SL_LEVELS_PCT = [2, 5, 10, 25] as const;

export interface QuickLevel {
  /** The percent of the level (always positive). */
  pct: number;
  /** "+10%" or "−5%": the price move from the entry. */
  label: string;
  px: number;
}

/**
 * Preset trigger prices from the entry. Take profit: +5, +10, +25 and +50 %
 * in the profit direction; stop loss: −2, −5, −10 and −25 % in the loss
 * direction. For a short the signs flip. With `szDecimals`, the prices are
 * rounded to the exchange's rules.
 */
export function quickLevels(
  kind: TpslKind,
  positionSide: PositionSide,
  entryPx: number,
  szDecimals?: number,
): QuickLevel[] {
  if (!Number.isFinite(entryPx) || entryPx <= 0) return [];
  const direction = triggerDirection(kind, positionSide);
  const levels = kind === "tp" ? TP_LEVELS_PCT : SL_LEVELS_PCT;
  return levels.map((pct) => {
    const raw = entryPx * (1 + (direction * pct) / 100);
    const px = szDecimals === undefined ? raw : Number(roundPrice(raw, szDecimals));
    return { pct, label: `${direction === 1 ? "+" : "−"}${pct}%`, px };
  });
}

/**
 * The text that a quick level writes into the price input: the price
 * rounded to the exchange's rules, so the input never shows a float tail
 * such as `77000.00000000001`. Without `szDecimals` (markets not loaded),
 * 5 significant figures.
 */
export function levelInputText(px: number, szDecimals: number | undefined): string {
  if (!Number.isFinite(px) || px <= 0) return "";
  return szDecimals === undefined ? String(Number(px.toPrecision(5))) : roundPrice(px, szDecimals);
}

export interface PnlAtPrice {
  /** The PnL if the whole position closes at the price, before fees. */
  pnl: number;
  /** That PnL over the margin at entry (entry value / leverage), as a ratio. */
  roe: number;
}

/** The PnL that closing the whole position at `px` realises, before fees. */
export function pnlAtPrice(
  position: { side: PositionSide; size: number; entryPx: number; leverage: number },
  px: number,
): PnlAtPrice | null {
  if (!Number.isFinite(px) || px <= 0) return null;
  const size = Math.abs(position.size);
  const direction = position.side === "long" ? 1 : -1;
  const pnl = (px - position.entryPx) * size * direction;
  const margin = (position.entryPx * size) / Math.max(1, position.leverage);
  return { pnl, roe: margin > 0 ? pnl / margin : 0 };
}

export type OpenOrderKind = "tp" | "sl" | "limit" | "other";

/** What an open order is: take profit, stop loss, a plain limit order, or something else. */
export function classifyOpenOrder(order: Pick<OpenOrder, "orderType" | "isTrigger">): {
  kind: OpenOrderKind;
  market: boolean;
} {
  const type = order.orderType;
  const market = /market$/i.test(type);
  if (/^take profit/i.test(type)) return { kind: "tp", market };
  if (/^stop/i.test(type)) return { kind: "sl", market };
  if (type === "Limit" && !order.isTrigger) return { kind: "limit", market: false };
  return { kind: "other", market };
}

/**
 * The take profit and the stop loss of a position: reduce-only trigger
 * orders of the coin. An order in `prefer` comes first (the live tracked
 * trailing stops, from `trailingLabelOids`), so during the settle window
 * after a trailing move the row shows the moved stop, not the order that
 * the move left behind. Then a position TP/SL; then the oldest.
 */
export function positionTpsl(
  openOrders: readonly OpenOrder[] | undefined,
  coin: string,
  prefer: ReadonlySet<number> = new Set(),
): { tp: OpenOrder | null; sl: OpenOrder | null } {
  const pick = (kind: "tp" | "sl"): OpenOrder | null => {
    const matches = (openOrders ?? []).filter(
      (order) =>
        order.coin === coin &&
        order.isTrigger &&
        order.reduceOnly &&
        classifyOpenOrder(order).kind === kind,
    );
    matches.sort(
      (a, b) =>
        Number(prefer.has(b.oid)) - Number(prefer.has(a.oid)) ||
        Number(b.isPositionTpsl) - Number(a.isPositionTpsl) ||
        a.timestamp - b.timestamp,
    );
    return matches[0] ?? null;
  };
  return { tp: pick("tp"), sl: pick("sl") };
}

/** A typed price: commas and spaces removed. Empty gives null; a bad value gives NaN. */
export function parsePriceInput(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === ".") return Number.NaN;
  return Number(cleaned);
}
