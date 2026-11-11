"use client";

import { CopyIcon, ExternalLinkIcon } from "lucide-react";
import { toast } from "sonner";

import { AccountValueStat } from "@/components/account/AccountValueStat";
import { Blockie } from "@/components/shared/Blockie";
import { Stat, STAT_GRID, StatNote, StatValue } from "@/components/shared/Stat";
import { EmptyState, ErrorState } from "@/components/shared/States";
import { signTone } from "@/components/shared/tone";
import { Button } from "@/components/ui/button";
import type { AccountBalances } from "@/hooks/useAccountBalances";
import { useLiveUnrealizedPnl } from "@/hooks/useLiveUnrealizedPnl";
import { useProfileDisplayName } from "@/hooks/useNames";
import type { AccountPosition } from "@/lib/calc/balances";
import type { WinRate } from "@/lib/calc/winRate";
import { EMPTY_VALUE, formatPercent, formatUsd, shortAddress } from "@/lib/format";
import { explorerAddressUrl, HL, NETWORK } from "@/lib/network";

import { FollowButton } from "./FollowButton";

export type QueryStatus = "pending" | "error" | "success";

export async function copyAddress(address: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(address);
    toast("Address copied");
  } catch {
    toast.error("Could not copy the address");
  }
}

/** Copy the address, or open it in the explorer of this build's network. */
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
          href={explorerAddressUrl(address)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open in the ${HL.explorerLabel}`}
          title={HL.explorerLabel}
          data-testid="explorer-link"
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
  balances,
  positions,
  stateStatus,
  onRetryState,
  winRate,
  fillsStatus,
  noActivity,
}: {
  address: string;
  /** Every perp exchange and spot; "Account value" adds them up. */
  balances: AccountBalances;
  /** Open positions of every perp exchange. */
  positions: readonly AccountPosition[];
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
        <div className="flex min-w-0 flex-1 items-center gap-2.5 lg:gap-3">
          {/* 32 px on mobile, 40 px from lg up (the header line is tall enough there). */}
          <Blockie address={address} size={32} className="lg:size-10" />
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
        </div>
        <FollowButton address={address} />
      </div>

      {noActivity ? (
        <div className="rounded-lg border">
          <EmptyState
            title={
              NETWORK === "testnet"
                ? "No activity for this address on Hyperliquid testnet."
                : "No activity for this address on Hyperliquid."
            }
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
          <AccountValueStat balances={balances} />
          <Stat label="Unrealized PnL" loading={stateStatus === "pending"}>
            <LiveUnrealizedPnl
              positions={positions}
              marginUsed={sumStates(balances, "totalMarginUsed")}
            />
          </Stat>
          <Stat label="Win rate" loading={fillsStatus === "pending"}>
            <WinRateValue winRate={winRate} failed={fillsStatus === "error"} />
          </Stat>
          <Stat label="Open positions" loading={stateStatus === "pending"}>
            <StatValue>{positions.length}</StatValue>
            <StatNote>
              {formatUsd(sumStates(balances, "totalNotional"), { compact: true })} notional
            </StatNote>
          </Stat>
        </dl>
      )}
    </section>
  );
}

/** The sum of one margin figure over the main and the loaded builder exchanges. */
function sumStates(balances: AccountBalances, field: "totalNotional" | "totalMarginUsed"): number {
  let sum = balances.main.data?.[field] ?? 0;
  for (const { state } of balances.dexStates) sum += state[field];
  return sum;
}

/** Re-renders on every tick of a position coin, so it stays a small leaf. */
function LiveUnrealizedPnl({
  positions,
  marginUsed,
}: {
  positions: readonly AccountPosition[];
  marginUsed: number;
}) {
  const pnl = useLiveUnrealizedPnl(positions);
  return (
    <>
      <StatValue className={signTone(pnl)}>
        <span data-testid="trader-unrealized-pnl">{formatUsd(pnl, { signed: true })}</span>
      </StatValue>
      <StatNote>{formatUsd(marginUsed, { compact: true })} margin used</StatNote>
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
