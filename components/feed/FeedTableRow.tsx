"use client";

import Link from "next/link";
import { memo } from "react";

import { CopyTradeButton } from "@/components/copy-trade/CopyTradeButton";
import { AssetIcon } from "@/components/shared/AssetIcon";
import { BookmarkButton } from "@/components/shared/BookmarkButton";
import { Side } from "@/components/shared/Side";
import { signTone } from "@/components/shared/tone";
import { useDisplayName } from "@/hooks/useNames";
import type { FeedItem } from "@/lib/calc/aggregateFills";
import { describeFillAction, sideLabel } from "@/lib/calc/fillAction";
import { formatClockTime, formatClosedPnl, formatPrice, formatSize, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

import { isPerpCoin } from "./FeedItem";

const NUM = "px-3 font-mono text-xs whitespace-nowrap";

/**
 * One aggregated order in the desktop live table: a 36 px row with one
 * column per value. The same data as `FeedItem`, without the second line.
 */
export const FeedTableRow = memo(function FeedTableRow({
  item,
  name,
}: {
  item: FeedItem;
  name?: string;
}) {
  const action = describeFillAction(item.dir);
  const badge = sideLabel(action, item.side);
  const copySide = isPerpCoin(item.coin) ? action.positionSide : null;
  const trader = useDisplayName(item.user, name);
  const pnl = formatClosedPnl(item.closedPnl);

  return (
    <tr
      data-testid="feed-row"
      data-live={item.live ? "true" : "false"}
      className={cn(
        "h-9 border-b transition-colors hover:bg-surface-hover",
        item.live && "motion-safe:animate-slide-in",
      )}
    >
      <td className={cn(NUM, "text-muted-foreground")}>
        <time
          dateTime={new Date(item.time).toISOString()}
          title={new Date(item.time).toLocaleString("en-US")}
        >
          {formatClockTime(item.time)}
        </time>
      </td>
      <td className="max-w-0 px-3 text-xs">
        <Link
          href={`/trader/${item.user}`}
          prefetch={false}
          title={item.user}
          className={cn(
            "block truncate rounded-sm text-foreground hover:text-brand",
            trader.source === "address" ? "font-mono" : "font-medium",
          )}
        >
          {trader.label}
        </Link>
      </td>
      <td className="max-w-0 px-3 text-xs">
        <span className="flex min-w-0 items-center gap-2">
          <Side label={badge.label} tone={badge.tone} />
          <span className="min-w-0 truncate text-muted-foreground">{action.phrase}</span>
        </span>
      </td>
      <td className="max-w-0 px-3 text-xs">
        <span
          title={item.coin}
          className="flex min-w-0 items-center gap-1.5 font-medium text-foreground"
        >
          <AssetIcon coin={item.coin} />
          <span className="min-w-0 truncate">{item.coin}</span>
        </span>
      </td>
      <td className={cn(NUM, "text-right text-foreground")}>
        {formatSize(item.sz)} <span className="text-faint">@</span> {formatPrice(item.px)}
        {item.fillCount > 1 ? (
          <span className="ml-1.5 font-sans text-2xs text-faint">{item.fillCount} fills</span>
        ) : null}
      </td>
      <td className={cn(NUM, "text-right text-foreground")}>
        {formatUsd(item.notional, { compact: true })}
      </td>
      <td className={cn(NUM, "text-right", signTone(item.closedPnl))}>{pnl}</td>
      <td className="px-3">
        <span className="flex items-center justify-end gap-1.5">
          {copySide ? (
            <CopyTradeButton
              coin={item.coin}
              side={copySide}
              fallbackMarkPx={item.px}
              className="w-11 px-0"
            />
          ) : (
            // Keeps the columns aligned with rows that have a button.
            <span aria-hidden="true" className="w-11 shrink-0" />
          )}
          <BookmarkButton address={item.user} size="icon-xs" />
        </span>
      </td>
    </tr>
  );
});
