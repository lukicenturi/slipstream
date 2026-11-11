"use client";

import { EmptyState, SkeletonRows } from "@/components/shared/States";
import { useHydrated } from "@/hooks/useHydrated";
import { NamesContext, useCachedDisplayNames, useNames } from "@/hooks/useNames";
import { useWatchlist } from "@/hooks/useWatchlist";
import { MAX_WATCHLIST_ACCOUNTS, useWatchlistAccounts } from "@/hooks/useWatchlistAccounts";
import { cn } from "@/lib/utils";

import { AddTraderForm } from "./AddTraderForm";
import { WATCHLIST_GRID, WatchlistRow } from "./WatchlistRow";

/** The watchlist page: the add form and one row per followed trader. */
export function WatchlistView() {
  const hydrated = useHydrated();
  const { addresses } = useWatchlist();
  const accounts = useWatchlistAccounts(addresses);
  const names = useNames(addresses);
  const displayNames = useCachedDisplayNames();

  let body: React.ReactNode;
  if (!hydrated) {
    // The list lives in localStorage, so the server cannot know it.
    body = <SkeletonRows rows={3} label="Loading the watchlist" />;
  } else if (addresses.length === 0) {
    body = (
      <EmptyState
        title="You are not tracking anyone yet."
        description="Star a trader in the leaderboard or paste an address above."
      />
    );
  } else {
    body = (
      <>
        <div
          aria-hidden="true"
          className={cn(
            WATCHLIST_GRID,
            "hidden h-8 border-b px-3 text-2xs tracking-wide text-muted-foreground uppercase md:grid",
          )}
        >
          <span>Trader</span>
          <span className="text-right">Account value</span>
          <span className="text-right">Unrealized PnL</span>
          <span className="text-right">Positions</span>
          <span>Last trade</span>
          <span>Alerts</span>
          <span />
        </div>
        <ul aria-label="Tracked traders" data-testid="watchlist-rows">
          {addresses.map((address) => (
            <WatchlistRow
              key={address}
              address={address}
              account={accounts.get(address)}
              displayName={displayNames.get(address)}
            />
          ))}
        </ul>
        {addresses.length > MAX_WATCHLIST_ACCOUNTS ? (
          <p className="px-3 py-2 text-2xs text-faint">
            Account data loads for the first {MAX_WATCHLIST_ACCOUNTS} traders. Alerts work for all
            of them.
          </p>
        ) : null}
      </>
    );
  }

  return (
    <NamesContext value={names}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-3 lg:px-6 lg:py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground">Watchlist</h1>
            <p className="text-xs text-muted-foreground">
              Traders you follow. Alerts fire while Slipstream is open.
            </p>
          </div>
          <AddTraderForm className="w-full md:max-w-sm" />
        </div>
        <section
          aria-labelledby="watchlist-following"
          className="overflow-hidden rounded-lg border bg-background"
        >
          <header className="flex h-10 items-center gap-2 border-b px-3">
            <h2 id="watchlist-following" className="text-sm font-semibold text-foreground">
              Following
            </h2>
            {hydrated && addresses.length > 0 ? (
              <span
                className="font-mono text-2xs text-faint tabular-nums"
                data-testid="watchlist-total"
              >
                {addresses.length}
              </span>
            ) : null}
          </header>
          {body}
        </section>
      </div>
    </NamesContext>
  );
}
