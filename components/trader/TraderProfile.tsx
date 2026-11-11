"use client";

import { useMemo } from "react";

import { useTrader } from "@/hooks/useTrader";
import { isSystemFill } from "@/lib/calc/fillAction";
import { hasNoActivity } from "@/lib/calc/positions";
import { winRate } from "@/lib/calc/winRate";

import { PnlChart } from "./PnlChart";
import { PositionsTable } from "./PositionsTable";
import { RecentFills } from "./RecentFills";
import { TraderHeader } from "./TraderHeader";

/**
 * The trader profile: header and stats, open positions, the PnL chart and
 * recent fills. The address is valid and lower-case.
 */
export function TraderProfile({ address }: { address: string }) {
  const { state, fills, portfolio } = useTrader(address);
  const rate = useMemo(() => (fills.data ? winRate(fills.data) : undefined), [fills.data]);

  const noActivity =
    state.data !== undefined &&
    fills.data !== undefined &&
    hasNoActivity({
      accountValue: state.data.accountValue,
      positionCount: state.data.positions.length,
      // Exchange-made fills (spot dust conversions) are not activity of the trader.
      fillCount: fills.data.filter((fill) => !isSystemFill(fill.dir)).length,
    });

  return (
    <div className="flex flex-col gap-4">
      <TraderHeader
        address={address}
        state={state.data}
        stateStatus={state.status}
        onRetryState={() => void state.refetch()}
        winRate={rate}
        fillsStatus={fills.status}
        noActivity={noActivity}
      />
      {noActivity ? null : (
        <>
          <PositionsTable
            positions={state.data?.positions}
            status={state.status}
            onRetry={() => void state.refetch()}
            className="lg:order-2"
          />
          {/* Mobile: positions come first. Desktop: the chart row sits above them. */}
          <div className="grid grid-cols-1 gap-4 lg:order-1 lg:grid-cols-12">
            <PnlChart
              portfolio={portfolio.data}
              status={portfolio.status}
              onRetry={() => void portfolio.refetch()}
              className="lg:col-span-7"
            />
            {/* On desktop the chart sets the row height; the fills list scrolls inside it. */}
            <div className="min-h-0 lg:relative lg:col-span-5">
              <RecentFills
                fills={fills.data}
                status={fills.status}
                onRetry={() => void fills.refetch()}
                className="max-lg:max-h-[480px] lg:absolute lg:inset-0"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
