"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { numberToHex } from "viem";
import { useConfig } from "wagmi";
import { getConnection, getWalletClient, switchChain } from "wagmi/actions";
import { arbitrum, arbitrumSepolia } from "wagmi/chains";

import { forgetAgent, storeAgent } from "@/hooks/useAgent";
import { traderFillsKey, traderStateKey } from "@/hooks/useTrader";
import { readTradingSettings } from "@/hooks/useTradingSettings";
import { getAllMidsOnce } from "@/lib/hyperliquid/client";
import type { PerpAsset, Position, PositionSide } from "@/lib/hyperliquid/schemas";
import { HL, NETWORK } from "@/lib/network";
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
  buildIocOrder,
  leverageUpdate,
  OrderTooLargeError,
  OrderTooSmallError,
  type OrderResult,
} from "@/lib/trading/order";

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
