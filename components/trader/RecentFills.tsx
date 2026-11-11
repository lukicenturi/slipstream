"use client";

import { useMemo } from "react";

import { Panel } from "@/components/shared/Panel";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/shared/States";
import { aggregateFills } from "@/lib/calc/aggregateFills";
import type { Fill } from "@/lib/hyperliquid/schemas";

import { FillRow } from "./FillRow";
import type { QueryStatus } from "./TraderHeader";

/** The number of recent orders that the list shows. */
export const RECENT_ORDER_COUNT = 50;

/** The trader's most recent orders, with partial fills joined per order. */
export function RecentFills({
  fills,
  status,
  onRetry,
  className,
  title = "Recent fills",
  titleId = "fills-title",
  emptyTitle = "No fills yet",
  emptyDescription = "This trader has no recorded trades.",
}: {
  fills: readonly Fill[] | undefined;
  status: QueryStatus;
  onRetry: () => void;
  className?: string;
  title?: string;
  titleId?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const items = useMemo(
    () => (fills ? aggregateFills(fills).slice(0, RECENT_ORDER_COUNT) : []),
    [fills],
  );

  let body: React.ReactNode;
  if (status === "error") {
    body = (
      <ErrorState
        title="Fills did not load"
        description="The Hyperliquid info service did not answer."
        onRetry={onRetry}
      />
    );
  } else if (status === "pending") {
    body = <SkeletonRows rows={6} rowClassName="h-10" label="Loading fills" />;
  } else if (items.length === 0) {
    body = <EmptyState title={emptyTitle} description={emptyDescription} />;
  } else {
    body = (
      <ol aria-label="Recent orders" data-testid="fills-list">
        {items.map((item) => (
          <FillRow key={item.oid} item={item} />
        ))}
      </ol>
    );
  }

  return (
    <Panel
      title={title}
      titleId={titleId}
      titleOnMobile
      focusableBody
      meta={status === "success" && items.length > 0 ? `Last ${items.length} orders` : null}
      className={className}
    >
      {body}
    </Panel>
  );
}
