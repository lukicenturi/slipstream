"use client";

import { useQuery } from "@tanstack/react-query";

import { getUserFills } from "@/lib/hyperliquid/client";
import { TESTNET } from "@/lib/trading/config";

const REFRESH_MS = 30_000;

/** The testnet fills of an account (up to 2,000), refreshed every 30 s while mounted. */
export function useTestnetFills(address: string | undefined) {
  return useQuery({
    queryKey: ["testnet", "fills", address],
    queryFn: ({ signal }) => {
      // `enabled` below keeps this from running without an address.
      if (!address) throw new Error("No address");
      return getUserFills(address, { signal, baseUrl: TESTNET.infoUrl });
    },
    enabled: address !== undefined,
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
  });
}
