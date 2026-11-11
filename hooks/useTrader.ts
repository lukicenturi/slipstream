"use client";

import { useQuery } from "@tanstack/react-query";

import { getClearinghouseState, getPortfolio, getUserFills } from "@/lib/hyperliquid/client";

/**
 * The three read-only info queries of one trader: positions and margin,
 * fills (up to 2,000), and PnL history. The address must be lower-case.
 */
export function useTrader(address: string) {
  const state = useQuery({
    queryKey: ["trader", address, "clearinghouseState"],
    queryFn: ({ signal }) => getClearinghouseState(address, { signal }),
    staleTime: 30_000,
  });
  const fills = useQuery({
    queryKey: ["trader", address, "userFills"],
    queryFn: ({ signal }) => getUserFills(address, { signal }),
    staleTime: 60_000,
  });
  const portfolio = useQuery({
    queryKey: ["trader", address, "portfolio"],
    queryFn: ({ signal }) => getPortfolio(address, { signal }),
    staleTime: 60_000,
  });
  return { state, fills, portfolio };
}
