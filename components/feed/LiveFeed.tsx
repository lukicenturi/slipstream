"use client";

import { WifiOffIcon } from "lucide-react";

import { ConnectionStatus } from "@/components/layout/ConnectionStatus";
import { Panel } from "@/components/shared/Panel";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/shared/States";
import { Button } from "@/components/ui/button";
import { useConnectionLost, useReconnect } from "@/hooks/useConnectionStatus";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useTopTraderFeed } from "@/hooks/useTopTraderFeed";
import { NETWORK } from "@/lib/network";

import { FeedItem } from "./FeedItem";
import { FeedTable } from "./FeedTable";

/** The Tailwind `lg` breakpoint, where the wide layout shows the table. */
const DESKTOP_QUERY = "(min-width: 64rem)";

export type LiveFeedLayout = "panel" | "wide";

/**
 * Live orders of the top traders. Every subscription uses the shared socket.
 * The feed state lives here, so a change of `layout` keeps the items.
 * `panel`: the two-line row list (the home split, and mobile).
 * `wide`: from `lg` up, a dense full-width table; below `lg`, the row list.
 */
export function LiveFeed({
  className,
  layout = "panel",
}: {
  className?: string;
  layout?: LiveFeedLayout;
}) {
  const { feed, names, traderCount, leaderboardPending, leaderboardError, refetchLeaderboard } =
    useTopTraderFeed();
  const lost = useConnectionLost();
  const reconnect = useReconnect();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const table = layout === "wide" && isDesktop;
  const { items } = feed;

  let body: React.ReactNode;
  if (leaderboardError && traderCount === 0) {
    body = (
      <ErrorState
        title="The feed has no traders to follow"
        description="The leaderboard did not load, so the feed cannot pick the top traders."
        onRetry={() => void refetchLeaderboard()}
      />
    );
  } else if (leaderboardPending) {
    body = (
      <SkeletonRows
        rows={table ? 16 : 8}
        rowClassName={table ? undefined : "h-10"}
        label="Loading the live feed"
      />
    );
  } else if (items.length === 0 && lost) {
    body = (
      <ErrorState
        title="The live connection is down"
        description="The socket has not been open for more than 30 s."
        onRetry={reconnect}
        retryLabel="Reconnect"
      />
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        title="Waiting for trades"
        description={`Following the top ${traderCount} traders by 30D PnL.`}
      >
        <ConnectionStatus className="mt-1" />
      </EmptyState>
    );
  } else {
    body = (
      <>
        {lost ? <LostBanner onReconnect={reconnect} /> : null}
        {table ? (
          <FeedTable items={items} names={names} />
        ) : (
          <ol aria-label="Live trades" data-testid="feed-list">
            {items.map((item) => (
              <FeedItem key={item.id} item={item} name={names.get(item.user)} />
            ))}
          </ol>
        )}
      </>
    );
  }

  return (
    <Panel
      title="Live trades"
      titleId="live-title"
      meta={
        traderCount > 0 ? (
          <>
            {table ? <span aria-hidden="true">· </span> : null}Top {traderCount} traders
            {NETWORK === "testnet" ? " · Testnet" : null}
          </>
        ) : null
      }
      actions={
        items.length > 0 ? (
          <span className="font-mono text-2xs text-faint" data-testid="feed-count">
            {items.length} orders
          </span>
        ) : null
      }
      className={className}
    >
      {body}
    </Panel>
  );
}

function LostBanner({ onReconnect }: { onReconnect: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 border-b bg-short-dim px-3 py-2 text-xs text-foreground"
    >
      <WifiOffIcon aria-hidden="true" className="size-3.5 shrink-0 text-short" />
      <span className="min-w-0 flex-1">The connection is down. New trades are paused.</span>
      <Button variant="outline" size="xs" onClick={onReconnect}>
        Reconnect
      </Button>
    </div>
  );
}
