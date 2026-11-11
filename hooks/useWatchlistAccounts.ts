"use client";

import { useQueries } from "@tanstack/react-query";

import { getClearinghouseState } from "@/lib/hyperliquid/client";
import type { ClearinghouseState } from "@/lib/hyperliquid/schemas";

/** The watchlist page loads account data for at most this many addresses. */
export const MAX_WATCHLIST_ACCOUNTS = 50;

const ACCOUNT_REFRESH_MS = 60_000;

export interface WatchlistAccount {
  status: "pending" | "error" | "success";
  data: ClearinghouseState | undefined;
  refetch: () => void;
}

/**
 * The clearinghouse state of the first 50 watched addresses. Each query
 * shares its cache key with the profile page. Data refreshes every 60 s
 * while the tab is visible.
 */
export function useWatchlistAccounts(
  addresses: readonly string[],
): ReadonlyMap<string, WatchlistAccount> {
  const loaded = addresses.slice(0, MAX_WATCHLIST_ACCOUNTS);
  return useQueries({
    queries: loaded.map((address) => ({
      queryKey: ["trader", address, "clearinghouseState"],
      queryFn: ({ signal }: { signal: AbortSignal }) => getClearinghouseState(address, { signal }),
      staleTime: ACCOUNT_REFRESH_MS,
      refetchInterval: ACCOUNT_REFRESH_MS,
      refetchIntervalInBackground: false,
    })),
    combine: (results) => {
      const map = new Map<string, WatchlistAccount>();
      results.forEach((result, index) => {
        map.set(loaded[index], {
          status: result.status,
          data: result.data,
          refetch: () => void result.refetch(),
        });
      });
      return map;
    },
  });
}
