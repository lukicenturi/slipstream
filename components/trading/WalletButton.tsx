"use client";

import { WalletIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useConnection, useDisconnect } from "wagmi";

import { Blockie } from "@/components/shared/Blockie";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  isLoadingBalances,
  useAccountBalances,
  useLiveAccountSummary,
} from "@/hooks/useAccountBalances";
import { ACCOUNT_REFRESH_MS, useTraderState } from "@/hooks/useTrader";
import { EMPTY_VALUE, formatUsd, shortAddress } from "@/lib/format";
import { NETWORK, TRADING_ENABLED } from "@/lib/trading/config";

import { ConnectWalletPopover } from "./ConnectWallet";
import { NetworkBadge } from "./NetworkBadge";

/**
 * The header wallet control, in every build. Below `sm` it is an icon
 * button, so the search keeps its room at 375 px; the popover shows the
 * address. From `sm` up it shows the short address. The popover shows the
 * balance (loaded while it is open) and a link to the account page.
 *
 * It never signs and imports no exchange code (lib/wallet-guard.test.ts
 * checks this). In a read-only build it reads the address only. In a
 * trading build (mainnet or testnet) the popover shows the trading framing:
 * the network badge and "USDC available". The header's network switch
 * already names the network, so the badge shows only in the popover.
 */
export default function WalletButton() {
  const connection = useConnection();
  const disconnect = useDisconnect();
  const address = connection.address;
  const [open, setOpen] = useState(false);

  if (!address) {
    return (
      <ConnectWalletPopover>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="wallet-button"
          aria-label="Connect wallet"
          className="w-7 shrink-0 px-0 sm:w-auto sm:px-2.5"
        >
          <WalletIcon aria-hidden="true" />
          <span className="hidden sm:inline">Connect wallet</span>
        </Button>
      </ConnectWalletPopover>
    );
  }

  const owner = address.toLowerCase();
  const short = shortAddress(owner);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="wallet-button"
          data-address={owner}
          aria-label={
            TRADING_ENABLED ? `Wallet ${short} on ${NETWORK}` : `Wallet ${short}, read-only`
          }
          className="w-7 shrink-0 px-0 sm:w-auto sm:px-2"
        >
          <WalletIcon aria-hidden="true" className="text-brand sm:hidden" />
          <Blockie address={address} className="max-sm:hidden" />
          <span className="hidden font-mono sm:inline">{short}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-foreground">{short}</span>
          {TRADING_ENABLED ? <NetworkBadge network={NETWORK} /> : null}
        </div>
        <div className="mt-1 flex items-start gap-1.5">
          <Blockie address={address} />
          <p className="min-w-0 font-mono text-2xs break-all text-faint">{owner}</p>
        </div>
        {/* The content mounts only while the popover is open, so these queries run only then. */}
        {TRADING_ENABLED ? <TradingBalance owner={owner} /> : <ReadOnlyBalance owner={owner} />}
        <Button asChild variant="outline" size="sm" className="mt-2 w-full">
          <Link href="/account" onClick={() => setOpen(false)} data-testid="wallet-account-link">
            My account
          </Link>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 w-full"
          onClick={() => disconnect.mutate()}
        >
          Disconnect
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** A trading build: the main perps USDC that orders can use, and its account value. */
function TradingBalance({ owner }: { owner: string }) {
  // The profile's account query, so the popover, the sheet and /account share it.
  const account = useTraderState(owner, { refetchInterval: ACCOUNT_REFRESH_MS });
  return (
    <dl data-testid="wallet-balance" className="mt-2 flex flex-col gap-1 border-t pt-2 text-xs">
      <BalanceLine
        label="USDC available"
        value={account.data?.withdrawable}
        status={account.status}
      />
      <BalanceLine
        label="Account value"
        value={account.data?.accountValue}
        status={account.status}
      />
    </dl>
  );
}

/**
 * A read-only build: the account value over every perp exchange and spot, the same
 * total as the profile and /account (shared queries), and the read-only note.
 */
function ReadOnlyBalance({ owner }: { owner: string }) {
  const balances = useAccountBalances(owner);
  const { summary } = useLiveAccountSummary(balances);
  const status = isLoadingBalances(balances) ? "pending" : balances.main.status;
  return (
    <>
      <dl data-testid="wallet-balance" className="mt-2 flex flex-col gap-1 border-t pt-2 text-xs">
        <BalanceLine label="Account value" value={summary.totalUsd} status={status} />
      </dl>
      <p data-testid="wallet-read-only-note" className="mt-2 text-2xs text-muted-foreground">
        Read-only: Slipstream never asks for a signature on {NETWORK}.
      </p>
    </>
  );
}

/** One balance line: a skeleton while it loads, "—" when it failed. */
function BalanceLine({
  label,
  value,
  status,
}: {
  label: string;
  value: number | undefined;
  status: "pending" | "error" | "success";
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-foreground">
        {status === "pending" ? (
          <Skeleton className="h-3 w-14" />
        ) : status === "error" || value === undefined ? (
          EMPTY_VALUE
        ) : (
          formatUsd(value)
        )}
      </dd>
    </div>
  );
}
