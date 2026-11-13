"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";

import { Panel } from "@/components/shared/Panel";
import { Stat, STAT_GRID, StatNote, StatValue } from "@/components/shared/Stat";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/shared/States";
import { signTone } from "@/components/shared/tone";
import { assetBreakdown, topAssets } from "@/lib/calc/assetBreakdown";
import { sideSplit } from "@/lib/calc/sideSplit";
import { type TradeStats as Stats, tradeStats } from "@/lib/calc/traderStats";
import { formatAmount, formatDuration, formatPercent, formatUsd } from "@/lib/format";
import type { Fill } from "@/lib/hyperliquid/schemas";

import type { QueryStatus } from "./TraderHeader";
import { AssetSection, NotAvailable, SideSplitSection } from "./TradeStatsParts";

const DAY_MS = 86_400_000;

/** The asset breakdown shows this many coins, then one "Other" row. */
const ASSET_ROWS = 6;

/** Smaller values than the header stats: this panel is secondary. */
const VALUE_CLASS = "text-base lg:text-lg";

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

/** A stat cell whose value is "n/a" when the figure does not exist. */
function Figure({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: ReactNode | null;
  tone?: string;
  note: ReactNode;
}) {
  return (
    <Stat label={label} loading={false}>
      <StatValue className={value === null ? VALUE_CLASS : `${VALUE_CLASS} ${tone ?? ""}`}>
        {value === null ? <NotAvailable /> : value}
      </StatValue>
      <StatNote>{note}</StatNote>
    </Stat>
  );
}

function signedUsd(value: number): string {
  return formatUsd(value, { compact: true, signed: true });
}

/**
 * Signed USD without cents from $10 up, so "+$820 / -$410" fits one stat
 * cell at 375 px. Smaller and larger values use the compact format.
 */
function shortUsd(value: number): string {
  const abs = Math.abs(value);
  if (!Number.isFinite(value) || abs < 10 || abs >= 1000) return signedUsd(value);
  return `${value > 0 ? "+" : "-"}$${Math.round(abs).toLocaleString("en-US")}`;
}

function StatCells({ stats }: { stats: Stats }) {
  const closes = stats.wins + stats.losses;
  const avgWin = stats.avgWin === null ? "n/a" : shortUsd(stats.avgWin);
  const avgLoss = stats.avgLoss === null ? "n/a" : shortUsd(-stats.avgLoss);
  return (
    <>
      <Figure
        label="Profit factor"
        value={stats.profitFactor === null ? null : formatAmount(stats.profitFactor, 2, 2)}
        note={
          stats.profitFactor !== null
            ? `${shortUsd(stats.grossProfit)} / ${shortUsd(-stats.grossLoss)} gross`
            : closes === 0
              ? "No closes yet"
              : "No losses yet"
        }
      />
      <Figure
        label="Avg win / loss"
        value={closes === 0 ? null : `${avgWin} / ${avgLoss}`}
        note="Per closing order"
      />
      <Figure
        label="Largest win"
        value={stats.largestWin === null ? null : signedUsd(stats.largestWin)}
        tone={signTone(stats.largestWin ?? 0)}
        note="Best order"
      />
      <Figure
        label="Largest loss"
        value={stats.largestLoss === null ? null : signedUsd(stats.largestLoss)}
        tone={signTone(stats.largestLoss ?? 0)}
        note="Worst order"
      />
      <Figure
        label="Fees paid"
        value={formatUsd(stats.fees, { compact: true })}
        note={`Over ${plural(stats.fills, "fill", "fills")}`}
      />
      <Figure
        label="Orders / day"
        value={stats.ordersPerDay === null ? null : formatAmount(stats.ordersPerDay, 1, 1)}
        note={
          stats.spanDays === null ? "No orders" : `Over ${formatDuration(stats.spanDays * DAY_MS)}`
        }
      />
      <Figure
        label="Median hold"
        value={stats.medianHoldMs === null ? null : formatDuration(stats.medianHoldMs)}
        note={
          stats.roundTrips === 0
            ? "No full round trips"
            : plural(stats.roundTrips, "round trip", "round trips")
        }
      />
      <Figure
        label="Win rate"
        value={stats.winRate === null ? null : formatPercent(stats.winRate)}
        note={`${stats.wins}W ${stats.losses}L`}
      />
    </>
  );
}

/**
 * Trade statistics from the trader's recent fills: a stat grid, the long
 * versus short split and the realized PnL and volume per asset. Only perp
 * fills count, per order, from the last 2,000 fills at most.
 */
export function TradeStats({
  fills,
  status,
  onRetry,
  className,
}: {
  fills: readonly Fill[] | undefined;
  status: QueryStatus;
  onRetry: () => void;
  className?: string;
}) {
  const stats = useMemo(() => (fills ? tradeStats(fills) : undefined), [fills]);
  const split = useMemo(() => (fills ? sideSplit(fills) : undefined), [fills]);
  const assets = useMemo(
    () => (fills ? topAssets(assetBreakdown(fills), ASSET_ROWS) : []),
    [fills],
  );

  let body: ReactNode;
  if (status === "error") {
    body = (
      <ErrorState
        title="Trade stats did not load"
        description="The Hyperliquid info service did not answer."
        onRetry={onRetry}
      />
    );
  } else if (status === "pending" || !stats || !split) {
    body = <SkeletonRows rows={6} label="Loading trade stats" />;
  } else if (stats.orders === 0) {
    body = (
      <EmptyState
        title="No perp trades"
        description="Only spot trades or no trades in the last 2,000 fills."
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-4 p-3">
        <dl className={STAT_GRID}>
          <StatCells stats={stats} />
        </dl>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
          <div className="lg:col-span-5">
            <SideSplitSection split={split} />
          </div>
          <div className="lg:col-span-7">
            <AssetSection rows={assets} />
          </div>
        </div>
      </div>
    );
  }

  const showMeta = status === "success" && stats !== undefined && stats.orders > 0;
  return (
    <Panel
      title="Trade stats"
      titleId="trade-stats-title"
      titleOnMobile
      meta={
        showMeta
          ? `${plural(stats.orders, "order", "orders")} · ${plural(stats.fills, "fill", "fills")}`
          : null
      }
      className={className}
    >
      <div data-testid="trade-stats">{body}</div>
    </Panel>
  );
}
