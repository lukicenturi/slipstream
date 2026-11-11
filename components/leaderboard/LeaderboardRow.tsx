import Link from "next/link";
import { memo } from "react";

import { BookmarkButton } from "@/components/shared/BookmarkButton";
import { signTone } from "@/components/shared/tone";
import { useDisplayName } from "@/hooks/useNames";
import { formatPercent, formatUsd } from "@/lib/format";
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
  const name = useDisplayName(entry.address, entry.displayName);
  return (
    <tr className="group h-9 border-b transition-colors hover:bg-surface-hover">
      <td className="w-8 px-1.5 font-mono text-xs text-muted-foreground sm:w-12 sm:px-3">{rank}</td>
      {/* Below sm the trader column takes the free width and truncates, so the row never overflows. */}
      <td className="px-2 whitespace-nowrap max-sm:w-full max-sm:max-w-0 sm:px-3">
        <Link
          href={`/trader/${entry.address}`}
          prefetch={false}
          className="block max-w-full truncate text-xs text-foreground hover:text-brand sm:max-w-[14rem]"
          title={entry.address}
        >
          <span className={name.source === "address" ? "font-mono" : "font-medium"}>
            {name.label}
          </span>
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
        className={cn(
          "pr-1 pl-1 text-right font-mono text-xs whitespace-nowrap sm:px-3",
          signTone(roi),
        )}
      >
        {formatPercent(roi, { signed: true })}
      </td>
      <td className="w-7 text-right sm:w-9 sm:pr-2">
        {/* Dimmed on hover devices until the row is hovered or focused; always full on touch. */}
        <BookmarkButton
          address={entry.address}
          className="align-middle pointer-fine:opacity-60 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100 pointer-fine:data-[tracked=true]:opacity-100"
        />
      </td>
    </tr>
  );
});
