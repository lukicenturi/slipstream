import Link from "next/link";
import { memo } from "react";

import { signTone } from "@/components/shared/tone";
import { formatPercent, formatUsd, shortAddress } from "@/lib/format";
import type { LeaderboardEntry, TimeWindow } from "@/lib/hyperliquid/schemas";
import { cn } from "@/lib/utils";

/** A USD value: compact below `sm`, full from `sm` up. */
function Usd({ value, signed = false }: { value: number; signed?: boolean }) {
  return (
    <>
      <span className="sm:hidden">{formatUsd(value, { compact: true, signed })}</span>
      <span className="hidden sm:inline">{formatUsd(value, { signed })}</span>
    </>
  );
}

export const LeaderboardRow = memo(function LeaderboardRow({
  rank,
  entry,
  timeWindow,
}: {
  rank: number;
  entry: LeaderboardEntry;
  timeWindow: TimeWindow;
}) {
  const { pnl, roi } = entry.windows[timeWindow];
  return (
    <tr className="h-9 border-b transition-colors hover:bg-surface-hover">
      <td className="w-10 px-2 font-mono text-xs text-muted-foreground sm:w-12 sm:px-3">{rank}</td>
      <td className="px-2 whitespace-nowrap sm:px-3">
        <Link
          href={`/trader/${entry.address}`}
          prefetch={false}
          className="block max-w-[7.5rem] truncate text-xs text-foreground hover:text-brand sm:max-w-[14rem]"
          title={entry.address}
        >
          {entry.displayName ? (
            <span className="font-medium">{entry.displayName}</span>
          ) : (
            <span className="font-mono">{shortAddress(entry.address)}</span>
          )}
        </Link>
      </td>
      <td className="hidden px-3 text-right font-mono text-xs whitespace-nowrap sm:table-cell">
        <Usd value={entry.accountValue} />
      </td>
      <td
        className={cn("px-2 text-right font-mono text-xs whitespace-nowrap sm:px-3", signTone(pnl))}
      >
        <Usd value={pnl} signed />
      </td>
      <td
        className={cn("px-2 text-right font-mono text-xs whitespace-nowrap sm:px-3", signTone(roi))}
      >
        {formatPercent(roi, { signed: true })}
      </td>
    </tr>
  );
});
