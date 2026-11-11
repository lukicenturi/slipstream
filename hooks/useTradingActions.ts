"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { numberToHex } from "viem";
import { useConfig } from "wagmi";
import { getConnection, getWalletClient, switchChain } from "wagmi/actions";
import { arbitrumSepolia } from "wagmi/chains";

import { forgetAgent, storeAgent } from "@/hooks/useAgent";
import { traderFillsKey, traderStateKey } from "@/hooks/useTrader";
import { getAllMidsOnce } from "@/lib/hyperliquid/client";
import type { PerpAsset, Position, PositionSide } from "@/lib/hyperliquid/schemas";
import { HL } from "@/lib/network";
import { createAgent, type StoredAgent } from "@/lib/trading/agent";
import { TradingError, toTradingError } from "@/lib/trading/errors";
import {
  approveAgent,
  createAgentClient,
  createApprovalClient,
  placeIocOrder,
  setLeverage,
} from "@/lib/trading/exchange";
import {
  buildIocOrder,
  leverageUpdate,
  OrderTooSmallError,
  type OrderResult,
} from "@/lib/trading/order";

/**
 * Approve a new agent with one signature of the connected wallet.
 * The signature domain uses the wallet's current chain. When the wallet
 * refuses that chain, it switches to Arbitrum Sepolia and tries once more.
 * The agent is stored only after the exchange accepts it.
 */
export function useApproveAgent(owner: string | undefined) {
  const config = useConfig();
  return useMutation<StoredAgent, TradingError>({
    mutationFn: async () => {
      if (!owner) throw new TradingError("api", "Connect a wallet first.");
      const agent = createAgent();
      try {
        const chainId = getConnection(config).chainId;
        if (chainId === undefined) throw new TradingError("api", "Connect a wallet first.");
        const wallet = await getWalletClient(config);
        await approveAgent(createApprovalClient(wallet, numberToHex(chainId)), agent);
      } catch (error) {
        const tradingError = toTradingError(error);
        if (tradingError.kind !== "chain") throw tradingError;
        try {
          await switchChain(config, { chainId: arbitrumSepolia.id });
          const wallet = await getWalletClient(config, { chainId: arbitrumSepolia.id });
          await approveAgent(createApprovalClient(wallet, numberToHex(arbitrumSepolia.id)), agent);
        } catch (retryError) {
          throw toTradingError(retryError);
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
  /** The open testnet position of this asset, when one exists. */
  position: Position | undefined;
}

/**
 * Set the leverage when needed, then place one IOC order with the agent.
 * The mid is read again right before the order. When the exchange says the
 * agent does not exist, the local agent is removed so the user can approve
 * a new one.
 */
export function usePlaceTestnetOrder(owner: string | undefined, agent: StoredAgent | null) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<OrderPhase>(null);

  const mutation = useMutation<OrderResult, TradingError, PlaceOrderInput>({
    mutationFn: async ({ asset, side, sizeUsd, leverage, position }) => {
      if (!owner || !agent) throw new TradingError("api", "Approve the agent first.");
      try {
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
        // A fresh REST read right before the order. The trading code runs
        // only in the testnet build, so HL is testnet here.
        const mids = await getAllMidsOnce(HL.infoUrl);
        const mid = mids[asset.name];
        if (mid === undefined) throw new TradingError("api", `No testnet price for ${asset.name}.`);
        const order = buildIocOrder({
          assetIndex: asset.index,
          szDecimals: asset.szDecimals,
          side,
          sizeUsd,
          mid,
        });
        return await placeIocOrder(client, order, agent.address);
      } catch (error) {
        if (error instanceof OrderTooSmallError) throw new TradingError("api", error.message);
        throw toTradingError(error, { agentAddress: agent.address });
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
