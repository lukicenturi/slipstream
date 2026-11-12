import type { OpenOrder } from "@/lib/hyperliquid/schemas";

import { TradingError } from "./errors";
import { isCancelDone, isOrderGoneMessage, type CancelStatus } from "./openOrders";
import { buildTriggerOrder, type TriggerOrder } from "./tpsl";
import {
  bestMid,
  isFavourableMove,
  isFavourableOnChain,
  nextTrailingStop,
  planModifyCleanup,
  RECONCILE_GRACE_MS,
  reconcileTrailing,
  trailingStopOids,
  type TrailingConfig,
} from "./trailing";

/*
 * The steps of the trailing stop tracker, without React. The tracker
 * (components/providers/TrailingStopTracker.tsx) runs each step inside the
 * cross-tab lock of the owner and coin, and gives it the storage, the
 * exchange calls and the clock as functions. The steps return events; the
 * tracker shows toasts for them. Tests use fakes for every function.
 */

/** What a step needs from the outside world. */
export interface TrailingStepDeps {
  /** The config of the coin, read again from storage (another tab may have written). */
  read: () => TrailingConfig | undefined;
  /** Store this config of the coin (add or replace). */
  save: (config: TrailingConfig) => void;
  /** Remove the config of the coin. */
  remove: () => void;
  /** One `modify` of the stop (with `a: true`). Throws a TradingError when refused. */
  modify: (oid: number, order: TriggerOrder) => Promise<void>;
  /** One `cancel` of one order. Throws a TradingError when the request fails. */
  cancel: (cancel: { a: number; o: number }) => Promise<CancelStatus | undefined>;
  /** The open orders of the owner, fresh from the info endpoint. */
  fetchOrders: () => Promise<OpenOrder[]>;
  now: () => number;
}

export type TrailingEvent =
  /** The stop moved with one `modify`. */
  | { kind: "moved"; oid: number; from: number; to: number }
  /** The `modify` failed; the stop stays where it is. */
  | { kind: "move-error"; from: number; message: string }
  /**
   * The stop is gone (filled or cancelled): the config was removed. Also
   * when the position is gone too: the stop most likely filled.
   */
  | { kind: "ended" }
  /**
   * The position is closed but its stop is still on the book: the config
   * was removed. The stop order stays (it is reduce-only); the user can
   * cancel it in Open orders.
   */
  | { kind: "position-closed" }
  /** The exchange does not know the agent: forget it. */
  | { kind: "agent-gone" }
  /** The cleanup cancelled the previous oid of the tracked stop. */
  | { kind: "cleaned"; oid: number }
  /**
   * The cleanup cancel of the previous oid failed: that order is still
   * open. `previousOid` stays, so the next open-orders check tries again.
   */
  | { kind: "cleanup-error"; oid: number; message: string }
  /** Nothing was sent. */
  | { kind: "skipped"; reason: SkipReason };

export type SkipReason =
  /** No config for the coin. */
  | "no-config"
  /** No better stop, or the 15 s or 0.1 % throttle holds it back. */
  | "no-move"
  /** The open orders could not be read: try again after one interval. */
  | "fetch-failed"
  /**
   * The book does not show the last move yet: its previous oid waits for
   * the cleanup, or an unanswered move waits for the book.
   */
  | "cleanup-pending"
  /** The candidate is not better than the stop on the book. */
  | "on-chain"
  /** The order could not be built (for example, a size of zero). */
  | "size";

function asTradingError(error: unknown): TradingError {
  return error instanceof TradingError ? error : new TradingError("api", String(error));
}

function errorText(error: TradingError): string {
  return error.exchangeMessage ?? error.message;
}

function withoutPreviousOid(config: TrailingConfig): TrailingConfig {
  const next = { ...config };
  delete next.previousOid;
  return next;
}

function withoutUnsettled(config: TrailingConfig): TrailingConfig {
  const next = { ...config };
  delete next.unsettled;
  delete next.pendingStopPx;
  return next;
}

/** What a reconcile knows about the position, from the account query. */
export interface ReconcileContext {
  /** False when the account query shows no position of the coin; undefined when unknown. */
  hasPosition?: boolean;
}

/**
 * Compare the config of a coin with an open-orders snapshot fetched at
 * `fetchedAt`, and act on it. Nothing ends a config within 3 s of its last
 * change, because the snapshot may predate it.
 * 1. The account query shows no position of the coin: remove the config.
 *    When the book shows no stop of the config either, the stop most likely
 *    filled ("ended"); when the stop is still on the book, the position was
 *    closed some other way ("position-closed"), and the stop stays.
 * 2. After a `modify` that did not answer (`unsettled`): a stop at the
 *    pending price means that it landed, so the pending price becomes the
 *    stored price and step 3 cleans up. A stop at the stored price (or the
 *    stored oid open) means that it did not land: clear the move. With
 *    neither, step 4 ends the config.
 * 3. After a move (`previousOid` set): when the book shows the stop at the
 *    stored price, adopt its oid if it changed, and cancel the previous oid
 *    when it is still open. `previousOid` is cleared only when that cancel
 *    succeeds or the order is already gone; after a failure it stays, and
 *    the next check tries again. No other order is ever cancelled.
 * 4. Then `reconcileTrailing`: end a config whose stop is gone, adopt a new
 *    oid at the stored price, or store a better on-chain trigger price.
 * Returns the config after the step (null when it ended) and the events.
 */
export async function reconcileStep(
  config: TrailingConfig,
  orders: readonly OpenOrder[],
  fetchedAt: number,
  deps: Pick<TrailingStepDeps, "save" | "remove" | "cancel" | "now">,
  context: ReconcileContext = {},
): Promise<{ config: TrailingConfig | null; events: TrailingEvent[] }> {
  const events: TrailingEvent[] = [];
  let current = config;
  const settled = fetchedAt >= current.updatedAt + RECONCILE_GRACE_MS;

  if (settled && context.hasPosition === false) {
    const onBook = trailingStopOids(current, orders);
    const stopGone = onBook.tracked === undefined && onBook.previous === undefined;
    deps.remove();
    return { config: null, events: [{ kind: stopGone ? "ended" : "position-closed" }] };
  }

  if (settled && current.unsettled) {
    const pending = current.pendingStopPx;
    const landed =
      pending !== undefined && planModifyCleanup({ ...current, stopPx: pending }, orders).found;
    if (landed) {
      // The unanswered modify reached the exchange: its price is the stop now.
      current = withoutUnsettled({ ...current, stopPx: pending });
      deps.save(current);
    } else if (
      orders.some((order) => order.oid === current.oid) ||
      planModifyCleanup(current, orders).found
    ) {
      // It did not land: the stop is where it was.
      current = withoutPreviousOid(withoutUnsettled(current));
      deps.save(current);
    }
  }

  if (current.previousOid !== undefined && settled) {
    const plan = planModifyCleanup(current, orders);
    if (plan.found) {
      if (plan.adoptOid !== undefined) {
        current = { ...current, oid: plan.adoptOid };
        if (plan.cancelOid !== undefined) deps.save(current);
      }
      if (plan.cancelOid === undefined) {
        current = withoutPreviousOid(current);
        deps.save(current);
      } else {
        const oid = plan.cancelOid;
        let done = false;
        try {
          const status = await deps.cancel({ a: current.assetIndex, o: oid });
          done = isCancelDone(status);
          if (status?.kind === "success") events.push({ kind: "cleaned", oid });
          else if (!done)
            events.push({
              kind: "cleanup-error",
              oid,
              message: status?.kind === "error" ? status.message : "No status for this cancel.",
            });
        } catch (error) {
          const tradingError = asTradingError(error);
          if (tradingError.kind === "agent") events.push({ kind: "agent-gone" });
          events.push({ kind: "cleanup-error", oid, message: errorText(tradingError) });
        }
        if (done) {
          current = withoutPreviousOid(current);
          deps.save(current);
        }
      }
    }
  }

  const result = reconcileTrailing(current, orders, fetchedAt);
  if (result.kind === "gone") {
    deps.remove();
    events.push({ kind: "ended" });
    return { config: null, events };
  }
  if (result.kind === "adopt") {
    current = { ...current, oid: result.oid, updatedAt: deps.now() };
    deps.save(current);
  } else if (result.kind === "keep" && result.stopPx !== undefined) {
    // The on-chain stop is better than the stored one: it is the truth.
    current = { ...current, stopPx: result.stopPx, updatedAt: deps.now() };
    deps.save(current);
  }
  return { config: current, events };
}

/** A `cleanup-pending` that lasts longer than this shows one toast and slows the checks. */
export const CLEANUP_PENDING_WARN_MS = 60_000;

/** Since when the moves of a coin wait for the book, and whether the toast showed. */
export interface PendingWatch {
  since: number;
  warned: boolean;
}

/**
 * Follow how long the moves of a coin wait for the book (`cleanup-pending`).
 * Any other outcome resets it. After 60 s, `warn` is true once (show one
 * toast) and `slow` stays true (check at the normal 10 s interval, not 5 s).
 */
export function watchCleanupPending(
  previous: PendingWatch | undefined,
  events: readonly TrailingEvent[],
  now: number,
): { next: PendingWatch | undefined; warn: boolean; slow: boolean } {
  const pending = events.some(
    (event) => event.kind === "skipped" && event.reason === "cleanup-pending",
  );
  if (!pending) return { next: undefined, warn: false, slow: false };
  const since = previous?.since ?? now;
  const slow = now - since > CLEANUP_PENDING_WARN_MS;
  const warned = previous?.warned ?? false;
  return { next: { since, warned: warned || slow }, warn: slow && !warned, slow };
}

export interface MoveInput {
  /** The live mid of the coin. */
  mid: number;
  /** The best mid seen in memory for this config since its last stored update, if any. */
  bestSeen: (config: TrailingConfig) => number | undefined;
  /** The live position size in coin, when the account query has it. */
  liveSize: (config: TrailingConfig) => number | undefined;
  /** False when the account query shows no position of the coin; undefined when unknown. */
  hasPosition?: (config: TrailingConfig) => boolean | undefined;
}

/**
 * One trailing move, inside the lock:
 * 1. Read the config again and compute the next stop. Nothing to move: stop.
 * 2. Fetch the open orders once (one REST call per move). A failed fetch
 *    skips the move.
 * 3. Run `reconcileStep` on that fresh snapshot (end, adopt, cleanup). A
 *    move waits while the book does not show the last move.
 * 4. Compute again, check the candidate against the stored stop and the
 *    fresh on-chain stop, then send one `modify` and store the new stop
 *    with `previousOid` = the oid before the move.
 * An "agent" error asks to forget the agent; an "order gone" error ends the
 * config. A "network" error (no answer) marks the config `unsettled` with
 * the sent price in `pendingStopPx`, and the next reconcile finds out if it
 * landed. Any other error keeps the stop and waits one full interval.
 */
export async function moveStep(deps: TrailingStepDeps, input: MoveInput): Promise<TrailingEvent[]> {
  const first = deps.read();
  if (!first) return [{ kind: "skipped", reason: "no-config" }];
  const highWaterOf = (config: TrailingConfig) =>
    bestMid(
      config.positionSide,
      bestMid(config.positionSide, config.highWater, input.bestSeen(config) ?? input.mid),
      input.mid,
    );
  if (!nextTrailingStop({ ...first, highWater: highWaterOf(first) }, input.mid, deps.now())) {
    return [{ kind: "skipped", reason: "no-move" }];
  }

  // The time before the request: the snapshot is at least this fresh.
  const fetchedAt = deps.now();
  let orders: OpenOrder[];
  try {
    orders = await deps.fetchOrders();
  } catch {
    return [{ kind: "skipped", reason: "fetch-failed" }];
  }
  const reconciled = await reconcileStep(first, orders, fetchedAt, deps, {
    hasPosition: input.hasPosition?.(first),
  });
  const events = reconciled.events;
  const config = reconciled.config;
  if (!config || events.some((event) => event.kind === "agent-gone")) return events;
  if (config.previousOid !== undefined || config.unsettled) {
    return [...events, { kind: "skipped", reason: "cleanup-pending" }];
  }

  const now = deps.now();
  const next = nextTrailingStop({ ...config, highWater: highWaterOf(config) }, input.mid, now);
  if (!next) return [...events, { kind: "skipped", reason: "no-move" }];
  // Defence in depth: never move a stop the other way, against the stored or the on-chain stop.
  if (!isFavourableMove(config.positionSide, config.stopPx, next.stopPx)) {
    return [...events, { kind: "skipped", reason: "no-move" }];
  }
  if (!isFavourableOnChain(config, next.stopPx, orders)) {
    return [...events, { kind: "skipped", reason: "on-chain" }];
  }

  const size = input.liveSize(config) ?? config.size;
  let order: TriggerOrder;
  try {
    order = buildTriggerOrder({
      assetIndex: config.assetIndex,
      szDecimals: config.szDecimals,
      positionSide: config.positionSide,
      positionSize: size,
      kind: "sl",
      triggerPx: next.stopPx,
    });
  } catch {
    return [...events, { kind: "skipped", reason: "size" }];
  }

  try {
    await deps.modify(config.oid, order);
  } catch (error) {
    const tradingError = asTradingError(error);
    if (tradingError.kind === "agent") return [...events, { kind: "agent-gone" }];
    if (isOrderGoneMessage(errorText(tradingError))) {
      deps.remove();
      return [...events, { kind: "ended" }];
    }
    if (tradingError.kind === "network") {
      // No answer: the modify may have landed. Keep both prices until the book says which.
      deps.save({
        ...config,
        highWater: next.highWater,
        updatedAt: now,
        lastModifyAt: now,
        previousOid: config.oid,
        unsettled: true,
        pendingStopPx: Number(order.t.trigger.triggerPx),
      });
      return [
        ...events,
        { kind: "move-error", from: config.stopPx, message: errorText(tradingError) },
      ];
    }
    // Keep the current stop (it is still on-chain) and wait a full interval before the next try.
    deps.save({ ...config, lastModifyAt: now });
    return [
      ...events,
      { kind: "move-error", from: config.stopPx, message: errorText(tradingError) },
    ];
  }
  const done = deps.now();
  const to = Number(order.t.trigger.triggerPx);
  deps.save({
    ...config,
    stopPx: to,
    highWater: next.highWater,
    size,
    updatedAt: done,
    lastModifyAt: done,
    previousOid: config.oid,
  });
  return [...events, { kind: "moved", oid: config.oid, from: config.stopPx, to }];
}
