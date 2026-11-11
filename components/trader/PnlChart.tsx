"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import { WINDOW_LABEL, WindowTabs } from "@/components/leaderboard/WindowTabs";
import { Panel } from "@/components/shared/Panel";
import { EmptyState, ErrorState } from "@/components/shared/States";
import { signTone } from "@/components/shared/tone";
import { Skeleton } from "@/components/ui/skeleton";
import { toChartSeries } from "@/lib/calc/pnlSeries";
import { formatUsd } from "@/lib/format";
import type { Portfolio, TimeWindow } from "@/lib/hyperliquid/schemas";
import { cn } from "@/lib/utils";

import type { QueryStatus } from "./TraderHeader";

const CHART_HEIGHT = 220;

function ChartSkeleton() {
  return <Skeleton className="w-full" style={{ height: CHART_HEIGHT }} />;
}

// lightweight-charts needs the DOM, so the canvas never renders on the server.
const PnlChartCanvas = dynamic(() => import("./PnlChartCanvas").then((m) => m.PnlChartCanvas), {
  ssr: false,
  loading: ChartSkeleton,
});

/** PnL over the chosen window, with a Day / Week / Month / All toggle. */
export function PnlChart({
  portfolio,
  status,
  onRetry,
  className,
}: {
  portfolio: Portfolio | undefined;
  status: QueryStatus;
  onRetry: () => void;
  className?: string;
}) {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("month");
  const series = useMemo(
    () => (portfolio ? toChartSeries(portfolio[timeWindow].pnlHistory) : []),
    [portfolio, timeWindow],
  );
  const last = series[series.length - 1]?.value;

  let body: React.ReactNode;
  if (status === "error") {
    body = (
      <ErrorState
        title="PnL history did not load"
        description="The Hyperliquid info service did not answer."
        onRetry={onRetry}
      />
    );
  } else if (status === "pending") {
    body = (
      <div className="flex flex-col gap-2 px-3 py-2" role="status" aria-label="Loading PnL">
        <Skeleton className="h-[26px] w-32" />
        <ChartSkeleton />
      </div>
    );
  } else if (series.length === 0) {
    body = (
      <EmptyState
        title="No PnL history"
        description={`Nothing recorded for ${WINDOW_LABEL[timeWindow].toLowerCase()}.`}
        className="py-16"
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-1 px-3 pt-2 pb-1">
        <p className="flex items-baseline gap-2">
          <span
            data-testid="pnl-window-value"
            className={cn("font-mono text-xl", signTone(last ?? 0))}
          >
            {formatUsd(last ?? 0, { signed: true })}
          </span>
          <span className="text-2xs text-faint">{WINDOW_LABEL[timeWindow]} PnL</span>
        </p>
        <PnlChartCanvas data={series} height={CHART_HEIGHT} />
        <a
          href="https://www.tradingview.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="self-end text-[10px] text-faint hover:text-muted-foreground"
        >
          Chart by TradingView
        </a>
      </div>
    );
  }

  return (
    <Panel
      title="PnL"
      titleId="pnl-title"
      titleOnMobile
      actions={<WindowTabs value={timeWindow} onChange={setTimeWindow} />}
      className={className}
    >
      {body}
    </Panel>
  );
}
