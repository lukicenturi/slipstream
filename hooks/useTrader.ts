"use client";

import { useQuery } from "@tanstack/react-query";

import { getClearinghouseState, getPortfolio, getUserFills } from "@/lib/hyperliquid/client";

/*
 * The read-only info queries of one trader, on this build's network. The
 * profile, the watchlist, the account page, the wallet popover and the
 * copy-trade sheet all use these keys, so they share one cache entry per
 * address. The address must be lower-case.
 */

/** The account refreshes this often while the sheet, the wallet popover or the account page shows it. */
export const ACCOUNT_REFRESH_MS = 10_000;

export function traderStateKey(address: string | undefined) {
  return ["trader", address, "clearinghouseState"] as const;
}

export function traderFillsKey(address: string | undefined) {
  return ["trader", address, "userFills"] as const;
}

interface TraderQueryOptions {
  /** False keeps the query idle (for example while a popover is closed). */
  enabled?: boolean;
  /** Refresh every n ms while mounted and enabled. */
  refetchInterval?: number | false;
}

/** Positions and margin. Without an address the query stays idle. */
export function useTraderState(address: string | undefined, options: TraderQueryOptions = {}) {
  return useQuery({
    queryKey: traderStateKey(address),
    queryFn: ({ signal }) => {
      // `enabled` below keeps this from running without an address.
      if (!address) throw new Error("No address");
      return getClearinghouseState(address, { signal });
    },
    enabled: (options.enabled ?? true) && address !== undefined,
    refetchInterval: options.refetchInterval ?? false,
    staleTime: 30_000,
  });
}

/** Fills (up to 2,000). Without an address the query stays idle. */
export function useTraderFills(address: string | undefined, options: TraderQueryOptions = {}) {
  return useQuery({
    queryKey: traderFillsKey(address),
    queryFn: ({ signal }) => {
      // `enabled` below keeps this from running without an address.
      if (!address) throw new Error("No address");
      return getUserFills(address, { signal });
    },
    enabled: (options.enabled ?? true) && address !== undefined,
    refetchInterval: options.refetchInterval ?? false,
    staleTime: 60_000,
  });
}

/** The three queries of a profile: positions and margin, fills, and PnL history. */
export function useTrader(address: string) {
  const state = useTraderState(address);
  const fills = useTraderFills(address);
  const portfolio = useQuery({
    queryKey: ["trader", address, "portfolio"],
    queryFn: ({ signal }) => getPortfolio(address, { signal }),
    staleTime: 60_000,
  });
  return { state, fills, portfolio };
}
