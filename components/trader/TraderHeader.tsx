"use client";

import { CopyIcon, ExternalLinkIcon } from "lucide-react";
import { toast } from "sonner";

import { Stat, STAT_GRID, StatNote, StatValue } from "@/components/shared/Stat";
import { EmptyState, ErrorState } from "@/components/shared/States";
import { signTone } from "@/components/shared/tone";
import { Button } from "@/components/ui/button";
import { useLiveUnrealizedPnl } from "@/hooks/useLiveUnrealizedPnl";
import { useProfileDisplayName } from "@/hooks/useNames";
import type { WinRate } from "@/lib/calc/winRate";
import { EMPTY_VALUE, formatPercent, formatUsd, shortAddress } from "@/lib/format";
import type { ClearinghouseState } from "@/lib/hyperliquid/schemas";

import { FollowButton } from "./FollowButton";

export type QueryStatus = "pending" | "error" | "success";

export function explorerUrl(address: string): string {
  return `https://app.hyperliquid.xyz/explorer/address/${address}`;
}

export async function copyAddress(address: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(address);
    toast("Address copied");
  } catch {
    toast.error("Could not copy the address");
  }
}

/** Copy the address, or open it in the Hyperliquid explorer. */
function AddressActions({ address }: { address: string }) {
  return (
    <>
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
    </>
  );
}

/**
 * The profile header: the trader name (when one exists) and the address
 * with copy and explorer actions, the Follow button, and a stat grid
 * (2 columns on mobile, 4 on desktop). Names are best effort: without one,
 * the address is the main line.
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
  const name = useProfileDisplayName(address);
  return (
    <section aria-labelledby="trader-title" className="flex flex-col gap-3">
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
            Trader
          </p>
          {name.source === "address" ? (
            <div className="mt-0.5 flex min-w-0 items-center gap-1">
              <h1
                id="trader-title"
                title={address}
                className="min-w-0 truncate font-mono text-base text-foreground lg:text-lg"
              >
                <span className="md:hidden">{shortAddress(address)}</span>
                <span className="hidden md:inline">{address}</span>
              </h1>
              <AddressActions address={address} />
            </div>
          ) : (
            <>
              <h1
                id="trader-title"
                title={address}
                className="mt-0.5 min-w-0 truncate text-base font-medium text-foreground lg:text-lg"
              >
                {name.label}
              </h1>
              <div className="flex min-w-0 items-center gap-1">
                <span
                  data-testid="trader-address"
                  title={address}
                  className="truncate font-mono text-xs text-muted-foreground"
                >
                  {shortAddress(address)}
                </span>
                <AddressActions address={address} />
              </div>
            </>
          )}
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
        <dl data-testid="trader-stats" className={STAT_GRID}>
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
