"use client";

import { useMemo, type ReactNode } from "react";

import { useLeaderboard } from "@/hooks/useLeaderboard";
import { NamesContext, useNames } from "@/hooks/useNames";
import { useWatchlist } from "@/hooks/useWatchlist";

/**
 * One reverse-name lookup for the home page: the top 100 leaderboard
 * addresses (the feed follows a subset of them) and then the followed
 * traders, up to 120 addresses. Rows read the map with useDisplayName.
 */
export function NamesProvider({ children }: { children: ReactNode }) {
  const { data, isPending } = useLeaderboard();
  const { addresses: watchlist } = useWatchlist();
  const rows = data?.rows;

  // Wait for the leaderboard, so the page sends one lookup and not two.
  // When the leaderboard fails, the followed traders still get names.
  const addresses = useMemo(
    () => (isPending ? [] : [...(rows ?? []).map((row) => row.address), ...watchlist]),
    [isPending, rows, watchlist],
  );
  const names = useNames(addresses);

  return <NamesContext value={names}>{children}</NamesContext>;
}
