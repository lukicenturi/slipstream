"use client";

import type { FeedItem } from "@/lib/calc/aggregateFills";
import { cn } from "@/lib/utils";

import { FeedTableRow } from "./FeedTableRow";

/** Column widths: the trader and action columns take the free width. */
const COLUMNS = [
  { label: "Time", className: "w-[104px] text-left" },
  { label: "Trader", className: "text-left" },
  { label: "Action", className: "text-left" },
  { label: "Asset", className: "w-[168px] text-left" },
  { label: "Size @ Price", className: "w-[240px] text-right" },
  { label: "Notional", className: "w-[112px] text-right" },
  { label: "Closed PnL", className: "w-[112px] text-right" },
] as const;

// A collapsed table border scrolls away with the rows, so the sticky header
// draws its 1 px bottom line as an inset box shadow.
const HEAD_CELL =
  "sticky top-0 z-[1] bg-background px-3 font-normal whitespace-nowrap [box-shadow:inset_0_-1px_0_var(--color-border)]";

/**
 * The desktop live feed: a dense table with one 36 px row per order and a
 * sticky header. The panel body is the scroll box, so the header sticks to it.
 */
export function FeedTable({
  items,
  names,
}: {
  items: readonly FeedItem[];
  names: ReadonlyMap<string, string>;
}) {
  return (
    <table className="w-full table-fixed border-collapse" data-testid="feed-table">
      <caption className="sr-only">Live trades of the top traders, newest first.</caption>
      <thead>
        <tr className="h-8 text-2xs tracking-wide text-muted-foreground uppercase">
          {COLUMNS.map((column) => (
            <th key={column.label} scope="col" className={cn(HEAD_CELL, column.className)}>
              {column.label}
            </th>
          ))}
          <th scope="col" className={cn(HEAD_CELL, "w-[104px]")}>
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody data-testid="feed-rows">
        {items.map((item) => (
          <FeedTableRow key={item.id} item={item} name={names.get(item.user)} />
        ))}
      </tbody>
    </table>
  );
}
