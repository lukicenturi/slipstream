"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useConnectionStatus, useReconnect } from "@/hooks/useConnectionStatus";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { useMid } from "@/hooks/useMid";
import { useTopTraderFeed } from "@/hooks/useTopTraderFeed";
import { feedIntegrity } from "@/lib/calc/liveFeed";
import { formatPercent, formatPrice, formatUsd, shortAddress } from "@/lib/format";

/**
 * Throwaway check page: live BTC mid, feed counts with a "Force reconnect"
 * button (the no-duplicates check), and the top 10 traders.
 */
export function DevPanel() {
  return (
    <div className="flex flex-col gap-6">
      <LiveMid coin="BTC" />
      <FeedCheck />
      <TopTraders />
    </div>
  );
}

/** Feed counts. After a reconnect, items must still equal unique orders. */
function FeedCheck() {
  const { feed, traderCount } = useTopTraderFeed();
  const reconnect = useReconnect();
  const integrity = feedIntegrity(feed.items);
  const counts: [string, string, number][] = [
    ["Feed items", "feed-items", integrity.items],
    ["Unique user+oid", "feed-unique-orders", integrity.uniqueOrders],
    ["Fills (user+tid)", "feed-tids", integrity.tids],
    ["Unique fills", "feed-unique-tids", integrity.uniqueTids],
    ["Snapshots", "feed-snapshots", feed.stats.snapshots],
    ["Live messages", "feed-live-messages", feed.stats.liveMessages],
    ["Duplicates dropped", "feed-duplicates-dropped", feed.stats.duplicatesDropped],
    ["Traders followed", "feed-traders", traderCount],
  ];
  return (
    <section aria-labelledby="feed-check-title" className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <h2
          id="feed-check-title"
          className="text-2xs tracking-wide text-muted-foreground uppercase"
        >
          Live feed check
        </h2>
        <Button variant="outline" size="sm" onClick={reconnect} className="ml-auto">
          Force reconnect
        </Button>
      </div>
      <dl className="grid grid-cols-2 border-t sm:grid-cols-4">
        {counts.map(([label, testId, value]) => (
          <div key={testId} className="flex flex-col gap-0.5 border-b px-3 py-2">
            <dt className="text-2xs text-muted-foreground">{label}</dt>
            <dd className="font-mono text-base" data-testid={testId}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function LiveMid({ coin }: { coin: string }) {
  const mid = useMid(coin);
  const status = useConnectionStatus();
  return (
    <section aria-labelledby="mid-title" className="flex flex-col gap-1">
      <h2 id="mid-title" className="text-2xs tracking-wide text-muted-foreground uppercase">
        {coin} mid
      </h2>
      <p className="font-mono text-hero" data-testid="btc-mid">
        {mid === undefined ? (
          <span className="text-faint">Waiting for price</span>
        ) : (
          formatPrice(mid)
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        Socket: <span data-testid="ws-status">{status}</span>
      </p>
    </section>
  );
}

function TopTraders() {
  const { data, isPending, isError, refetch } = useLeaderboard();

  return (
    <section aria-labelledby="top-title" className="flex flex-col gap-2">
      <h2 id="top-title" className="text-2xs tracking-wide text-muted-foreground uppercase">
        Top 10 by month PnL{data?.stale ? " (stale)" : ""}
      </h2>

      {isPending ? (
        <div className="flex flex-col gap-1" aria-label="Loading">
          {Array.from({ length: 10 }, (_, index) => (
            <Skeleton key={index} className="h-7 w-full" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>The leaderboard did not load.</span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      ) : data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No traders.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th scope="col" className="h-8 px-3 font-normal">
                  #
                </th>
                <th scope="col" className="h-8 px-3 font-normal">
                  Trader
                </th>
                <th scope="col" className="h-8 px-3 text-right font-normal">
                  Account value
                </th>
                <th scope="col" className="h-8 px-3 text-right font-normal">
                  PnL (30D)
                </th>
                <th scope="col" className="h-8 px-3 text-right font-normal">
                  ROI (30D)
                </th>
              </tr>
            </thead>
            <tbody data-testid="top-traders">
              {data.rows.slice(0, 10).map((row, index) => {
                const month = row.windows.month;
                const tone = month.pnl >= 0 ? "text-long" : "text-short";
                return (
                  <tr key={row.address} className="h-9 border-b">
                    <td className="px-3 font-mono text-muted-foreground">{index + 1}</td>
                    <td className="px-3 font-mono">
                      {row.displayName ?? shortAddress(row.address)}
                    </td>
                    <td className="px-3 text-right font-mono">{formatUsd(row.accountValue)}</td>
                    <td className={`px-3 text-right font-mono ${tone}`}>
                      {formatUsd(month.pnl, { signed: true })}
                    </td>
                    <td className={`px-3 text-right font-mono ${tone}`}>
                      {formatPercent(month.roi, { signed: true })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
