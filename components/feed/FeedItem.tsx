import Link from "next/link";
import { memo } from "react";

import { Side } from "@/components/shared/Side";
import type { FeedItem as FeedItemData } from "@/lib/calc/aggregateFills";
import { describeFillAction, sideLabel } from "@/lib/calc/fillAction";
import { formatPrice, formatSize, formatUsd, shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

import { RelativeTime } from "./RelativeTime";

/**
 * One aggregated order in the live feed. Two lines:
 * trader, action and coin with the notional; then size, price, PnL and time.
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
  return (
    <li
      data-testid="feed-item"
      data-live={item.live ? "true" : "false"}
      className={cn(
        "flex min-h-10 flex-col justify-center gap-0.5 border-b px-3 py-1.5 transition-colors hover:bg-surface-hover",
        item.live && "motion-safe:animate-slide-in",
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <Side label={badge.label} tone={badge.tone} />
        <Link
          href={`/trader/${item.user}`}
          prefetch={false}
          title={item.user}
          className={cn(
            "max-w-[8rem] shrink-0 truncate text-foreground hover:text-brand",
            name ? "font-medium" : "font-mono",
          )}
        >
          {name ?? shortAddress(item.user)}
        </Link>
        <span className="min-w-0 truncate text-muted-foreground">
          {action.phrase} <span className="font-medium text-foreground">{item.coin}</span>
        </span>
        <span className="ml-auto shrink-0 font-mono text-foreground">
          {formatUsd(item.notional, { compact: true })}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-2 pl-[52px] font-mono text-2xs text-muted-foreground">
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
    </li>
  );
});
