import { displaySymbol } from "@/lib/assets";
import type { OpenOrder } from "@/lib/hyperliquid/schemas";

import { NETWORK } from "./config";
import { toTradingError, TradingError } from "./errors";
import { cancelOrders, placeTriggerOrders, type TradingClient } from "./exchange";
import { isCancelDone, type CancelStatus } from "./openOrders";
import type { OrderResult } from "./order";
import type { TpslKind, TriggerOrder } from "./tpsl";
import { planTrailingCancel, trailingStopOids, type TrailingConfig } from "./trailing";

/*
 * The exchange steps of the TP / SL and trailing actions, without React,
 * so the order of the calls has tests with a fake client. The hooks in
 * hooks/useTradingActions.ts read the mid, build the orders and call these.
 */

const KIND_LABEL: Record<TpslKind, string> = { tp: "take profit", sl: "stop loss" };

/** "The old stop loss is still open; cancel it in Open orders." */
export function replaceErrorText(kind: TpslKind): string {
  return `The old ${KIND_LABEL[kind]} is still open; cancel it in Open orders.`;
}

/** An old order that a new one replaced, but whose cancel failed. */
export interface ReplaceError {
  kind: TpslKind;
  oid: number;
  message: string;
  /** The exchange text, when there is one. */
  exchangeMessage?: string;
}

export interface PlaceThenCancelResult {
  results: Partial<Record<TpslKind, OrderResult>>;
  /** The old orders that are no longer open (cancelled, or already gone). */
  cancelled: number[];
  replaceErrors: ReplaceError[];
}

export interface PlaceThenCancelInput {
  assetIndex: number;
  orders: readonly { kind: TpslKind; order: TriggerOrder }[];
  /** The open orders that the new ones replace, by kind. */
  replace: Partial<Record<TpslKind, number>>;
  /**
   * More old orders to cancel with the replace of a kind, in the same
   * request (the previous oid of a trailing stop that the replace ends).
   * They go out only when the replace of that kind goes out.
   */
  alsoCancel?: Partial<Record<TpslKind, readonly number[]>>;
  grouping: "positionTpsl" | "normalTpsl";
  agentAddress: string;
  /** Runs right after the place, before any cancel (for example, to store a trailing config). */
  onPlaced?: (results: Partial<Record<TpslKind, OrderResult>>) => void;
}

/**
 * Place the new trigger orders first, in one `order` request. Then cancel
 * the old order of each kind whose new order the exchange accepted, in one
 * `cancel` request. Hyperliquid allows more than one TP or SL on a
 * position, so for a short time both are open, and the position is never
 * without its stop. A new order that the exchange refuses keeps its old
 * order. A cancel that fails is not thrown: it comes back in
 * `replaceErrors`, because the new orders are already on-chain.
 */
export async function placeThenCancel(
  client: TradingClient,
  input: PlaceThenCancelInput,
): Promise<PlaceThenCancelResult> {
  const { assetIndex, orders, replace, grouping, agentAddress } = input;
  const placed = await placeTriggerOrders(
    client,
    orders.map((entry) => entry.order),
    grouping,
    agentAddress,
  );
  const results: Partial<Record<TpslKind, OrderResult>> = {};
  orders.forEach(({ kind }, index) => {
    results[kind] = placed[index] ?? { kind: "error", message: "No status for this order." };
  });
  input.onPlaced?.(results);

  const toCancel = orders.flatMap(({ kind }) => {
    const oid = replace[kind];
    const result = results[kind];
    if (oid === undefined || result === undefined || result.kind === "error") return [];
    const extra = (input.alsoCancel?.[kind] ?? []).filter((other) => other !== oid);
    return [oid, ...extra].map((entry) => ({ kind, oid: entry }));
  });
  if (toCancel.length === 0) return { results, cancelled: [], replaceErrors: [] };

  let statuses: CancelStatus[];
  try {
    statuses = await cancelOrders(
      client,
      toCancel.map((entry) => ({ a: assetIndex, o: entry.oid })),
      agentAddress,
    );
  } catch (error) {
    const tradingError = toTradingError(error, { agentAddress, network: NETWORK });
    return {
      results,
      cancelled: [],
      replaceErrors: toCancel.map(({ kind, oid }) => ({
        kind,
        oid,
        message: replaceErrorText(kind),
        exchangeMessage: tradingError.exchangeMessage ?? tradingError.message,
      })),
    };
  }
  const cancelled: number[] = [];
  const replaceErrors: ReplaceError[] = [];
  toCancel.forEach(({ kind, oid }, index) => {
    const status = statuses[index];
    if (isCancelDone(status)) cancelled.push(oid);
    else
      replaceErrors.push({
        kind,
        oid,
        message: replaceErrorText(kind),
        exchangeMessage: status?.kind === "error" ? status.message : undefined,
      });
  });
  return { results, cancelled, replaceErrors };
}

/** Shown when "Stop and cancel" cannot read the book while a move settles (`previousOid` or `unsettled`). */
export const STOP_SETTLING_TEXT = "A move is settling, try again in a few seconds.";

/** Shown when "Stop and cancel" cannot read the book and no move settles. */
export const STOP_READ_FAILED_TEXT = "The open orders could not be read. Try again.";

export type StopTrailingResult =
  /**
   * The config was removed (after the cancel settled, when `cancel` was
   * asked). `leftover` holds the previous oid of the stop when its cancel
   * failed: that order is still open.
   */
  | { kind: "stopped"; statuses: CancelStatus[]; leftover: number[] }
  /** No config for the coin: another tab or the tracker ended it already. Nothing was sent. */
  | { kind: "already-gone" };

/**
 * Stop a trailing stop, inside the coin lock. Without a config (it ended
 * already), send nothing and return "already-gone". Without `cancel`,
 * remove the config at once; the stop stays where it is.
 *
 * With `cancel`: a move can be settling (the stored oid can be the order
 * that the last `modify` replaced, and the moved stop can have a new oid).
 * So fetch the open orders first, and find the tracked stop and the
 * previous oid on the book (`trailingStopOids`). Cancel the tracked stop
 * and the previous oid when it is still open, in one request. When the
 * book shows neither, cancel the stored oid (the exchange then answers
 * "already canceled, or filled", which counts as done). When the fetch
 * fails, refuse and keep the config: "A move is settling" while a move
 * settles, else "The open orders could not be read". Remove the config only after the
 * cancel of the tracked stop settles: a success, or the order is already
 * gone. A failed cancel of the tracked stop throws and keeps the config,
 * so the trailing goes on and the sheet shows the error.
 */
export async function stopTrailingSteps(input: {
  config:
    | Pick<
        TrailingConfig,
        "coin" | "assetIndex" | "oid" | "previousOid" | "stopPx" | "unsettled" | "pendingStopPx"
      >
    | undefined;
  cancel: boolean;
  client: TradingClient | null;
  agentAddress: string | undefined;
  /** The open orders of the owner, fresh from the info endpoint. */
  fetchOrders: () => Promise<readonly OpenOrder[]>;
  remove: () => void;
}): Promise<StopTrailingResult> {
  const { config, cancel, client, agentAddress, remove } = input;
  if (!config) return { kind: "already-gone" };
  if (!cancel) {
    remove();
    return { kind: "stopped", statuses: [], leftover: [] };
  }
  if (!client || !agentAddress) throw new TradingError("api", "Approve the agent first.");
  let orders: readonly OpenOrder[];
  try {
    orders = await input.fetchOrders();
  } catch (error) {
    const settling = config.previousOid !== undefined || config.unsettled === true;
    throw new TradingError("api", settling ? STOP_SETTLING_TEXT : STOP_READ_FAILED_TEXT, {
      cause: error,
    });
  }
  const { tracked, previous } = trailingStopOids(config, orders);
  const stop = tracked ?? config.oid;
  const targets = previous !== undefined && previous !== stop ? [stop, previous] : [stop];
  const statuses = await cancelOrders(
    client,
    targets.map((oid) => ({ a: config.assetIndex, o: oid })),
    agentAddress,
  );
  const [status] = statuses;
  if (!isCancelDone(status)) {
    throw new TradingError("api", "The stop order was not cancelled. The trailing goes on.", {
      exchangeMessage: status?.kind === "error" ? status.message : undefined,
    });
  }
  remove();
  const leftover = targets.slice(1).filter((_, index) => !isCancelDone(statuses[index + 1]));
  return { kind: "stopped", statuses, leftover };
}

// ---------------------------------------------------------------------------
// Cancel and replace of orders that can be a trailing stop
// ---------------------------------------------------------------------------

/** What a cancel or a replace needs to see the trailing stops of one coin. */
export interface TrailingBook {
  /** The trailing configs of the coin, read again from storage. Call it inside the coin lock. */
  readConfigs: () => readonly TrailingConfig[];
  /** The open orders of the owner, fresh from the info endpoint. */
  fetchOrders: () => Promise<readonly OpenOrder[]>;
  /** Remove the trailing configs of these coins. */
  drop: (coins: readonly string[]) => void;
}

/**
 * The fresh book when the coin has a trailing config, else []. A failed
 * read refuses the action: nothing was sent and nothing changed.
 */
async function freshBook(
  configs: readonly TrailingConfig[],
  fetchOrders: () => Promise<readonly OpenOrder[]>,
): Promise<readonly OpenOrder[]> {
  if (configs.length === 0) return [];
  try {
    return await fetchOrders();
  } catch (error) {
    throw new TradingError("api", STOP_READ_FAILED_TEXT, { cause: error });
  }
}

/** An extra cancel of a trailing stop that failed: that order is still open. */
export interface CancelLeftover {
  oid: number;
  /**
   * "previous": the order that the last move of an ended trailing stop left
   * behind. "stop": the live trailing stop; its config stays and the
   * trailing goes on.
   */
  role: "previous" | "stop";
  /** The exchange text, when there is one. */
  exchangeMessage?: string;
}

export interface CancelOrdersOutcome {
  /** One status per asked oid, in order. */
  statuses: CancelStatus[];
  /** The extra cancels that failed (see `CancelLeftover`). */
  leftover: CancelLeftover[];
}

/**
 * Cancel open orders of one asset in one `cancel` request. Call it inside
 * the coin lock. When the coin has a trailing config, read the book fresh
 * first and plan with it (`planTrailingCancel`): a cancel of the trailing
 * stop (the live tracked stop, or the stored oid) also cancels the live
 * stop and the open previous oid, in the same request, and removes the
 * config when the cancel of the live stop is done. When the book cannot be
 * read, refuse: nothing is sent.
 */
export async function cancelOrdersSteps(input: {
  client: TradingClient;
  agentAddress: string;
  assetIndex: number;
  oids: readonly number[];
  book: TrailingBook;
}): Promise<CancelOrdersOutcome> {
  const { client, agentAddress, assetIndex, oids, book } = input;
  const configs = book.readConfigs();
  const plan = planTrailingCancel(configs, oids, await freshBook(configs, book.fetchOrders));
  const all = await cancelOrders(
    client,
    plan.oids.map((oid) => ({ a: assetIndex, o: oid })),
    agentAddress,
  );
  const statusOf = (oid: number) => all[plan.oids.indexOf(oid)];
  const ended = plan.ending.filter((entry) => isCancelDone(statusOf(entry.stop)));
  if (ended.length > 0) book.drop(ended.map((entry) => entry.coin));
  const stops = new Set(plan.ending.map((entry) => entry.stop));
  const leftover = plan.oids.slice(oids.length).flatMap((oid): CancelLeftover[] => {
    const status = statusOf(oid);
    if (isCancelDone(status)) return [];
    return [
      {
        oid,
        role: stops.has(oid) ? "stop" : "previous",
        ...(status?.kind === "error" ? { exchangeMessage: status.message } : {}),
      },
    ];
  });
  return { statuses: all.slice(0, oids.length), leftover };
}

/** "The old trailing stop order 424242 is still open; cancel it in Open orders." */
export function cancelLeftoverText(leftover: CancelLeftover, coin: string): string {
  return leftover.role === "previous"
    ? `The old trailing stop order ${leftover.oid} is still open; cancel it in Open orders.`
    : `The trailing stop order ${leftover.oid} for ${displaySymbol(coin)} is still open; the trailing goes on.`;
}

export interface ReplaceTpslResult extends PlaceThenCancelResult {
  /** The coins whose trailing stop the replace ended (its config was removed). */
  endedTrailing: string[];
}

/**
 * Replace the TP and / or the SL of a position: `placeThenCancel` with the
 * old orders planned against a fresh book. Call it inside the coin lock.
 * When the coin has a trailing config, read the book first: a replaced
 * stop that is the trailing stop (the live tracked stop, or the stored oid)
 * also cancels the live stop and the open previous oid, in the same cancel
 * request, and the config ends when the cancel of the live stop is done.
 * When the book cannot be read, refuse: nothing is sent.
 */
export async function replaceTpslSteps(
  client: TradingClient,
  input: Omit<PlaceThenCancelInput, "alsoCancel"> & { book: TrailingBook },
): Promise<ReplaceTpslResult> {
  const { book, replace } = input;
  const kinds = (["tp", "sl"] as const).filter((kind) => replace[kind] !== undefined);
  const configs = kinds.length > 0 ? book.readConfigs() : [];
  const orders = await freshBook(configs, book.fetchOrders);
  const alsoCancel: Partial<Record<TpslKind, readonly number[]>> = {};
  const ending: { coin: string; stop: number }[] = [];
  for (const kind of kinds) {
    const oid = replace[kind];
    if (oid === undefined) continue;
    const plan = planTrailingCancel(configs, [oid], orders);
    alsoCancel[kind] = plan.oids.slice(1);
    ending.push(...plan.ending);
  }
  const placed = await placeThenCancel(client, { ...input, alsoCancel });
  const endedTrailing = [
    ...new Set(
      ending.filter((entry) => placed.cancelled.includes(entry.stop)).map((entry) => entry.coin),
    ),
  ];
  if (endedTrailing.length > 0) book.drop(endedTrailing);
  return { ...placed, endedTrailing };
}

/** Refuse to start a second trailing stop on a coin. Call it inside the coin lock. */
export function refuseExistingTrailing(configs: readonly TrailingConfig[], coin: string): void {
  if (configs.some((config) => config.coin === coin)) {
    throw new TradingError("api", `A trailing stop for ${displaySymbol(coin)} already exists.`);
  }
}
