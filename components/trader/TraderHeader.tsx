"use client";

import { CopyIcon, ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { EmptyState, ErrorState } from "@/components/shared/States";
import { signTone } from "@/components/shared/tone";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLiveUnrealizedPnl } from "@/hooks/useLiveUnrealizedPnl";
import type { WinRate } from "@/lib/calc/winRate";
import { EMPTY_VALUE, formatPercent, formatUsd, shortAddress } from "@/lib/format";
import type { ClearinghouseState } from "@/lib/hyperliquid/schemas";
import { cn } from "@/lib/utils";

import { FollowButton } from "./FollowButton";

export type QueryStatus = "pending" | "error" | "success";

export function explorerUrl(address: string): string {
  return `https://app.hyperliquid.xyz/explorer/address/${address}`;
}

async function copyAddress(address: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(address);
    toast("Address copied");
  } catch {
    toast.error("Could not copy the address");
  }
}

/**
 * The profile header: the address with copy and explorer actions, the
 * Follow button, and a stat grid (2 columns on mobile, 4 on desktop).
 */
export function TraderHeader({
  address,
  state,
  stateStatus,
  onRetryState,
  winRate,
  fillsStatus,
  noActivity,
}: {
  address: string;
  state: ClearinghouseState | undefined;
  stateStatus: QueryStatus;
  onRetryState: () => void;
  winRate: WinRate | undefined;
  fillsStatus: QueryStatus;
  noActivity: boolean;
}) {
  return (
    <section aria-labelledby="trader-title" className="flex flex-col gap-3">
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
            Trader
          </p>
          <div className="mt-0.5 flex min-w-0 items-center gap-1">
            <h1
              id="trader-title"
              title={address}
              className="min-w-0 truncate font-mono text-base text-foreground lg:text-lg"
            >
              <span className="md:hidden">{shortAddress(address)}</span>
              <span className="hidden md:inline">{address}</span>
            </h1>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Copy address"
              onClick={() => void copyAddress(address)}
            >
              <CopyIcon aria-hidden="true" />
            </Button>
            <Button asChild variant="ghost" size="icon-xs">
              <a
                href={explorerUrl(address)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open in the Hyperliquid explorer"
              >
                <ExternalLinkIcon aria-hidden="true" />
              </a>
            </Button>
          </div>
        </div>
        <FollowButton address={address} />
      </div>

      {noActivity ? (
        <div className="rounded-lg border">
          <EmptyState
            title="No activity for this address on Hyperliquid."
            description="It holds no funds, no open positions and no trades."
          />
        </div>
      ) : stateStatus === "error" ? (
        <div className="rounded-lg border">
          <ErrorState
            title="The account did not load"
            description="The Hyperliquid info service did not answer."
            onRetry={onRetryState}
          />
        </div>
      ) : (
        <dl
          data-testid="trader-stats"
          className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4"
        >
          <Stat label="Account value" loading={stateStatus === "pending"}>
            {state ? (
              <>
                <StatValue>{formatUsd(state.accountValue)}</StatValue>
                <StatNote>{formatUsd(state.withdrawable, { compact: true })} withdrawable</StatNote>
              </>
            ) : null}
          </Stat>
          <Stat label="Unrealized PnL" loading={stateStatus === "pending"}>
            {state ? <LiveUnrealizedPnl state={state} /> : null}
          </Stat>
          <Stat label="Win rate" loading={fillsStatus === "pending"}>
            <WinRateValue winRate={winRate} failed={fillsStatus === "error"} />
          </Stat>
          <Stat label="Open positions" loading={stateStatus === "pending"}>
            {state ? (
              <>
                <StatValue>{state.positions.length}</StatValue>
                <StatNote>{formatUsd(state.totalNotional, { compact: true })} notional</StatNote>
              </>
            ) : null}
          </Stat>
        </dl>
      )}
    </section>
  );
}

function Stat({
  label,
  loading,
  children,
}: {
  label: string;
  loading: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-background px-3 py-2.5">
      <dt className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="flex min-w-0 flex-col gap-0.5">
        {loading ? (
          <>
            <Skeleton className="h-[22px] w-24 lg:h-[26px]" />
            <Skeleton className="h-3 w-16" />
          </>
        ) : (
          children
        )}
      </dd>
    </div>
  );
}

function StatValue({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("truncate font-mono text-lg text-foreground lg:text-xl", className)}>
      {children}
    </span>
  );
}

function StatNote({ children }: { children: ReactNode }) {
  return <span className="truncate text-2xs text-faint">{children}</span>;
}

/** Re-renders on every tick of a position coin, so it stays a small leaf. */
function LiveUnrealizedPnl({ state }: { state: ClearinghouseState }) {
  const pnl = useLiveUnrealizedPnl(state.positions);
  return (
    <>
      <StatValue className={signTone(pnl)}>
        <span data-testid="trader-unrealized-pnl">{formatUsd(pnl, { signed: true })}</span>
      </StatValue>
      <StatNote>{formatUsd(state.totalMarginUsed, { compact: true })} margin used</StatNote>
    </>
  );
}

function WinRateValue({ winRate, failed }: { winRate: WinRate | undefined; failed: boolean }) {
  if (failed || !winRate) {
    return (
      <>
        <StatValue>{EMPTY_VALUE}</StatValue>
        <StatNote>Fills did not load</StatNote>
      </>
    );
  }
  return (
    <>
      <StatValue>{winRate.rate === null ? EMPTY_VALUE : formatPercent(winRate.rate)}</StatValue>
      <StatNote>
        {winRate.closes === 0
          ? "No closes"
          : `${winRate.closes} ${winRate.closes === 1 ? "close" : "closes"}`}
      </StatNote>
    </>
  );
}
