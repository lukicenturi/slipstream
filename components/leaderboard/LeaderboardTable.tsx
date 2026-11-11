"use client";

import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { EmptyState, ErrorState } from "@/components/shared/States";
import { Panel } from "@/components/shared/Panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import {
  DEFAULT_LEADERBOARD_SORT,
  nextSort,
  rankLeaderboard,
  type LeaderboardSort,
  type LeaderboardSortKey,
} from "@/lib/calc/leaderboard";
import type { TimeWindow } from "@/lib/hyperliquid/schemas";
import { cn } from "@/lib/utils";

import { LeaderboardRow } from "./LeaderboardRow";
import { WindowTabs } from "./WindowTabs";

const SKELETON_ROWS = 10;

export function LeaderboardTable({ className }: { className?: string }) {
  const { data, isPending, isError, refetch, isRefetching } = useLeaderboard();
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("month");
  const [sort, setSort] = useState<LeaderboardSort>(DEFAULT_LEADERBOARD_SORT);

  const rows = data?.rows;
  const ranked = useMemo(
    () => (rows ? rankLeaderboard(rows, timeWindow, sort) : []),
    [rows, timeWindow, sort],
  );

  const onSort = (key: LeaderboardSortKey) => setSort((current) => nextSort(current, key));

  let body: React.ReactNode;
  if (isError && !data) {
    body = (
      <ErrorState
        title="The leaderboard did not load"
        description="The stats service did not answer. Try again in a moment."
        onRetry={() => void refetch()}
        retryLabel={isRefetching ? "Retrying…" : "Retry"}
      />
    );
  } else if (!isPending && ranked.length === 0) {
    body = <EmptyState title="No traders returned" description="The leaderboard is empty." />;
  } else {
    body = (
      <table className="w-full border-collapse" aria-busy={isPending}>
        <caption className="sr-only">Top traders by PnL. Select a column header to sort.</caption>
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="h-8 border-b text-2xs tracking-wide text-muted-foreground uppercase">
            <th scope="col" className="px-2 text-left font-normal sm:px-3">
              #
            </th>
            <th scope="col" className="px-2 text-left font-normal sm:px-3">
              Trader
            </th>
            <SortableHeader
              label="Account value"
              sortKey="accountValue"
              sort={sort}
              onSort={onSort}
              className="hidden sm:table-cell"
            />
            <SortableHeader label="PnL" sortKey="pnl" sort={sort} onSort={onSort} />
            <SortableHeader label="ROI" sortKey="roi" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody data-testid="leaderboard-rows">
          {isPending
            ? Array.from({ length: SKELETON_ROWS }, (_, index) => <SkeletonRow key={index} />)
            : ranked.map(({ rank, entry }) => (
                <LeaderboardRow
                  key={entry.address}
                  rank={rank}
                  entry={entry}
                  timeWindow={timeWindow}
                />
              ))}
        </tbody>
      </table>
    );
  }

  return (
    <Panel
      title="Leaderboard"
      titleId="leaderboard-title"
      meta={
        data ? (
          <span className="hidden sm:inline">
            Top {data.rows.length} by 30D PnL{data.stale ? " · stale" : ""}
          </span>
        ) : null
      }
      actions={<WindowTabs value={timeWindow} onChange={setTimeWindow} />}
      className={className}
    >
      {body}
    </Panel>
  );
}

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: LeaderboardSortKey;
  sort: LeaderboardSort;
  onSort: (key: LeaderboardSortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDownIcon : sort.direction === "desc" ? ArrowDownIcon : ArrowUpIcon;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.direction === "desc" ? "descending" : "ascending") : "none"}
      className={cn("px-2 text-right font-normal sm:px-3", className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "ml-auto inline-flex items-center gap-1 rounded-sm tracking-wide uppercase hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {label}
        <Icon aria-hidden="true" className={cn("size-3", !active && "text-faint")} />
      </button>
    </th>
  );
}

function SkeletonRow() {
  return (
    <tr className="h-9 border-b" aria-hidden="true">
      <td className="px-2 sm:px-3">
        <Skeleton className="h-3 w-4" />
      </td>
      <td className="px-2 sm:px-3">
        <Skeleton className="h-3 w-24" />
      </td>
      <td className="hidden px-3 sm:table-cell">
        <Skeleton className="ml-auto h-3 w-24" />
      </td>
      <td className="px-2 sm:px-3">
        <Skeleton className="ml-auto h-3 w-20" />
      </td>
      <td className="px-2 sm:px-3">
        <Skeleton className="ml-auto h-3 w-12" />
      </td>
    </tr>
  );
}
