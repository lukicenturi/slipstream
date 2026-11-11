"use client";

import { WifiOffIcon } from "lucide-react";

import { ConnectionStatus } from "@/components/layout/ConnectionStatus";
import { Panel } from "@/components/shared/Panel";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/shared/States";
import { Button } from "@/components/ui/button";
import { useConnectionLost, useReconnect } from "@/hooks/useConnectionStatus";
import { useTopTraderFeed } from "@/hooks/useTopTraderFeed";

import { FeedItem } from "./FeedItem";

/** Live orders of the top traders. Every subscription uses the shared socket. */
export function LiveFeed({ className }: { className?: string }) {
  const { feed, names, traderCount, leaderboardPending, leaderboardError, refetchLeaderboard } =
    useTopTraderFeed();
  const lost = useConnectionLost();
  const reconnect = useReconnect();
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
    body = <SkeletonRows rows={8} rowClassName="h-10" label="Loading the live feed" />;
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
        <ol aria-label="Live trades" data-testid="feed-list">
          {items.map((item) => (
            <FeedItem key={item.id} item={item} name={names.get(item.user)} />
          ))}
        </ol>
      </>
    );
  }

  return (
    <Panel
      title="Live trades"
      titleId="live-title"
      focusableTitle
      meta={traderCount > 0 ? `Top ${traderCount} traders` : null}
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
