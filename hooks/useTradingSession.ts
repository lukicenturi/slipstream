"use client";

import { useConnection } from "wagmi";

import { useAgent } from "@/hooks/useAgent";
import { ACCOUNT_REFRESH_MS, useTraderState } from "@/hooks/useTrader";

export type TradingStatus = "disconnected" | "connected" | "agent-ready";

/**
 * The state of trading: the connected wallet, the stored agent and the
 * account, on the build's network. Use it only inside a trading build (it
 * needs wagmi). The account is the profile's clearinghouse query,
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
    /** The withdrawable USD on the network: what new margin can use. */
    balanceUsd: account.data?.withdrawable,
    hasFunds: account.data ? account.data.accountValue >= 1 : undefined,
    isConnecting: connection.status === "connecting" || connection.status === "reconnecting",
  };
}
