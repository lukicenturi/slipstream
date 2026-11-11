"use client";

import { useQuery } from "@tanstack/react-query";

import { getMeta } from "@/lib/hyperliquid/client";
import { HL, NETWORK } from "@/lib/network";

/**
 * The perp universe of this build's network (asset ids, size decimals, max
 * leverage). Only a trading build calls it. HL is the network's info endpoint.
 */
export function useTradingMeta(enabled = true) {
  return useQuery({
    queryKey: [NETWORK, "meta"],
    queryFn: ({ signal }) => getMeta(HL.infoUrl, { signal }),
    staleTime: 10 * 60_000,
    enabled,
  });
}
