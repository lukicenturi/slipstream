"use client";

import { useQuery } from "@tanstack/react-query";

import { getMeta } from "@/lib/hyperliquid/client";
import { HL } from "@/lib/network";

/**
 * The perp universe (asset ids, size decimals, max leverage). Only the
 * testnet build calls it, so HL is the testnet info endpoint here.
 */
export function useTestnetMeta(enabled = true) {
  return useQuery({
    queryKey: ["testnet", "meta"],
    queryFn: ({ signal }) => getMeta(HL.infoUrl, { signal }),
    staleTime: 10 * 60_000,
    enabled,
  });
}
