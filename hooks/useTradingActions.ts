"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { numberToHex } from "viem";
import { toast } from "sonner";
import { useConfig } from "wagmi";
import { getConnection, getWalletClient, switchChain } from "wagmi/actions";
import { arbitrum, arbitrumSepolia } from "wagmi/chains";

import { forgetAgent, storeAgent } from "@/hooks/useAgent";
import { invalidateOpenOrders } from "@/hooks/useOpenOrders";
import { traderFillsKey, traderStateKey } from "@/hooks/useTrader";
import { readTradingSettings } from "@/hooks/useTradingSettings";
import { getAllMidsOnce, getFrontendOpenOrders } from "@/lib/hyperliquid/client";
import type { PerpAsset, Position, PositionSide } from "@/lib/hyperliquid/schemas";
import { HL, NETWORK } from "@/lib/network";
import {
  cancelLeftoverText,
  cancelOrdersSteps,
  placeThenCancel,
  refuseExistingTrailing,
  replaceTpslSteps,
  STOP_READ_FAILED_TEXT,
  STOP_SETTLING_TEXT,
  stopTrailingSteps,
  type CancelOrdersOutcome,
  type ReplaceError,
  type StopTrailingResult,
  type TrailingBook,
} from "@/lib/trading/actions";
import { createAgent, type StoredAgent } from "@/lib/trading/agent";
import { TRADING_LIMITS } from "@/lib/trading/config";
import { TradingError, toTradingError } from "@/lib/trading/errors";
import {
  approveAgent,
  createAgentClient,
  createApprovalClient,
  placeIocOrder,
  setLeverage,
} from "@/lib/trading/exchange";
import {
  assertWithinCap,
  buildCloseOrder,
  buildIocOrder,
  CloseTooSmallError,
  isFullClose,
  leverageUpdate,
  OrderTooLargeError,
  OrderTooSmallError,
  type OrderResult,
} from "@/lib/trading/order";
import {
  buildTriggerOrder,
  TriggerSizeError,
  validateTriggerPx,
  type TpslKind,
} from "@/lib/trading/tpsl";
import { initialStop, removeTrailing, upsertTrailing } from "@/lib/trading/trailing";

import {
  refreshTrailingConfigs,
  updateTrailingConfigs,
  withTrailingLock,
} from "./useTrailingStops";

/** The chain to switch to when the wallet refuses its current chain id in the signature. */
const FALLBACK_SIGNATURE_CHAIN = NETWORK === "mainnet" ? arbitrum : arbitrumSepolia;

/**
 * Approve a new agent with one signature of the connected wallet. The agent
 * expires after the network's TTL (24 h on mainnet, 7 days on testnet).
 * The signature domain uses the wallet's current chain. When the wallet
 * refuses that chain, it switches to Arbitrum One (mainnet) or Arbitrum
 * Sepolia (testnet) and tries once more.
 * The agent is stored only after the exchange accepts it.
 */
export function useApproveAgent(owner: string | undefined) {
  const config = useConfig();
  return useMutation<StoredAgent, TradingError>({
    mutationFn: async () => {
      if (!owner) throw new TradingError("api", "Connect a wallet first.");
      const agent = createAgent(NETWORK);
      try {
        const chainId = getConnection(config).chainId;
        if (chainId === undefined) throw new TradingError("api", "Connect a wallet first.");
        const wallet = await getWalletClient(config);
        await approveAgent(createApprovalClient(wallet, numberToHex(chainId)), agent);
      } catch (error) {
        const tradingError = toTradingError(error, { network: NETWORK });
        if (tradingError.kind !== "chain") throw tradingError;
        try {
          const chainId = FALLBACK_SIGNATURE_CHAIN.id;
          await switchChain(config, { chainId });
          const wallet = await getWalletClient(config, { chainId });
          await approveAgent(createApprovalClient(wallet, numberToHex(chainId)), agent);
        } catch (retryError) {
          throw toTradingError(retryError, { network: NETWORK });
        }
      }
      storeAgent(owner, agent);
      return agent;
    },
  });
}

export type OrderPhase = "leverage" | "order" | null;

export interface PlaceOrderInput {
  asset: PerpAsset;
  side: PositionSide;
  sizeUsd: number;
  leverage: number;
  /** The open position of this asset, when one exists. */
  position: Position | undefined;
}

/**
 * Set the leverage when needed, then place one IOC order with the agent.
 * The size must be inside the per-order cap of the trading settings (the
 * sheet clamps it too; this is defence in depth). The mid is read again
 * right before the order. When the exchange says the agent does not exist,
 * the local agent is removed so the user can approve a new one.
 */
export function usePlaceOrder(owner: string | undefined, agent: StoredAgent | null) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<OrderPhase>(null);

  const mutation = useMutation<OrderResult, TradingError, PlaceOrderInput>({
    mutationFn: async ({ asset, side, sizeUsd, leverage, position }) => {
      if (!owner || !agent) throw new TradingError("api", "Approve the agent first.");
      try {
        assertWithinCap(sizeUsd, readTradingSettings().maxOrderUsd);
        const client = createAgentClient(agent.privateKey);
        const update = leverageUpdate({ asset, leverage, position });
        if (update) {
          setPhase("leverage");
          await setLeverage(client, {
            assetIndex: asset.index,
            leverage,
            isCross: update.isCross,
            agentAddress: agent.address,
          });
        }
        setPhase("order");
        // A fresh REST read right before the order, on the build's network.
        const mids = await getAllMidsOnce(HL.infoUrl);
        const mid = mids[asset.name];
        if (mid === undefined) {
          throw new TradingError("api", `No ${NETWORK} price for ${asset.name}.`);
        }
        const order = buildIocOrder({
          assetIndex: asset.index,
          szDecimals: asset.szDecimals,
          side,
          sizeUsd,
          mid,
          slippage: TRADING_LIMITS[NETWORK].slippage,
        });
        return await placeIocOrder(client, order, agent.address);
      } catch (error) {
        if (error instanceof OrderTooSmallError || error instanceof OrderTooLargeError) {
          throw new TradingError("api", error.message);
        }
        throw toTradingError(error, { agentAddress: agent.address, network: NETWORK });
      }
    },
    onError: (error) => {
      if (error.kind === "agent" && owner) forgetAgent(owner);
    },
    onSettled: () => {
      setPhase(null);
      void queryClient.invalidateQueries({ queryKey: traderStateKey(owner) });
      void queryClient.invalidateQueries({ queryKey: traderFillsKey(owner) });
    },
  });

  return { ...mutation, phase };
}

export interface ClosePositionInput {
  asset: PerpAsset;
  /** The open position to close (main exchange only). */
  position: Position;
  /** The share to close, in (0, 1]. */
  fraction: number;
}

/** What happened to the coin's trailing stop after a full close. */
export type CloseTrailingOutcome =
  /** The config was removed and its stop order cancelled (`leftover`: an old order still open). */
  | { kind: "stopped"; leftover: number[] }
  /** The config stays: its stop order could not be cancelled. */
  | { kind: "error"; message: string };

export interface ClosePositionResult {
  result: OrderResult;
  /** Null when the close was partial or the coin had no trailing stop. */
  trailing: CloseTrailingOutcome | null;
}

/**
 * Close all or part of an open position with one reduce-only IOC order,
 * signed by the agent. The mid is read again right before the order. A
 * close only shrinks risk, so the per-order cap does not apply to it (the
 * cap limits new exposure). The review step in the sheet still comes first.
 * After a full close, the coin's trailing stop ends: its config is removed
 * and its stop order cancelled, inside the coin lock.
 */
export function useClosePosition(owner: string | undefined, agent: StoredAgent | null) {
  const queryClient = useQueryClient();

  return useMutation<ClosePositionResult, TradingError, ClosePositionInput>({
    mutationFn: async ({ asset, position, fraction }) => {
      if (!owner || !agent) throw new TradingError("api", "Approve the agent first.");
      try {
        const client = createAgentClient(agent.privateKey);
        // A fresh REST read right before the order, on the build's network.
        const mids = await getAllMidsOnce(HL.infoUrl);
        const mid = mids[asset.name];
        if (mid === undefined) {
          throw new TradingError("api", `No ${NETWORK} price for ${asset.name}.`);
        }
        const order = buildCloseOrder({
          assetIndex: asset.index,
          szDecimals: asset.szDecimals,
          positionSide: position.side,
          positionSize: Math.abs(position.size),
          fraction,
          mid,
          slippage: TRADING_LIMITS[NETWORK].slippage,
        });
        const result = await placeIocOrder(client, order, agent.address);
        const trailing = isFullClose(result, fraction, position.size)
          ? await endTrailingAfterClose(owner, asset.name, client, agent.address)
          : null;
        return { result, trailing };
      } catch (error) {
        if (error instanceof CloseTooSmallError) throw new TradingError("api", error.message);
        throw toTradingError(error, { agentAddress: agent.address, network: NETWORK });
      }
    },
    onError: (error) => {
      if (error.kind === "agent" && owner) forgetAgent(owner);
    },
    onSettled: () => {
      void invalidateOpenOrders(queryClient, owner);
      void queryClient.invalidateQueries({ queryKey: traderStateKey(owner) });
      void queryClient.invalidateQueries({ queryKey: traderFillsKey(owner) });
    },
  });
}

/**
 * After a full close: when the coin has a trailing stop, cancel its stop
 * order and remove the config, inside the coin lock (the steps of "Stop
 * and cancel"). A failure does not fail the close; it comes back as an
 * "error" outcome, and the tracker ends the config later when the book
 * shows no stop.
 */
async function endTrailingAfterClose(
  owner: string,
  coin: string,
  client: ReturnType<typeof createAgentClient>,
  agentAddress: string,
): Promise<CloseTrailingOutcome | null> {
  if (!refreshTrailingConfigs(owner).some((config) => config.coin === coin)) return null;
  let outcome: CloseTrailingOutcome | null = null;
  try {
    await withTrailingLock(
      owner,
      coin,
      async () => {
        const result = await stopTrailingSteps({
          config: refreshTrailingConfigs(owner).find((config) => config.coin === coin),
          cancel: true,
          client,
          agentAddress,
          fetchOrders: () => getFrontendOpenOrders(owner),
          remove: () => updateTrailingConfigs(owner, (list) => removeTrailing(list, coin)),
        });
        outcome = result.kind === "stopped" ? { kind: "stopped", leftover: result.leftover } : null;
      },
      { wait: true },
    );
  } catch (error) {
    const tradingError = toTradingError(error, { agentAddress, network: NETWORK });
    const message = tradingError.exchangeMessage ?? tradingError.message;
    // The Close tab has no retry for this step: it says what failed and points to Open orders.
    const readFailed = message === STOP_SETTLING_TEXT || message === STOP_READ_FAILED_TEXT;
    return { kind: "error", message: readFailed ? "The open orders could not be read." : message };
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Take profit, stop loss, trailing stop and cancel
// ---------------------------------------------------------------------------

/** A fresh REST mid of the coin on the build's network, right before an action. */
async function freshMid(coin: string): Promise<number> {
  const mids = await getAllMidsOnce(HL.infoUrl);
  const mid = mids[coin];
  if (mid === undefined) throw new TradingError("api", `No ${NETWORK} price for ${coin}.`);
  return mid;
}

/** Map trigger-order errors from the pure logic to a TradingError. */
function toActionError(error: unknown, agentAddress: string): TradingError {
  if (error instanceof TriggerSizeError) return new TradingError("api", error.message);
  return toTradingError(error, { agentAddress, network: NETWORK });
}

export interface SetTpslInput {
  asset: PerpAsset;
  position: Position;
  /** The take-profit trigger price; undefined leaves the take profit as it is. */
  tp?: number;
  /** The stop-loss trigger price; undefined leaves the stop loss as it is. */
  sl?: number;
  /** The open orders that the new ones replace (cancelled after the new ones are accepted). */
  replace: { tpOid?: number; slOid?: number };
}

export interface SetTpslResult {
  tp?: OrderResult;
  sl?: OrderResult;
  /** The old oids that are no longer open after the new orders went out. */
  cancelled: number[];
  /** Old orders that are still open because their cancel failed. */
  replaceErrors: ReplaceError[];
}

/**
 * Set the take profit and/or the stop loss of a position: reduce-only
 * market trigger orders for the whole position, in one `order` request
 * with `grouping: "positionTpsl"`. Only when the exchange accepts a new
 * order is the old order of that kind cancelled (place first, cancel
 * second), so the position is never without its stop. Each trigger price
 * is checked against a fresh mid. The per-order cap does not apply: these
 * orders can only close. The replace runs inside the coin lock and plans
 * the cancel against a fresh book (`replaceTpslSteps`): a replaced trailing
 * stop also cancels its live stop and its open previous oid, and its
 * trailing ends.
 */
export function useSetTpsl(owner: string | undefined, agent: StoredAgent | null) {
  const queryClient = useQueryClient();
  return useMutation<SetTpslResult, TradingError, SetTpslInput>({
    mutationFn: async ({ asset, position, tp, sl, replace }) => {
      if (!owner || !agent) throw new TradingError("api", "Approve the agent first.");
      try {
        const mid = await freshMid(asset.name);
        const wanted: { kind: TpslKind; px: number }[] = [];
        if (tp !== undefined) wanted.push({ kind: "tp", px: tp });
        if (sl !== undefined) wanted.push({ kind: "sl", px: sl });
        if (wanted.length === 0)
          throw new TradingError("api", "Enter a take profit or a stop loss.");
        const orders = wanted.map(({ kind, px }) => {
          const order = buildTriggerOrder({
            assetIndex: asset.index,
            szDecimals: asset.szDecimals,
            positionSide: position.side,
            positionSize: Math.abs(position.size),
            kind,
            triggerPx: px,
          });
          const reason = validateTriggerPx({
            kind,
            positionSide: position.side,
            triggerPx: Number(order.t.trigger.triggerPx),
            mid,
          });
          if (reason) throw new TradingError("api", reason);
          return { kind, order };
        });
        // Replacing an order of a coin with a trailing stop holds its coin lock, so no tracker
        // moves the stop meanwhile; inside it, the steps read the book fresh.
        const client = createAgentClient(agent.privateKey);
        const outcome = await underCoinLock(owner, asset.name, () =>
          replaceTpslSteps(client, {
            assetIndex: asset.index,
            orders,
            replace: { tp: replace.tpOid, sl: replace.slOid },
            grouping: "positionTpsl",
            agentAddress: agent.address,
            book: trailingBook(owner, asset.name),
          }),
        );
        return {
          ...outcome.results,
          cancelled: outcome.cancelled,
          replaceErrors: outcome.replaceErrors,
        };
      } catch (error) {
        throw toActionError(error, agent.address);
      }
    },
    onError: (error) => {
      if (error.kind === "agent" && owner) forgetAgent(owner);
    },
    onSettled: () => {
      void invalidateOpenOrders(queryClient, owner);
      void queryClient.invalidateQueries({ queryKey: traderStateKey(owner) });
    },
  });
}

/**
 * The trailing configs of one coin (read again from storage), the fresh
 * open orders of the owner, and the removal of ended configs, for the
 * cancel and replace steps. The steps call it inside the coin lock.
 */
function trailingBook(owner: string, coin: string): TrailingBook {
  return {
    readConfigs: () => refreshTrailingConfigs(owner).filter((config) => config.coin === coin),
    fetchOrders: () => getFrontendOpenOrders(owner),
    drop: (coins) =>
      updateTrailingConfigs(owner, (list) => list.filter((config) => !coins.includes(config.coin))),
  };
}

/**
 * Run `fn` inside the cross-tab trailing lock of the coin, waiting for it.
 * The lock is cheap when no tab trails the coin, and taking it always means
 * that a trailing stop started a moment ago in another tab is still seen.
 */
async function underCoinLock<T>(owner: string, coin: string, fn: () => Promise<T>): Promise<T> {
  const box: { out: { value: T } | null } = { out: null };
  await withTrailingLock(
    owner,
    coin,
    async () => {
      box.out = { value: await fn() };
    },
    { wait: true },
  );
  // With `wait: true` the lock always runs `fn`; this only guards the types.
  if (box.out === null) throw new TradingError("api", "The trailing lock did not run.");
  return box.out.value;
}

export interface CancelOrdersInput {
  /** The coin of the orders (it names the trailing lock). */
  coin: string;
  assetIndex: number;
  oids: number[];
}

/**
 * Cancel open orders of one asset with the agent, in one `cancel` request.
 * When the coin has a trailing stop, it holds the coin lock and reads the
 * book fresh inside it: a cancel of the trailing stop also cancels its live
 * stop and its open previous oid, and ends the config. An extra cancel that
 * fails shows one toast; that order stays open and stays in Open orders.
 */
export function useCancelOrders(owner: string | undefined, agent: StoredAgent | null) {
  const queryClient = useQueryClient();
  return useMutation<CancelOrdersOutcome, TradingError, CancelOrdersInput>({
    mutationFn: async ({ coin, assetIndex, oids }) => {
      if (!owner || !agent) throw new TradingError("api", "Approve the agent first.");
      try {
        const client = createAgentClient(agent.privateKey);
        return await underCoinLock(owner, coin, () =>
          cancelOrdersSteps({
            client,
            agentAddress: agent.address,
            assetIndex,
            oids,
            book: trailingBook(owner, coin),
          }),
        );
      } catch (error) {
        throw toActionError(error, agent.address);
      }
    },
    onSuccess: (outcome, { coin }) => {
      const [first] = outcome.leftover;
      if (first) toast(cancelLeftoverText(first, coin), { id: `cancel-leftover-${coin}` });
    },
    onError: (error) => {
      if (error.kind === "agent" && owner) forgetAgent(owner);
    },
    onSettled: () => {
      void invalidateOpenOrders(queryClient, owner);
    },
  });
}

export interface StartTrailingInput {
  asset: PerpAsset;
  position: Position;
  /** The trail distance as a ratio (0.02 = 2 %). */
  trailPct: number;
  /** An on-chain stop loss that the trailing stop replaces (cancelled after the new stop is accepted). */
  replaceOid?: number;
}

export interface StartTrailingResult {
  result: OrderResult;
  /** The old stop loss, when its cancel failed and it is still open. */
  replaceErrors: ReplaceError[];
}

/**
 * Start a trailing stop: place a reduce-only market stop-loss trigger for
 * the whole position at `trailPct` from a fresh mid, and store the config
 * with the returned oid. The tracker moves it later. The stop goes out
 * with `grouping: "normalTpsl"` and an explicit size, the same shape that
 * each `modify` sends (the size follows the position on every update).
 * An old stop loss is cancelled only after the new stop is accepted. It
 * runs inside the coin lock and refuses when the coin already has a
 * trailing stop (for example, one that another tab started a moment ago).
 */
export function useStartTrailing(owner: string | undefined, agent: StoredAgent | null) {
  const queryClient = useQueryClient();
  return useMutation<StartTrailingResult, TradingError, StartTrailingInput>({
    mutationFn: async ({ asset, position, trailPct, replaceOid }) => {
      if (!owner || !agent) throw new TradingError("api", "Approve the agent first.");
      try {
        // Inside the coin lock: no other tab starts or moves a trailing stop of this coin meanwhile.
        return await underCoinLock(owner, asset.name, async () => {
          refuseExistingTrailing(refreshTrailingConfigs(owner), asset.name);
          return startTrailingInLock(owner, agent, { asset, position, trailPct, replaceOid });
        });
      } catch (error) {
        throw toActionError(error, agent.address);
      }
    },
    onError: (error) => {
      if (error.kind === "agent" && owner) forgetAgent(owner);
    },
    onSettled: () => {
      void invalidateOpenOrders(queryClient, owner);
    },
  });
}

/** The steps of a trailing start, inside the coin lock: fresh mid, one stop order, the config. */
async function startTrailingInLock(
  owner: string,
  agent: StoredAgent,
  { asset, position, trailPct, replaceOid }: StartTrailingInput,
): Promise<StartTrailingResult> {
  const mid = await freshMid(asset.name);
  const stop = Number(initialStop(position.side, mid, trailPct, asset.szDecimals));
  const reason = validateTriggerPx({
    kind: "sl",
    positionSide: position.side,
    triggerPx: stop,
    mid,
  });
  if (reason) throw new TradingError("api", reason);
  const order = buildTriggerOrder({
    assetIndex: asset.index,
    szDecimals: asset.szDecimals,
    positionSide: position.side,
    positionSize: Math.abs(position.size),
    kind: "sl",
    triggerPx: stop,
  });
  const outcome = await placeThenCancel(createAgentClient(agent.privateKey), {
    assetIndex: asset.index,
    orders: [{ kind: "sl", order }],
    replace: { sl: replaceOid },
    grouping: "normalTpsl",
    agentAddress: agent.address,
    onPlaced: (results) => {
      const placed = results.sl;
      if (placed?.kind !== "resting") return;
      const now = Date.now();
      updateTrailingConfigs(owner, (list) =>
        upsertTrailing(list, {
          coin: asset.name,
          positionSide: position.side,
          trailPct,
          assetIndex: asset.index,
          szDecimals: asset.szDecimals,
          size: Math.abs(position.size),
          oid: placed.oid,
          stopPx: Number(order.t.trigger.triggerPx),
          highWater: mid,
          createdAt: now,
          updatedAt: now,
          lastModifyAt: now,
        }),
      );
    },
  });
  return {
    result: outcome.results.sl ?? { kind: "error", message: "No status for this order." },
    replaceErrors: outcome.replaceErrors,
  };
}

export interface StopTrailingInput {
  coin: string;
  /** True also cancels the on-chain stop; false keeps it where it is. */
  cancel: boolean;
}

/**
 * Stop a trailing stop. It holds the cross-tab trailing lock of the coin,
 * so no tracker moves the stop meanwhile. Without `cancel`, the config is
 * removed and the stop stays. With `cancel`, it reads the open orders
 * first, cancels the tracked stop and the previous oid of a settling move,
 * and removes the config only after the cancel settles (a success, or the
 * order is already gone); a failed cancel or a failed read keeps the
 * config and throws. When the config is already
 * gone (another tab or the tracker ended it), nothing is sent and the
 * result is "already-gone", so the sheet shows no success toast.
 */
export function useStopTrailing(owner: string | undefined, agent: StoredAgent | null) {
  const queryClient = useQueryClient();
  return useMutation<StopTrailingResult, TradingError, StopTrailingInput>({
    mutationFn: async ({ coin, cancel }) => {
      if (!owner) throw new TradingError("api", "Connect a wallet first.");
      if (cancel && !agent) throw new TradingError("api", "Approve the agent first.");
      let result: StopTrailingResult = { kind: "already-gone" };
      try {
        await withTrailingLock(
          owner,
          coin,
          async () => {
            const config = refreshTrailingConfigs(owner).find((entry) => entry.coin === coin);
            result = await stopTrailingSteps({
              config,
              cancel,
              client: cancel && agent ? createAgentClient(agent.privateKey) : null,
              agentAddress: agent?.address,
              fetchOrders: () => getFrontendOpenOrders(owner),
              remove: () => updateTrailingConfigs(owner, (list) => removeTrailing(list, coin)),
            });
          },
          { wait: true },
        );
      } catch (error) {
        throw toTradingError(error, { agentAddress: agent?.address, network: NETWORK });
      }
      return result;
    },
    onError: (error) => {
      if (error.kind === "agent" && owner) forgetAgent(owner);
    },
    onSettled: () => {
      void invalidateOpenOrders(queryClient, owner);
    },
  });
}
