"use client";

import { WalletIcon } from "lucide-react";
import { useConnection, useDisconnect } from "wagmi";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { shortAddress } from "@/lib/format";

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
 */
export default function WalletButton() {
  const connection = useConnection();
  const disconnect = useDisconnect();
  const address = connection.address;

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
    <Popover>
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 w-full"
          onClick={() => disconnect.mutate()}
        >
          Disconnect
        </Button>
      </PopoverContent>
    </Popover>
  );
}
