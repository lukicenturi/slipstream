"use client";

import { ArrowUpRightIcon, CopyIcon, ExternalLinkIcon, WalletIcon } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { useConnection } from "wagmi";

import { AccountValueStat } from "@/components/account/AccountValueStat";
import { BalancesPanel } from "@/components/account/BalancesPanel";
import { BuilderUsdcNote } from "@/components/account/BuilderUsdcNote";
import { Blockie } from "@/components/shared/Blockie";
import { Stat, STAT_GRID, StatNote, StatValue } from "@/components/shared/Stat";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/shared/States";
import { signTone } from "@/components/shared/tone";
import { PositionsTable } from "@/components/trader/PositionsTable";
import { RecentFills } from "@/components/trader/RecentFills";
import { copyAddress } from "@/components/trader/TraderHeader";
import { ConnectWalletPopover } from "@/components/trading/ConnectWallet";
import { Button } from "@/components/ui/button";
import { isLoadingBalances, useAccountBalances } from "@/hooks/useAccountBalances";
import { useLiveUnrealizedPnl } from "@/hooks/useLiveUnrealizedPnl";
import { ACCOUNT_REFRESH_MS, useTraderFills, useTraderState } from "@/hooks/useTrader";
import {
  builderDexWithUsdc,
  collectPositions,
  perpAccounts,
  type AccountPosition,
} from "@/lib/calc/balances";
import { DUST_ACCOUNT_VALUE } from "@/lib/calc/positions";
import { formatUsd, shortAddress } from "@/lib/format";
import { explorerAddressUrl, HL } from "@/lib/network";
import {
  NETWORK,
  NETWORK_URLS,
  networkLabel,
  otherNetwork,
  TESTNET,
  TRADING_ENABLED,
} from "@/lib/trading/config";

const FILLS_REFRESH_MS = 30_000;

/** The texts of each build. The testnet texts are the ones from before Phase 4j. */
const COPY = TRADING_ENABLED
  ? {
      title: "My testnet account",
      promptTitle: "Connect a wallet to see your testnet account",
      promptDescription:
        "Slipstream reads your testnet balance, positions and fills. It never asks for your wallet key.",
      errorTitle: "The testnet account did not load",
      errorDescription: "The Hyperliquid testnet info service did not answer.",
      positionsTitle: "Testnet positions",
      positionsEmptyTitle: "No open testnet positions",
      positionsEmptyDescription: "This wallet holds no perps on testnet.",
      balancesTitle: "Testnet balances",
      fillsTitle: "Testnet fills",
      fillsEmptyTitle: "No testnet fills yet",
      fillsEmptyDescription: "Orders that you place on testnet show here.",
    }
  : {
      title: "My wallet account",
      promptTitle: "Connect a wallet to see your account",
      promptDescription: "Slipstream only reads your address.",
      errorTitle: "The account did not load",
      errorDescription: "The Hyperliquid info service did not answer.",
      positionsTitle: "Positions",
      positionsEmptyTitle: "No open positions",
      positionsEmptyDescription: "This wallet holds no perps on Hyperliquid.",
      balancesTitle: "Balances",
      fillsTitle: "Fills",
      fillsEmptyTitle: "No fills yet",
      fillsEmptyDescription: "This wallet has no fills on Hyperliquid.",
    };

const OTHER_NETWORK = otherNetwork(NETWORK);

/**
 * The connected wallet's account, in every build (it needs wagmi, so it
 * loads lazily). It uses the same queries as the profile at
 * /trader/<address> and the prices of the shared socket, so both pages show
 * the same numbers, including builder perp exchanges and spot. It only
 * reads: the info endpoint, never the exchange. On mainnet it also hides
 * the trading notes (faucet, USDC transfer). lib/wallet-guard.test.ts checks
 * that it imports no exchange code.
 */
export default function WalletAccount() {
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
      aria-labelledby="wallet-account-title"
      data-testid="wallet-account-connect"
      className="rounded-lg border"
    >
      <h2 id="wallet-account-title" className="sr-only">
        {COPY.title}
      </h2>
      <EmptyState title={COPY.promptTitle} description={COPY.promptDescription}>
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
        <p data-testid="account-no-wallet" className="mt-2 text-2xs text-muted-foreground">
          No wallet? Search any address in the header, or track it in the{" "}
          <Link
            href="/watchlist"
            prefetch={false}
            className="rounded-sm text-brand underline-offset-2 hover:underline"
          >
            watchlist
          </Link>
          .
        </p>
      </EmptyState>
    </section>
  );
}

function ConnectedAccount({ address }: { address: string }) {
  const account = useTraderState(address, { refetchInterval: ACCOUNT_REFRESH_MS });
  const fills = useTraderFills(address, { refetchInterval: FILLS_REFRESH_MS });
  const balances = useAccountBalances(address);
  const state = account.data;
  const pending = account.status === "pending";
  const { dexStates } = balances;
  const positions = useMemo(() => collectPositions(state, dexStates), [state, dexStates]);
  const accounts = perpAccounts(state, dexStates);
  const builderUsdc = builderDexWithUsdc(accounts);
  const perpsUsd = accounts.reduce((sum, entry) => sum + entry.accountValue, 0);
  const marginUsed = accounts.reduce((sum, entry) => sum + entry.marginUsed, 0);
  const hasSpot = (balances.spot.data ?? []).some((balance) => balance.total > 0);
  // Orders use the main perps USDC only. Both notes are about trading, so mainnet hides them.
  const showTransferNote =
    TRADING_ENABLED && state !== undefined && state.withdrawable < 0.01 && builderUsdc !== null;
  const showNoFunds =
    TRADING_ENABLED &&
    state !== undefined &&
    !isLoadingBalances(balances) &&
    perpsUsd < DUST_ACCOUNT_VALUE &&
    !hasSpot;

  return (
    <section
      aria-labelledby="wallet-account-title"
      data-testid="wallet-account"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Blockie address={address} size={32} />
          <div className="min-w-0 flex-1">
            <h2 id="wallet-account-title" className="text-sm font-semibold text-foreground">
              {COPY.title}
            </h2>
            <div className="flex min-w-0 items-center gap-1">
              <span
                data-testid="wallet-account-address"
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
                  data-testid="wallet-explorer-link"
                >
                  <ExternalLinkIcon aria-hidden="true" />
                </a>
              </Button>
            </div>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <a
            href={`${NETWORK_URLS[OTHER_NETWORK]}/trader/${address}`}
            data-testid="open-on-other-network-link"
          >
            Open on {networkLabel(OTHER_NETWORK)}
            <ArrowUpRightIcon aria-hidden="true" />
          </a>
        </Button>
      </div>

      {account.status === "error" ? (
        <div className="rounded-lg border">
          <ErrorState
            title={COPY.errorTitle}
            description={COPY.errorDescription}
            onRetry={() => void account.refetch()}
          />
        </div>
      ) : (
        <dl data-testid="wallet-stats" className={STAT_GRID}>
          <AccountValueStat balances={balances} />
          {/* Testnet frames this cell for orders ("USDC available"); mainnet only reads. */}
          <Stat label={TRADING_ENABLED ? "USDC available" : "Withdrawable"} loading={pending}>
            {state ? (
              <>
                <StatValue>
                  <span data-testid="wallet-withdrawable">{formatUsd(state.withdrawable)}</span>
                </StatValue>
                <StatNote>
                  {builderUsdc && showTransferNote
                    ? `${formatUsd(builderUsdc.withdrawable, { compact: true })} in ${builderUsdc.dex}`
                    : TRADING_ENABLED
                      ? "Perps, withdrawable"
                      : "Main perps account"}
                </StatNote>
              </>
            ) : null}
          </Stat>
          <Stat label="Margin used" loading={pending}>
            {state ? (
              <>
                <StatValue>{formatUsd(marginUsed)}</StatValue>
                <StatNote>
                  {positions.length} open {positions.length === 1 ? "position" : "positions"}
                </StatNote>
              </>
            ) : null}
          </Stat>
          <Stat label="Unrealized PnL" loading={pending}>
            {state ? <LivePnl positions={positions} /> : null}
          </Stat>
        </dl>
      )}

      {showTransferNote && builderUsdc?.dex ? (
        <p
          data-testid="testnet-transfer-note"
          className="rounded-lg border border-brand/40 bg-brand-dim px-3 py-2 text-xs text-foreground"
        >
          <BuilderUsdcNote dex={builderUsdc.dex} />
        </p>
      ) : null}

      {showNoFunds ? (
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
        positions={state ? positions : undefined}
        status={account.status}
        onRetry={() => void account.refetch()}
        title={COPY.positionsTitle}
        titleId="wallet-positions-title"
        showCopy={false}
        emptyTitle={COPY.positionsEmptyTitle}
        emptyDescription={COPY.positionsEmptyDescription}
      />
      <BalancesPanel
        balances={balances}
        title={COPY.balancesTitle}
        titleId="wallet-balances-title"
      />
      <RecentFills
        fills={fills.data}
        status={fills.status}
        onRetry={() => void fills.refetch()}
        title={COPY.fillsTitle}
        titleId="wallet-fills-title"
        emptyTitle={COPY.fillsEmptyTitle}
        emptyDescription={COPY.fillsEmptyDescription}
        className="max-h-[480px]"
      />
    </section>
  );
}

/** Re-renders on every tick of a position coin, so it stays a small leaf. */
function LivePnl({ positions }: { positions: readonly AccountPosition[] }) {
  const pnl = useLiveUnrealizedPnl(positions);
  return (
    <>
      <StatValue className={signTone(pnl)}>
        <span data-testid="wallet-unrealized-pnl">{formatUsd(pnl, { signed: true })}</span>
      </StatValue>
      <StatNote>At live mids</StatNote>
    </>
  );
}
