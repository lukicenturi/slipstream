"use client";

import { useQuery } from "@tanstack/react-query";

import { getSpotTokenMap } from "@/lib/hyperliquid/client";

/** The spot token map (token -> USDC pair) from /api/spot-meta. It changes rarely. */
export function useSpotTokenMap(enabled = true) {
  return useQuery({
    queryKey: ["spotTokenMap"],
    queryFn: ({ signal }) => getSpotTokenMap({ signal }),
    staleTime: 60 * 60_000,
    enabled,
  });
}
