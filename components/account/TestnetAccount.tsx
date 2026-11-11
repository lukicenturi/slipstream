"use client";

import { ArrowUpRightIcon, CopyIcon, ExternalLinkIcon, WalletIcon } from "lucide-react";
import { useConnection } from "wagmi";

import { Stat, STAT_GRID, StatNote, StatValue } from "@/components/shared/Stat";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/shared/States";
import { signTone } from "@/components/shared/tone";
import { PositionsTable } from "@/components/trader/PositionsTable";
import { RecentFills } from "@/components/trader/RecentFills";
import { copyAddress } from "@/components/trader/TraderHeader";
import { ConnectWalletPopover } from "@/components/trading/ConnectWallet";
import { Button } from "@/components/ui/button";
import { useLiveUnrealizedPnl } from "@/hooks/useLiveUnrealizedPnl";
import { useTraderFills, useTraderState } from "@/hooks/useTrader";
import { DUST_ACCOUNT_VALUE } from "@/lib/calc/positions";
import { formatUsd, shortAddress } from "@/lib/format";
import type { ClearinghouseState } from "@/lib/hyperliquid/schemas";
import { explorerAddressUrl, HL } from "@/lib/network";
import { NETWORK_URLS, TESTNET } from "@/lib/trading/config";

const ACCOUNT_REFRESH_MS = 10_000;
const FILLS_REFRESH_MS = 30_000;

/**
 * The connected wallet's testnet account (testnet build only; it needs
 * wagmi, so it loads lazily). It uses the same queries as the profile at
 * /trader/<address> and the prices of the shared socket, so both pages show
 * the same numbers. It only reads: the info endpoint, never the exchange.
 */
export default function TestnetAccount() {
  const connection = useConnection();
  const address = connection.address?.toLowerCase();

  if (address) return <ConnectedAccount address={address} />;
  if (connection.status === "connecting" || connection.status === "reconnecting") {
    return (
      <div className="rounded-lg border">
        <SkeletonRows rows={4} label="Connecting the wallet" />
      </div>
    );
  }
  return <ConnectPrompt />;
}

function ConnectPrompt() {
  return (
    <section
      aria-labelledby="testnet-account-title"
      data-testid="testnet-account-connect"
      className="rounded-lg border"
    >
      <h2 id="testnet-account-title" className="sr-only">
        My testnet account
      </h2>
      <EmptyState
        title="Connect a wallet to see your testnet account"
        description="Slipstream reads your testnet balance, positions and fills. It never asks for your wallet key."
      >
        <ConnectWalletPopover align="center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            data-testid="account-connect"
          >
            <WalletIcon aria-hidden="true" />
            Connect wallet
          </Button>
        </ConnectWalletPopover>
      </EmptyState>
    </section>
  );
}

function ConnectedAccount({ address }: { address: string }) {
  const account = useTraderState(address, { refetchInterval: ACCOUNT_REFRESH_MS });
  const fills = useTraderFills(address, { refetchInterval: FILLS_REFRESH_MS });
  const state = account.data;
  const pending = account.status === "pending";

  return (
    <section
      aria-labelledby="testnet-account-title"
      data-testid="testnet-account"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 id="testnet-account-title" className="text-sm font-semibold text-foreground">
            My testnet account
          </h2>
          <div className="flex min-w-0 items-center gap-1">
            <span
              data-testid="testnet-account-address"
              title={address}
              className="truncate font-mono text-xs text-muted-foreground"
            >
              <span className="md:hidden">{shortAddress(address)}</span>
              <span className="hidden md:inline">{address}</span>
            </span>
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
                data-testid="testnet-explorer-link"
              >
                <ExternalLinkIcon aria-hidden="true" />
              </a>
            </Button>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={`${NETWORK_URLS.mainnet}/trader/${address}`} data-testid="open-on-mainnet-link">
            Open on Mainnet
            <ArrowUpRightIcon aria-hidden="true" />
          </a>
        </Button>
      </div>

      {account.status === "error" ? (
        <div className="rounded-lg border">
          <ErrorState
            title="The testnet account did not load"
            description="The Hyperliquid testnet info service did not answer."
            onRetry={() => void account.refetch()}
          />
        </div>
      ) : (
        <dl data-testid="testnet-stats" className={STAT_GRID}>
          <Stat label="Account value" loading={pending}>
            {state ? (
              <>
                <StatValue>{formatUsd(state.accountValue)}</StatValue>
                <StatNote>{formatUsd(state.totalNotional, { compact: true })} notional</StatNote>
              </>
            ) : null}
          </Stat>
          <Stat label="USDC available" loading={pending}>
            {state ? (
              <>
                <StatValue>{formatUsd(state.withdrawable)}</StatValue>
                <StatNote>Withdrawable</StatNote>
              </>
            ) : null}
          </Stat>
          <Stat label="Margin used" loading={pending}>
            {state ? (
              <>
                <StatValue>{formatUsd(state.totalMarginUsed)}</StatValue>
                <StatNote>
                  {state.positions.length} open{" "}
                  {state.positions.length === 1 ? "position" : "positions"}
                </StatNote>
              </>
            ) : null}
          </Stat>
          <Stat label="Unrealized PnL" loading={pending}>
            {state ? <LiveTestnetPnl state={state} /> : null}
          </Stat>
        </dl>
      )}

      {state && state.accountValue < DUST_ACCOUNT_VALUE ? (
        <p
          data-testid="testnet-no-funds"
          className="rounded-lg border border-brand/40 bg-brand-dim px-3 py-2 text-xs text-foreground"
        >
          No testnet funds yet.{" "}
          <a
            href={TESTNET.faucetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm text-brand underline-offset-2 hover:underline"
          >
            Get test USDC from the faucet
          </a>
          . It needs a wallet that holds funds on mainnet.
        </p>
      ) : null}

      <PositionsTable
        positions={state?.positions}
        status={account.status}
        onRetry={() => void account.refetch()}
        title="Testnet positions"
        titleId="testnet-positions-title"
        showCopy={false}
        emptyTitle="No open testnet positions"
        emptyDescription="This wallet holds no perps on testnet."
      />
      <RecentFills
        fills={fills.data}
        status={fills.status}
        onRetry={() => void fills.refetch()}
        title="Testnet fills"
        titleId="testnet-fills-title"
        emptyTitle="No testnet fills yet"
        emptyDescription="Orders that you place on testnet show here."
        className="max-h-[480px]"
      />
    </section>
  );
}

/** Re-renders on every tick of a position coin, so it stays a small leaf. */
function LiveTestnetPnl({ state }: { state: ClearinghouseState }) {
  const pnl = useLiveUnrealizedPnl(state.positions);
  return (
    <>
      <StatValue className={signTone(pnl)}>
        <span data-testid="testnet-unrealized-pnl">{formatUsd(pnl, { signed: true })}</span>
      </StatValue>
      <StatNote>At live mids</StatNote>
    </>
  );
}
