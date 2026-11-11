"use client";

import { useMemo } from "react";

import { topAddressesByMonthPnl } from "@/lib/calc/leaderboard";

import { useLeaderboard } from "./useLeaderboard";
import { useLiveFeed } from "./useLiveFeed";

/** The number of top traders (by month PnL) that the feed follows. */
export const FEED_TRADER_COUNT = 20;

const NO_ADDRESSES: readonly string[] = [];

/**
 * The live feed of the top 20 traders by month PnL. It reads the shared
 * leaderboard query, so the feed waits for the leaderboard to load.
 */
export function useTopTraderFeed() {
  const leaderboard = useLeaderboard();
  const rows = leaderboard.data?.rows;

  const addresses = useMemo(
    () => (rows ? topAddressesByMonthPnl(rows, FEED_TRADER_COUNT) : NO_ADDRESSES),
    [rows],
  );
  // Display names, so feed rows can show a name instead of an address.
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows ?? []) {
      if (row.displayName) map.set(row.address.toLowerCase(), row.displayName);
    }
    return map;
  }, [rows]);

  const feed = useLiveFeed(addresses);

  return {
    feed,
    names,
    traderCount: addresses.length,
    leaderboardPending: leaderboard.isPending,
    leaderboardError: leaderboard.isError,
    refetchLeaderboard: leaderboard.refetch,
  };
}
