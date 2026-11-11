"use client";

import { useQuery } from "@tanstack/react-query";

import { getAllMidsOnce } from "@/lib/hyperliquid/client";
import { TESTNET } from "@/lib/trading/config";

const REFRESH_MS = 3_000;

/**
 * The testnet mid of one coin over REST, refreshed every 3 s while
 * `active` (the sheet is open). The one shared socket stays on mainnet.
 */
export function useTestnetMid(coin: string, active: boolean) {
  return useQuery({
    queryKey: ["testnet", "allMids"],
    queryFn: ({ signal }) => getAllMidsOnce(TESTNET.infoUrl, { signal }),
    select: (mids: Record<string, number>) => mids[coin],
    enabled: active,
    refetchInterval: active ? REFRESH_MS : false,
    staleTime: REFRESH_MS - 500,
  });
}
