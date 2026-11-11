import Link from "next/link";
import { memo } from "react";

import { CopyTradeButton } from "@/components/copy-trade/CopyTradeButton";
import { AssetIcon } from "@/components/shared/AssetIcon";
import { BookmarkButton } from "@/components/shared/BookmarkButton";
import { Side } from "@/components/shared/Side";
import type { FeedItem as FeedItemData } from "@/lib/calc/aggregateFills";
import { useDisplayName } from "@/hooks/useNames";
import { describeFillAction, sideLabel } from "@/lib/calc/fillAction";
import { formatPrice, formatSize, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

import { RelativeTime } from "./RelativeTime";

/** Spot (`@107`) and builder (`#114910`) markets cannot be copied as perps. */
export function isPerpCoin(coin: string): boolean {
  return !coin.startsWith("@") && !coin.startsWith("#");
}

/**
 * One aggregated order in the live feed. Two lines:
 * trader, action and coin with the notional; then size, price, PnL and time.
 * A "Copy" button opens the demo sheet for perp orders.
 * Fills carry no leverage, so the row shows none.
 */
export const FeedItem = memo(function FeedItem({
  item,
  name,
}: {
  item: FeedItemData;
  name?: string;
}) {
  const action = describeFillAction(item.dir);
  const badge = sideLabel(action, item.side);
  const copySide = isPerpCoin(item.coin) ? action.positionSide : null;
  const trader = useDisplayName(item.user, name);
  return (
    <li
      data-testid="feed-item"
      data-live={item.live ? "true" : "false"}
      className={cn(
        "flex min-h-10 items-center gap-1 border-b px-2 py-1.5 transition-colors hover:bg-surface-hover sm:gap-2 sm:px-3",
        item.live && "motion-safe:animate-slide-in",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <div className="flex min-w-0 items-center gap-1 text-xs sm:gap-2">
          {/* 40 px on mobile, so the star and the Copy button fit at 375 px. */}
          <Side label={badge.label} tone={badge.tone} className="w-10 px-0.5 sm:w-11 sm:px-1" />
          <Link
            href={`/trader/${item.user}`}
            prefetch={false}
            title={item.user}
            className={cn(
              "max-w-[8rem] shrink-0 truncate rounded-sm text-foreground hover:text-brand",
              trader.source === "address" ? "font-mono" : "font-medium",
            )}
          >
            {trader.label}
          </Link>
          {/*
            The phrase truncates first (shrink factor 1000). Only when the phrase is
            gone does the coin truncate, so it never runs into the notional.
          */}
          <span className="flex min-w-0 items-center gap-0.5 sm:gap-1">
            <span className="min-w-0 shrink-[1000] truncate text-muted-foreground">
              <span className="sm:hidden">{action.verb}</span>
              <span className="hidden sm:inline">{action.phrase}</span>
            </span>
            <span
              title={item.coin}
              className="inline-flex min-w-0 items-center gap-0.5 font-medium text-foreground sm:gap-1"
            >
              <AssetIcon coin={item.coin} />
              <span className="min-w-0 truncate">{item.coin}</span>
            </span>
          </span>
          <span className="ml-auto shrink-0 font-mono text-foreground">
            {formatUsd(item.notional, { compact: true })}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2 pl-[44px] font-mono text-2xs text-muted-foreground sm:pl-[52px]">
          <span className="truncate">
            {formatSize(item.sz)} @ {formatPrice(item.px)}
          </span>
          {item.fillCount > 1 ? (
            <span className="shrink-0 font-sans text-faint">{item.fillCount} fills</span>
          ) : null}
          {Math.abs(item.closedPnl) >= 0.005 ? (
            <span className={cn("shrink-0", item.closedPnl > 0 ? "text-long" : "text-short")}>
              <span className="font-sans text-faint">PnL </span>
              {formatUsd(item.closedPnl, { compact: true, signed: true })}
            </span>
          ) : null}
          <RelativeTime time={item.time} className="ml-auto shrink-0 font-sans text-faint" />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
        {copySide ? (
          <CopyTradeButton
            coin={item.coin}
            side={copySide}
            fallbackMarkPx={item.px}
            className="w-8 px-0 sm:w-11"
          />
        ) : (
          // Keeps the columns aligned with rows that have a button.
          <span aria-hidden="true" className="w-8 shrink-0 sm:w-11" />
        )}
        {/* The same 24 px height as the Copy button. */}
        <BookmarkButton address={item.user} size="icon-xs" />
      </div>
    </li>
  );
});
