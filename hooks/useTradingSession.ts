"use client";

import { useConnection } from "wagmi";

import { useAgent } from "@/hooks/useAgent";
import { useTestnetAccount } from "@/hooks/useTestnetAccount";

export type TradingStatus = "disconnected" | "connected" | "agent-ready";

/**
 * The state of testnet trading: the connected wallet, the stored agent and
 * the testnet account. Use it only inside the testnet build (it needs wagmi).
 * `live` refreshes the account every 10 s (while the sheet is open).
 */
export function useTradingSession({ live }: { live: boolean }) {
  const connection = useConnection();
  const address = connection.address?.toLowerCase();
  const agent = useAgent(address);
  const account = useTestnetAccount(address, live);

  const status: TradingStatus = !address ? "disconnected" : agent ? "agent-ready" : "connected";
  return {
    status,
    address,
    chainId: connection.chainId,
    agent,
    account,
    /** The withdrawable USD on testnet: what new margin can use. */
    balanceUsd: account.data?.withdrawable,
    hasFunds: account.data ? account.data.accountValue >= 1 : undefined,
    isConnecting: connection.status === "connecting" || connection.status === "reconnecting",
  };
}
