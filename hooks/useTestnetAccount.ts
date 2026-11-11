"use client";

import { useQuery } from "@tanstack/react-query";

import { getClearinghouseState } from "@/lib/hyperliquid/client";
import { TESTNET } from "@/lib/trading/config";

const REFRESH_MS = 10_000;

export function testnetAccountKey(address: string | undefined) {
  return ["testnet", "account", address] as const;
}

/** The testnet margin state of the connected account, refreshed every 10 s while `active`. */
export function useTestnetAccount(address: string | undefined, active: boolean) {
  return useQuery({
    queryKey: testnetAccountKey(address),
    queryFn: ({ signal }) => {
      // `enabled` below keeps this from running without an address.
      if (!address) throw new Error("No address");
      return getClearinghouseState(address, { signal, baseUrl: TESTNET.infoUrl });
    },
    enabled: active && address !== undefined,
    refetchInterval: active ? REFRESH_MS : false,
    staleTime: 5_000,
  });
}
