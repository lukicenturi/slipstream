import type { LeaderboardEntry, TimeWindow } from "@/lib/hyperliquid/schemas";

/*
 * Leaderboard ranking and sorting. The API sends the top 100 by month PnL.
 * The window tabs and the column headers re-sort those rows in the browser.
 */

export type LeaderboardSortKey = "accountValue" | "pnl" | "roi";
export type SortDirection = "asc" | "desc";

export interface LeaderboardSort {
  key: LeaderboardSortKey;
  direction: SortDirection;
}

export const DEFAULT_LEADERBOARD_SORT: LeaderboardSort = { key: "pnl", direction: "desc" };

export interface RankedEntry {
  /** 1-based rank by PnL in the chosen window. It does not change with the sort. */
  rank: number;
  entry: LeaderboardEntry;
}

function sortValue(entry: LeaderboardEntry, window: TimeWindow, key: LeaderboardSortKey): number {
  if (key === "accountValue") return entry.accountValue;
  return entry.windows[window][key];
}

/** Rank the rows by PnL in `window`, then order them by `sort`. */
export function rankLeaderboard(
  rows: readonly LeaderboardEntry[],
  window: TimeWindow,
  sort: LeaderboardSort,
): RankedEntry[] {
  const ranked = [...rows]
    .sort(
      (a, b) => b.windows[window].pnl - a.windows[window].pnl || a.address.localeCompare(b.address),
    )
    .map((entry, index) => ({ rank: index + 1, entry }));

  const factor = sort.direction === "asc" ? 1 : -1;
  return ranked.sort(
    (a, b) =>
      factor * (sortValue(a.entry, window, sort.key) - sortValue(b.entry, window, sort.key)) ||
      a.rank - b.rank,
  );
}

/** Click on a header: the same column flips direction, a new column starts descending. */
export function nextSort(current: LeaderboardSort, key: LeaderboardSortKey): LeaderboardSort {
  if (current.key !== key) return { key, direction: "desc" };
  return { key, direction: current.direction === "desc" ? "asc" : "desc" };
}

/** The addresses of the top `count` traders by month PnL. */
export function topAddressesByMonthPnl(rows: readonly LeaderboardEntry[], count: number): string[] {
  return [...rows]
    .sort((a, b) => b.windows.month.pnl - a.windows.month.pnl)
    .slice(0, count)
    .map((entry) => entry.address.toLowerCase());
}
