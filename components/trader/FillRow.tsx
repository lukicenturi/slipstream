import { memo } from "react";

import { Side } from "@/components/shared/Side";
import { signTone } from "@/components/shared/tone";
import type { AggregatedFill } from "@/lib/calc/aggregateFills";
import { describeFillAction, sideLabel } from "@/lib/calc/fillAction";
import { formatClockTime, formatPrice, formatSize, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * One aggregated order of the trader. The same two-line structure as a
 * live feed row, with the clock time instead of a relative time.
 */
export const FillRow = memo(function FillRow({ item }: { item: AggregatedFill }) {
  const action = describeFillAction(item.dir);
  const badge = sideLabel(action, item.side);
  return (
    <li
      data-testid="fill-row"
      className="flex min-h-10 flex-col justify-center gap-0.5 border-b px-3 py-1.5 transition-colors hover:bg-surface-hover"
    >
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <Side label={badge.label} tone={badge.tone} />
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
          <span className={cn("shrink-0", signTone(item.closedPnl))}>
            <span className="font-sans text-faint">PnL </span>
            {formatUsd(item.closedPnl, { compact: true, signed: true })}
          </span>
        ) : null}
        <time
          dateTime={new Date(item.time).toISOString()}
          title={new Date(item.time).toLocaleString("en-US")}
          className="ml-auto shrink-0 text-faint"
        >
          {formatClockTime(item.time)}
        </time>
      </div>
    </li>
  );
});
