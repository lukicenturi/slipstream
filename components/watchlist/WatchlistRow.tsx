"use client";

import { Trash2Icon } from "lucide-react";
import Link from "next/link";
import { memo, type ReactNode } from "react";

import { RelativeTime } from "@/components/feed/RelativeTime";
import { signTone } from "@/components/shared/tone";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAlertSettings } from "@/hooks/useAlertSettings";
import { useLastTrade } from "@/hooks/useLastTrades";
import { useLiveUnrealizedPnl } from "@/hooks/useLiveUnrealizedPnl";
import { useDisplayName } from "@/hooks/useNames";
import { useWatchlist } from "@/hooks/useWatchlist";
import type { WatchlistAccount } from "@/hooks/useWatchlistAccounts";
import { isAlertEnabled } from "@/lib/alerts";
import { describeFillAction } from "@/lib/calc/fillAction";
import { EMPTY_VALUE, formatUsd } from "@/lib/format";
import type { Position } from "@/lib/hyperliquid/schemas";
import { cn } from "@/lib/utils";

/**
 * Mobile: two lines (trader, alerts, remove; then the numbers).
 * From `md` up: one 36 px row with a column per value.
 */
export const WATCHLIST_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_4.5rem_minmax(0,1.5fr)_3.5rem_2rem] md:gap-x-3";

/** One value. Below `md` it carries a small label, because there is no header row. */
function Cell({
  label,
  mobileLabel = label,
  children,
  className,
}: {
  label: string;
  mobileLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-baseline gap-1 md:block md:min-w-0", className)}
    >
      <span className="text-2xs text-faint md:hidden">{mobileLabel}</span>
      <span className="sr-only max-md:hidden">{label}</span>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** The live unrealized PnL. A small leaf, because it re-renders on every tick of its coins. */
function LivePnl({ positions }: { positions: readonly Position[] }) {
  const pnl = useLiveUnrealizedPnl(positions);
  return (
    <span className={cn("font-mono tabular-nums", signTone(pnl))}>
      {formatUsd(pnl, { compact: true, signed: true })}
    </span>
  );
}

function LastTrade({ address }: { address: string }) {
  const item = useLastTrade(address);
  if (!item) return <span className="text-faint">{EMPTY_VALUE}</span>;
  const { verb } = describeFillAction(item.dir);
  return (
    <span className="text-muted-foreground" title={item.dir}>
      <RelativeTime time={item.time} className="text-faint" /> {verb}{" "}
      <span className="text-foreground">{item.coin}</span>
    </span>
  );
}

export const WatchlistRow = memo(function WatchlistRow({
  address,
  account,
  displayName,
}: {
  address: string;
  /** Undefined when the address is above the 50-address query cap. */
  account: WatchlistAccount | undefined;
  displayName?: string;
}) {
  const name = useDisplayName(address, displayName);
  const { remove } = useWatchlist();
  const { settings, setAddressAlert } = useAlertSettings();
  const alertsOn = isAlertEnabled(settings, address);

  let values: ReactNode;
  if (!account) {
    values = (
      <span className="col-span-full text-2xs text-faint md:col-span-4">
        Not loaded: the page loads account data for the first 50 traders.
      </span>
    );
  } else if (account.status === "error") {
    values = (
      <span
        role="alert"
        className="col-span-full flex items-center gap-2 text-2xs text-short md:col-span-4"
      >
        The account did not load.
        <Button type="button" variant="outline" size="xs" onClick={account.refetch}>
          Retry
        </Button>
      </span>
    );
  } else if (account.status === "pending" || !account.data) {
    values = (
      <span
        aria-hidden="true"
        className="col-span-full flex gap-3 md:col-span-4 md:grid md:grid-cols-subgrid"
      >
        <Skeleton className="h-3 w-16 md:ml-auto" />
        <Skeleton className="h-3 w-14 md:ml-auto" />
        <Skeleton className="h-3 w-6 md:ml-auto" />
        <Skeleton className="h-3 w-20" />
      </span>
    );
  } else {
    const state = account.data;
    values = (
      <>
        <Cell label="Account value" mobileLabel="Value" className="md:text-right">
          <span className="font-mono text-foreground tabular-nums">
            {formatUsd(state.accountValue, { compact: true })}
          </span>
        </Cell>
        <Cell label="Unrealized PnL" mobileLabel="uPnL" className="md:text-right">
          <LivePnl positions={state.positions} />
        </Cell>
        <Cell label="Open positions" mobileLabel="Pos" className="md:text-right">
          <span className="font-mono text-foreground tabular-nums">{state.positions.length}</span>
        </Cell>
        <Cell label="Last trade" className="max-md:hidden">
          <LastTrade address={address} />
        </Cell>
      </>
    );
  }

  return (
    <li
      data-testid="watchlist-row"
      data-address={address}
      className={cn(WATCHLIST_GRID, "border-b px-3 py-1.5 text-xs md:h-9 md:py-0")}
    >
      <Link
        href={`/trader/${address}`}
        prefetch={false}
        title={address}
        className={cn(
          "min-w-0 truncate rounded-sm text-foreground hover:text-brand",
          name.source === "address" ? "font-mono" : "font-medium",
        )}
      >
        {name.label}
      </Link>

      {/* Numbers: a second line on mobile, their own columns from md up. */}
      <div className="order-last col-span-full flex min-w-0 items-center gap-x-3 md:contents">
        {values}
        {account?.status === "success" ? (
          <span className="min-w-0 flex-1 truncate text-right text-2xs md:hidden">
            <LastTrade address={address} />
          </span>
        ) : null}
      </div>

      <Button
        type="button"
        variant="outline"
        size="xs"
        aria-pressed={alertsOn}
        aria-label={`Alerts for ${name.label}`}
        onClick={() => setAddressAlert(address, !alertsOn)}
        data-testid="watchlist-alert-toggle"
        className={cn(
          "w-11 font-mono",
          alertsOn
            ? "border-brand/40 bg-brand-dim text-brand hover:border-brand/60 hover:bg-brand-dim"
            : "text-muted-foreground",
        )}
      >
        {alertsOn ? "On" : "Off"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Stop tracking ${name.label}`}
        title={`Stop tracking ${name.label}`}
        onClick={() => remove(address)}
        data-testid="watchlist-remove"
        className="hover:text-short max-md:size-6"
      >
        <Trash2Icon aria-hidden="true" />
      </Button>
    </li>
  );
});
