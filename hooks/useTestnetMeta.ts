"use client";

import { useQuery } from "@tanstack/react-query";

import { getMeta } from "@/lib/hyperliquid/client";
import { TESTNET } from "@/lib/trading/config";

/** The testnet perp universe (asset ids, size decimals, max leverage). */
export function useTestnetMeta(enabled = true) {
  return useQuery({
    queryKey: ["testnet", "meta"],
    queryFn: ({ signal }) => getMeta(TESTNET.infoUrl, { signal }),
    staleTime: 10 * 60_000,
    enabled,
  });
}
