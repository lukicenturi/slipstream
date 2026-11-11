"use client";

import { WalletIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useConnection, useDisconnect } from "wagmi";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useTestnetAccount } from "@/hooks/useTestnetAccount";
import { EMPTY_VALUE, formatUsd, shortAddress } from "@/lib/format";

import { ConnectWalletPopover } from "./ConnectWallet";

export function TestnetBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={className ?? "border-brand/60 text-brand"}>
      Testnet
    </Badge>
  );
}

/**
 * The header wallet control of the testnet build. Below `sm` it is an icon
 * button, so the search keeps its room at 375 px; the popover shows the
 * address. From `sm` up it shows the short address. The header's network
 * switch already says "Testnet", so the Testnet badge shows only in the popover.
 * The popover also shows the testnet balance (loaded while it is open) and
 * a link to the account page.
 */
export default function WalletButton() {
  const connection = useConnection();
  const disconnect = useDisconnect();
  const address = connection.address;
  const [open, setOpen] = useState(false);
  const account = useTestnetAccount(address?.toLowerCase(), open);

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

  const short = shortAddress(address.toLowerCase());
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="wallet-button"
          data-address={address.toLowerCase()}
          aria-label={`Wallet ${short} on testnet`}
          className="w-7 shrink-0 px-0 sm:w-auto sm:px-2"
        >
          <WalletIcon aria-hidden="true" className="text-brand sm:hidden" />
          <span className="hidden font-mono sm:inline">{short}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-foreground">{short}</span>
          <TestnetBadge />
        </div>
        <p className="mt-1 font-mono text-2xs break-all text-faint">{address.toLowerCase()}</p>
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
