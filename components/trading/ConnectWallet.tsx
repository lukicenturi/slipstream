"use client";

import { Loader2Icon, WalletIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useConnect, useConnectors, type Connector } from "wagmi";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NETWORK, TRADING_ENABLED } from "@/lib/trading/config";
import { isUserRejection } from "@/lib/trading/errors";
import { cn } from "@/lib/utils";

/** Injected wallets first, WalletConnect last. */
function connectorRank(connector: Connector): number {
  if (connector.id === "injected") return 0;
  if (connector.type === "injected") return 1;
  if (connector.type === "walletConnect") return 3;
  return 2;
}

function connectErrorText(error: Error): string {
  if (isUserRejection(error)) return "Connection rejected.";
  if (error.name === "ProviderNotFoundError") return "No browser wallet found.";
  return "The wallet did not connect. Try again.";
}

/**
 * The wallets that the user can connect. Used in the header, the account
 * page and the trading sheet. Connecting only reads the address; it never
 * asks for a signature.
 */
export function ConnectorList({ onConnected }: { onConnected?: () => void }) {
  const connectors = useConnectors();
  const connect = useConnect();
  const sorted = [...connectors].sort((a, b) => connectorRank(a) - connectorRank(b));
  const pendingId = connect.isPending ? connect.variables?.connector : undefined;

  return (
    <div className="flex flex-col">
      <p className="px-2 pt-1 pb-1.5 text-2xs text-muted-foreground">
        {TRADING_ENABLED
          ? `Connect a wallet. Slipstream trades on Hyperliquid ${NETWORK} with an agent key.`
          : `Connect a wallet. Slipstream only reads your address on ${NETWORK}.`}
      </p>
      <ul aria-label="Wallets" className="flex flex-col">
        {sorted.map((connector) => {
          const pending =
            pendingId !== undefined &&
            typeof pendingId !== "function" &&
            pendingId.uid === connector.uid;
          return (
            <li key={connector.uid}>
              <button
                type="button"
                data-testid={`connector-${connector.id}`}
                disabled={connect.isPending}
                onClick={() => connect.mutate({ connector }, { onSuccess: () => onConnected?.() })}
                className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-xs text-foreground transition-colors hover:bg-surface-hover disabled:opacity-60"
              >
                {connector.icon ? (
                  // Wallet icons are data URIs from the wallet itself.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={connector.icon}
                    alt=""
                    aria-hidden="true"
                    className="size-4 rounded-sm"
                  />
                ) : (
                  <WalletIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate">{connector.name}</span>
                {pending ? (
                  <Loader2Icon aria-hidden="true" className="size-3.5 motion-safe:animate-spin" />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      {connect.error ? (
        <p role="alert" className="px-2 pt-1.5 pb-1 text-2xs text-short">
          {connectErrorText(connect.error)}
        </p>
      ) : null}
    </div>
  );
}

/** A trigger that opens the wallet list in a popover. */
export function ConnectWalletPopover({
  children,
  align = "end",
  side = "bottom",
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} side={side} className={cn("w-64")}>
        <ConnectorList onConnected={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
