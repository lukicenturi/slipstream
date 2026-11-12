"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef } from "react";
import { toast } from "sonner";

import { forgetAgent, useAgent } from "@/hooks/useAgent";
import { useConnectedAddress } from "@/hooks/useConnectedAddress";
import {
  invalidateOpenOrders,
  OPEN_ORDERS_REFRESH_MS,
  useOpenOrdersSnapshot,
} from "@/hooks/useOpenOrders";
import { traderStateKey, useTraderState } from "@/hooks/useTrader";
import {
  readTrailingConfigs,
  refreshTrailingConfigs,
  setTrackerRunning,
  updateTrailingConfigs,
  useTrailingConfigs,
  withTrailingLock,
} from "@/hooks/useTrailingStops";
import { displaySymbol } from "@/lib/assets";
import { formatPrice } from "@/lib/format";
import { getFrontendOpenOrders } from "@/lib/hyperliquid/client";
import type { ClearinghouseState, OpenOrder } from "@/lib/hyperliquid/schemas";
import { midsStore } from "@/lib/hyperliquid/mids";
import { NETWORK } from "@/lib/network";
import type { StoredAgent } from "@/lib/trading/agent";
import { cancelOrders, createAgentClient, modifyOrder } from "@/lib/trading/exchange";
import { browserLocks, createTabLeader, type TabLeader } from "@/lib/trading/tabLock";
import {
  bestMid,
  nextTrailingStop,
  removeTrailing,
  TRAIL_MIN_INTERVAL_MS,
  trailingStorageKey,
  upsertTrailing,
  type TrailingConfig,
} from "@/lib/trading/trailing";
import {
  moveStep,
  reconcileStep,
  watchCleanupPending,
  type PendingWatch,
  type TrailingEvent,
  type TrailingStepDeps,
} from "@/lib/trading/trailingSteps";

/** Re-check every coin this often, so a move held back by the 15 s throttle still goes out. */
const RECHECK_MS = 5_000;
/** The position size refreshes this often while a trailing stop exists. */
const POSITION_REFRESH_MS = 30_000;

function endedToast(coin: string): void {
  toast(`Trailing stop for ${displaySymbol(coin)} ended: the stop order is gone.`, {
    id: `trailing-ended-${coin}`,
  });
}

function leftoverToast(coin: string, detail: string): void {
  toast(
    `The old trailing stop order for ${displaySymbol(coin)} is still open on ${NETWORK}; cancel it in Open orders. ${detail}`,
    { id: `trailing-leftover-${coin}` },
  );
}

function positionClosedToast(coin: string): void {
  toast(
    `Trailing stop for ${displaySymbol(coin)} ended: the position is closed. Its stop order is still open; cancel it in Open orders.`,
    { id: `trailing-ended-${coin}` },
  );
}

function waitingToast(coin: string): void {
  toast(
    `The trailing stop for ${displaySymbol(coin)} is waiting for the order book and does not move.`,
    { id: `trailing-waiting-${coin}` },
  );
}

function cleanedToast(coin: string): void {
  toast(`Removed the old trailing stop order for ${displaySymbol(coin)}.`, {
    id: `trailing-cleaned-${coin}`,
  });
}

/**
 * Moves the on-chain trailing stops of the connected owner while this tab
 * is open (trading builds only, a lazy chunk mounted once). It only wires
 * the pure steps of lib/trading/trailingSteps.ts to storage, the exchange,
 * the clock and toasts. On each mid tick of a configured coin it runs a
 * cheap `nextTrailingStop` check; when that gives a better stop, it takes
 * the cross-tab lock of the owner and coin and runs `moveStep` (read again,
 * fetch the open orders once, reconcile, check against the stored and the
 * on-chain stop, one `modify` with `a: true`, store). A tab that cannot
 * take the lock skips the tick, so two tabs never send two updates for one
 * stop. Updates only go in the favourable direction, at most every 15 s,
 * with a step of at least 0.1 %. It polls the open orders every 10 s and
 * runs `reconcileStep` per coin: it ends a config whose stop is gone (or
 * whose position is closed), adopts a better
 * on-chain stop, settles an unanswered move, and after a move cancels the
 * previous oid of the tracked stop if it is still open (and no other
 * order). It renders nothing.
 */
export default function TrailingStopTracker() {
  const owner = useConnectedAddress();
  const agent = useAgent(owner);
  const configs = useTrailingConfigs(owner);
  const queryClient = useQueryClient();
  const active = owner !== undefined && agent !== null && configs.length > 0;
  // The orders with the start time of their request, the `fetchedAt` of each reconcile.
  const openOrders = useOpenOrdersSnapshot(owner, { enabled: active });
  // Keeps the position size fresh for the rebuilt order (shared cache with the account page).
  useTraderState(owner, { enabled: active, refetchInterval: active ? POSITION_REFRESH_MS : false });

  // Serialises the work per coin inside this tab; the lock does it across tabs.
  const inFlight = useRef(new Set<string>());
  // Per coin: the best mid seen since the last stored update, for the config that started at
  // `createdAt`. A new config of the coin (another start time) resets it.
  const liveBest = useRef(new Map<string, { createdAt: number; best: number }>());
  // One toast per coin and error text, so a repeating failure does not flood the screen.
  const shownErrors = useRef(new Map<string, string>());
  // Per coin: no new move attempt (and no open-orders fetch) before this time.
  const nextAttemptAt = useRef(new Map<string, number>());
  // Per coin: since when the moves wait for the book (`cleanup-pending`).
  const pendingWatch = useRef(new Map<string, PendingWatch>());
  // One toast per failed cleanup ("coin:oid"); the cleanup itself retries on every poll.
  const shownCleanup = useRef(new Set<string>());
  // The fallback election, only when this browser has no Web Locks.
  const leader = useRef<TabLeader | null>(null);

  const running = owner !== undefined && agent !== null;
  useEffect(() => {
    setTrackerRunning(running);
    return () => setTrackerRunning(false);
  }, [running]);

  useEffect(() => {
    if (!owner || browserLocks()) return;
    const created = createTabLeader(`${trailingStorageKey(NETWORK, owner)}.leader`);
    leader.current = created;
    return () => {
      created?.close();
      leader.current = null;
    };
  }, [owner]);

  const isLeader = () => leader.current?.isLeader() ?? false;

  /** The best mid seen in memory for this config, or undefined when the coin's entry is of another config. */
  function seenBest(config: TrailingConfig): number | undefined {
    const entry = liveBest.current.get(config.coin);
    return entry && entry.createdAt === config.createdAt ? entry.best : undefined;
  }

  /** The best mid of a config, kept in memory between stored updates. */
  function trackBest(config: TrailingConfig, mid: number): number {
    const best = bestMid(
      config.positionSide,
      bestMid(config.positionSide, config.highWater, seenBest(config) ?? mid),
      mid,
    );
    // Keyed by coin only: a replaced config (new `createdAt`) drops the old entry here.
    liveBest.current.set(config.coin, { createdAt: config.createdAt, best });
    return best;
  }

  function forgetCoin(coin: string): void {
    liveBest.current.delete(coin);
    shownErrors.current.delete(coin);
    nextAttemptAt.current.delete(coin);
    pendingWatch.current.delete(coin);
    for (const key of [...shownCleanup.current]) {
      if (key.startsWith(`${coin}:`)) shownCleanup.current.delete(key);
    }
  }

  /** Storage, exchange and clock for the steps of one coin. */
  function stepDeps(ownerAddress: string, coin: string, signer: StoredAgent): TrailingStepDeps {
    return {
      read: () => refreshTrailingConfigs(ownerAddress).find((entry) => entry.coin === coin),
      save: (config) => updateTrailingConfigs(ownerAddress, (list) => upsertTrailing(list, config)),
      remove: () => updateTrailingConfigs(ownerAddress, (list) => removeTrailing(list, coin)),
      modify: (oid, order) =>
        modifyOrder(createAgentClient(signer.privateKey), oid, order, signer.address),
      cancel: async (entry) => {
        const [status] = await cancelOrders(
          createAgentClient(signer.privateKey),
          [entry],
          signer.address,
        );
        return status;
      },
      fetchOrders: () => getFrontendOpenOrders(ownerAddress),
      now: () => Date.now(),
    };
  }

  /** Toasts and memory for the events of a step. */
  function onEvents(ownerAddress: string, coin: string, events: readonly TrailingEvent[]): void {
    let touchedOrders = false;
    for (const event of events) {
      switch (event.kind) {
        case "moved":
          shownErrors.current.delete(coin);
          touchedOrders = true;
          break;
        case "move-error":
          if (shownErrors.current.get(coin) !== event.message) {
            shownErrors.current.set(coin, event.message);
            toast(
              `Trailing stop for ${displaySymbol(coin)} could not move from ${formatPrice(event.from)} on ${NETWORK}: ${event.message}`,
              { id: `trailing-error-${coin}` },
            );
          }
          break;
        case "ended":
          forgetCoin(coin);
          endedToast(coin);
          break;
        case "position-closed":
          forgetCoin(coin);
          positionClosedToast(coin);
          break;
        case "agent-gone":
          // The agent is gone on the exchange; the tracker stops until a new approval.
          forgetAgent(ownerAddress);
          break;
        case "cleaned":
          shownCleanup.current.delete(`${coin}:${event.oid}`);
          cleanedToast(coin);
          touchedOrders = true;
          break;
        case "cleanup-error":
          // The next poll tries again; one toast is enough.
          if (!shownCleanup.current.has(`${coin}:${event.oid}`)) {
            shownCleanup.current.add(`${coin}:${event.oid}`);
            leftoverToast(coin, event.message);
          }
          touchedOrders = true;
          break;
        case "skipped":
          if (event.reason === "fetch-failed") {
            // Try again after one full interval.
            nextAttemptAt.current.set(coin, Date.now() + TRAIL_MIN_INTERVAL_MS);
          }
          break;
      }
    }
    if (touchedOrders) void invalidateOpenOrders(queryClient, ownerAddress);
  }

  /**
   * After a move attempt: follow how long the moves wait for the book. After
   * 60 s, one toast, and the attempts slow from every 5 s to every 10 s.
   */
  function onMoveEvents(coin: string, events: readonly TrailingEvent[]): void {
    const now = Date.now();
    const watch = watchCleanupPending(pendingWatch.current.get(coin), events, now);
    if (watch.next) pendingWatch.current.set(coin, watch.next);
    else pendingWatch.current.delete(coin);
    if (watch.warn) waitingToast(coin);
    if (watch.slow) nextAttemptAt.current.set(coin, now + OPEN_ORDERS_REFRESH_MS);
  }

  /** False when the account query shows no position of the coin; undefined before it loads. */
  function hasPosition(ownerAddress: string, config: TrailingConfig): boolean | undefined {
    const state = queryClient.getQueryData<ClearinghouseState>(traderStateKey(ownerAddress));
    if (!state) return undefined;
    return state.positions.some(
      (entry) => entry.coin === config.coin && entry.side === config.positionSide,
    );
  }

  /** The live position size of a config, from the account query. */
  function liveSize(ownerAddress: string, config: TrailingConfig): number | undefined {
    const state = queryClient.getQueryData<ClearinghouseState>(traderStateKey(ownerAddress));
    const position = state?.positions.find(
      (entry) => entry.coin === config.coin && entry.side === config.positionSide,
    );
    return position ? Math.abs(position.size) : undefined;
  }

  const tick = useEffectEvent((coin: string) => {
    if (!owner || !agent || inFlight.current.has(coin)) return;
    if (Date.now() < (nextAttemptAt.current.get(coin) ?? 0)) return;
    const config = readTrailingConfigs(owner).find((entry) => entry.coin === coin);
    const mid = midsStore.get(coin);
    if (!config || mid === undefined) return;
    // A cheap check first: most ticks send nothing and need no lock and no fetch.
    const best = trackBest(config, mid);
    if (!nextTrailingStop({ ...config, highWater: best }, mid, Date.now())) return;

    // At most one open-orders fetch per coin in this time, also when the move is refused.
    nextAttemptAt.current.set(coin, Date.now() + RECHECK_MS);
    inFlight.current.add(coin);
    const signer = agent;
    void withTrailingLock(
      owner,
      coin,
      async () => {
        const events = await moveStep(stepDeps(owner, coin, signer), {
          mid: midsStore.get(coin) ?? mid,
          bestSeen: (current) => seenBest(current),
          liveSize: (current) => liveSize(owner, current),
          hasPosition: (current) => hasPosition(owner, current),
        });
        onEvents(owner, coin, events);
        onMoveEvents(coin, events);
      },
      { wait: false, isLeader },
    )
      .catch(() => undefined)
      .finally(() => inFlight.current.delete(coin));
  });

  // Mid ticks of the configured coins, plus a slow re-check for throttled moves.
  const coinsKey = active ? configs.map((config) => config.coin).join(",") : "";
  useEffect(() => {
    if (!coinsKey) return;
    const coins = coinsKey.split(",");
    const unsubscribes = coins.map((coin) => midsStore.subscribe(coin, () => tick(coin)));
    const timer = setInterval(() => coins.forEach((coin) => tick(coin)), RECHECK_MS);
    coins.forEach((coin) => tick(coin));
    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      clearInterval(timer);
    };
  }, [coinsKey]);

  // End a config whose stop is no longer open; adopt a new oid or a better on-chain stop;
  // after a move, cancel the previous oid of the tracked stop when it is still open.
  const reconcile = useEffectEvent(() => {
    if (!owner || !agent || !openOrders.data) return;
    // The request start, not the arrival time: the book can only predate the start.
    const { orders, fetchedAt }: { orders: readonly OpenOrder[]; fetchedAt: number } =
      openOrders.data;
    const signer = agent;
    for (const { coin } of readTrailingConfigs(owner)) {
      if (inFlight.current.has(coin)) continue;
      inFlight.current.add(coin);
      void withTrailingLock(
        owner,
        coin,
        async () => {
          const deps = stepDeps(owner, coin, signer);
          const config = deps.read();
          if (!config) return;
          const { events } = await reconcileStep(config, orders, fetchedAt, deps, {
            hasPosition: hasPosition(owner, config),
          });
          onEvents(owner, coin, events);
        },
        { wait: false, isLeader },
      )
        .catch(() => undefined)
        .finally(() => inFlight.current.delete(coin));
    }
  });
  useEffect(() => {
    if (active && openOrders.data) reconcile();
  }, [active, openOrders.data]);

  return null;
}
