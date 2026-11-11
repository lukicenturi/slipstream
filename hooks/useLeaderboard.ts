"use client";

import { useQuery } from "@tanstack/react-query";

import { getLeaderboard } from "@/lib/hyperliquid/client";

/** The trimmed top 100 leaderboard from /api/leaderboard. */
export function useLeaderboard() {
  return useQuery({
    queryKey: ["leaderboard"],
    queryFn: ({ signal }) => getLeaderboard({ signal }),
    staleTime: 5 * 60_000,
  });
}
