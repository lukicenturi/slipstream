import { memo } from "react";

import { AssetIcon } from "@/components/shared/AssetIcon";
import { Side } from "@/components/shared/Side";
import { signTone } from "@/components/shared/tone";
import type { AssetRow } from "@/lib/calc/assetBreakdown";
import type { SideSplit, SideStats } from "@/lib/calc/sideSplit";
import { formatPercent, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
 * The parts of the trade stats panel: the long versus short split and the
 * asset breakdown. They only format numbers that lib/calc computed.
 */

/** A small section heading, like the stat labels. */
export const SECTION_HEADING = "text-2xs font-medium tracking-wide text-muted-foreground uppercase";

/** "n/a" in the muted colour, for a figure that does not exist yet. */
export function NotAvailable() {
  return <span className="text-muted-foreground">n/a</span>;
}

function SideLine({ side, stats }: { side: "long" | "short"; stats: SideStats }) {
  return (
    <li
      data-testid={`side-${side}`}
      className="flex h-8 min-w-0 items-center gap-3 font-mono text-xs"
    >
      <Side label={side === "long" ? "Long" : "Short"} tone={side} />
      <span className="min-w-0 flex-1 truncate text-foreground">
        {stats.share === null ? <NotAvailable /> : formatPercent(stats.share)}
        <span className="font-sans text-faint"> of orders</span>
      </span>
      <span className="w-20 shrink-0 truncate text-right text-foreground">
        {stats.winRate === null ? <NotAvailable /> : formatPercent(stats.winRate)}
        <span className="font-sans text-faint"> win</span>
      </span>
      <span className="w-14 shrink-0 truncate text-right text-muted-foreground">
        {formatUsd(stats.volume, { compact: true })}
      </span>
    </li>
  );
}

/** A 6 px bar with a long and a short segment, then one line per side. */
export function SideSplitSection({ split }: { split: SideSplit }) {
  const long = split.long.share ?? 0;
  const short = split.short.share ?? 0;
  return (
    <section aria-labelledby="trade-stats-sides" className="flex flex-col gap-2">
      <h3 id="trade-stats-sides" className={SECTION_HEADING}>
        Long / short
      </h3>
      {/* Decorative: the lines below give the same shares as text. */}
      <div aria-hidden="true" className="flex h-1.5 gap-px overflow-hidden rounded-xs">
        {long > 0 ? <div className="bg-long" style={{ width: `${long * 100}%` }} /> : null}
        {short > 0 ? <div className="bg-short" style={{ width: `${short * 100}%` }} /> : null}
      </div>
      <ul className="flex flex-col">
        <SideLine side="long" stats={split.long} />
        <SideLine side="short" stats={split.short} />
      </ul>
    </section>
  );
}

const AssetLine = memo(function AssetLine({ row }: { row: AssetRow }) {
  const share = formatPercent(row.share);
  return (
    <li
      data-testid="asset-row"
      className="grid h-9 grid-cols-[minmax(0,6rem)_minmax(0,1fr)_4.5rem_3.5rem] items-center gap-3 border-b text-xs last:border-b-0"
    >
      <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
        {row.other ? null : <AssetIcon coin={row.coin} />}
        <span className={cn("truncate", row.other && "text-muted-foreground")}>{row.coin}</span>
      </span>
      <span title={`${share} of volume`} className="flex items-center">
        <span className="sr-only">{share} of volume</span>
        <span aria-hidden="true" className="h-1 w-full overflow-hidden rounded-xs bg-border">
          <span
            className="block h-full bg-muted-foreground/40"
            style={{ width: `${Math.min(1, Math.max(0, row.share)) * 100}%` }}
          />
        </span>
      </span>
      <span className={cn("truncate text-right font-mono", signTone(row.realizedPnl))}>
        {formatUsd(row.realizedPnl, { compact: true, signed: true })}
      </span>
      <span className="truncate text-right font-mono text-muted-foreground">
        {formatUsd(row.volume, { compact: true })}
      </span>
    </li>
  );
});

/** One row per coin: the volume share, the realized PnL and the volume. */
export function AssetSection({ rows }: { rows: readonly AssetRow[] }) {
  return (
    <section aria-labelledby="trade-stats-assets" className="flex flex-col">
      <div className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)_4.5rem_3.5rem] items-center gap-3 pb-1">
        <h3 id="trade-stats-assets" className={cn(SECTION_HEADING, "col-span-2")}>
          By asset
        </h3>
        <span aria-hidden="true" className={cn(SECTION_HEADING, "text-right")}>
          PnL
        </span>
        <span aria-hidden="true" className={cn(SECTION_HEADING, "text-right")}>
          Volume
        </span>
      </div>
      <ol aria-label="Realized PnL and volume by asset">
        {rows.map((row) => (
          <AssetLine key={row.other ? "__other" : row.coin} row={row} />
        ))}
      </ol>
    </section>
  );
}
