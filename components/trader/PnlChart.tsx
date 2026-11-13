"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import { WINDOW_LABEL, WindowTabs } from "@/components/leaderboard/WindowTabs";
import { Panel } from "@/components/shared/Panel";
import { EmptyState, ErrorState } from "@/components/shared/States";
import { signTone } from "@/components/shared/tone";
import { Skeleton } from "@/components/ui/skeleton";
import { drawdownSeries, type MaxDrawdown, maxDrawdown } from "@/lib/calc/drawdown";
import { toChartSeries } from "@/lib/calc/pnlSeries";
import { formatPercent, formatUsd } from "@/lib/format";
import type { Portfolio, TimeWindow } from "@/lib/hyperliquid/schemas";
import { cn } from "@/lib/utils";

import type { QueryStatus } from "./TraderHeader";

/** The height of the PnL pane. */
const CHART_HEIGHT = 220;
/** The height of the drawdown pane under the PnL pane. */
const DRAWDOWN_HEIGHT = 56;
/** The full canvas: the PnL pane keeps its height and the drawdown pane adds to it. */
const CANVAS_HEIGHT = CHART_HEIGHT + DRAWDOWN_HEIGHT;

function ChartSkeleton() {
  return <Skeleton className="w-full" style={{ height: CANVAS_HEIGHT }} />;
}

// lightweight-charts needs the DOM, so the canvas never renders on the server.
const PnlChartCanvas = dynamic(() => import("./PnlChartCanvas").then((m) => m.PnlChartCanvas), {
  ssr: false,
  loading: ChartSkeleton,
});

/** "Max DD -$1.2K (-3.40%)". The percent is left out when it is unknown. */
function MaxDrawdownLabel({ value }: { value: MaxDrawdown }) {
  return (
    <span
      data-testid="pnl-max-drawdown"
      className="ml-auto text-2xs whitespace-nowrap text-muted-foreground"
    >
      Max DD{" "}
      <span className="font-mono">
        {formatUsd(value.usd, { compact: true })}
        {value.ratio === null ? null : ` (${formatPercent(value.ratio)})`}
      </span>
    </span>
  );
}

/**
 * PnL over the chosen window, with a Day / Week / Month / All toggle, and
 * the drawdown from the running peak in a lower pane.
 */
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
  const drawdown = useMemo(
    () => (portfolio ? drawdownSeries(portfolio[timeWindow].pnlHistory) : []),
    [portfolio, timeWindow],
  );
  const maxDd = useMemo(
    () =>
      portfolio
        ? maxDrawdown(portfolio[timeWindow].pnlHistory, portfolio[timeWindow].accountValueHistory)
        : null,
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
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            data-testid="pnl-window-value"
            className={cn("font-mono text-xl", signTone(last ?? 0))}
          >
            {formatUsd(last ?? 0, { signed: true })}
          </span>
          <span className="shrink-0 text-2xs text-faint">{WINDOW_LABEL[timeWindow]} PnL</span>
          {maxDd ? <MaxDrawdownLabel value={maxDd} /> : null}
        </p>
        <PnlChartCanvas
          data={series}
          drawdown={drawdown}
          height={CANVAS_HEIGHT}
          drawdownHeight={DRAWDOWN_HEIGHT}
        />
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
