"use client";

import { useMemo } from "react";

import { Panel } from "@/components/shared/Panel";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/shared/States";
import type { Position } from "@/lib/hyperliquid/schemas";

import { PositionRow } from "./PositionRow";
import type { QueryStatus } from "./TraderHeader";

/**
 * Open positions, largest first. The table scrolls sideways on narrow
 * screens; the Asset column stays in place. The mark price is the live mid
 * from the shared socket. The account page passes its own title, id and
 * empty texts, and hides the Copy buttons. Positions of builder exchanges
 * carry a badge with the exchange name.
 */
export function PositionsTable({
  positions,
  status,
  onRetry,
  className,
  title = "Positions",
  titleId = "positions-title",
  showCopy = true,
  emptyTitle = "No open positions",
  emptyDescription = "This trader holds no perps now.",
}: {
  /** `dex` is the builder exchange of a position; null or missing is the main exchange. */
  positions: readonly (Position & { dex?: string | null })[] | undefined;
  status: QueryStatus;
  onRetry: () => void;
  className?: string;
  title?: string;
  titleId?: string;
  showCopy?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const columns = [
    "Side",
    "Size",
    "Leverage",
    "Entry",
    "Mark",
    "Unrealized PnL (ROE)",
    "Liq. price",
  ];
  const sorted = useMemo(
    () =>
      positions
        ? [...positions].sort((a, b) => Math.abs(b.positionValue) - Math.abs(a.positionValue))
        : [],
    [positions],
  );

  let body: React.ReactNode;
  if (status === "error") {
    body = (
      <ErrorState
        title="Positions did not load"
        description="The Hyperliquid info service did not answer."
        onRetry={onRetry}
      />
    );
  } else if (status === "pending") {
    body = <SkeletonRows rows={3} label="Loading positions" />;
  } else if (sorted.length === 0) {
    body = <EmptyState title={emptyTitle} description={emptyDescription} />;
  } else {
    body = (
      // "relative" keeps the sr-only caption (absolute) inside the scroll box,
      // so it cannot widen the page.
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse">
          <caption className="sr-only">
            Open positions. Mark price and unrealized PnL update live.
          </caption>
          <thead>
            <tr className="h-8 border-b text-2xs tracking-wide text-muted-foreground uppercase">
              <th
                scope="col"
                className="sticky left-0 z-[1] bg-background px-3 text-left font-normal max-md:border-r"
              >
                Asset
              </th>
              {columns.map((label) => (
                <th
                  key={label}
                  scope="col"
                  className={
                    label === "Side"
                      ? "px-3 text-left font-normal"
                      : "px-3 text-right font-normal whitespace-nowrap"
                  }
                >
                  {label}
                </th>
              ))}
              {showCopy ? (
                <th scope="col" className="px-3 text-right font-normal">
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody data-testid="positions-rows">
            {sorted.map((position) => (
              <PositionRow
                key={position.coin}
                position={position}
                dex={position.dex ?? null}
                showCopy={showCopy}
              />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <Panel
      title={title}
      titleId={titleId}
      titleOnMobile
      meta={status === "success" ? `${sorted.length} open` : null}
      className={className}
    >
      {body}
    </Panel>
  );
}
