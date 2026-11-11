"use client";

import { useConnection } from "wagmi";

import { useAgent } from "@/hooks/useAgent";
import { useTraderState } from "@/hooks/useTrader";

/** The account refreshes this often while the sheet is open. */
export const ACCOUNT_REFRESH_MS = 10_000;

export type TradingStatus = "disconnected" | "connected" | "agent-ready";

/**
 * The state of testnet trading: the connected wallet, the stored agent and
 * the account. Use it only inside the testnet build (it needs wagmi), where
 * the network is testnet. The account is the profile's clearinghouse query,
 * so the sheet, the wallet popover and the account page share it.
 * `live` loads the account and refreshes it every 10 s (while the sheet is open).
 */
export function useTradingSession({ live }: { live: boolean }) {
  const connection = useConnection();
  const address = connection.address?.toLowerCase();
  const agent = useAgent(address);
  const account = useTraderState(address, {
    enabled: live,
    refetchInterval: live ? ACCOUNT_REFRESH_MS : false,
  });

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
