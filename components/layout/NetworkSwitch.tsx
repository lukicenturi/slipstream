"use client";

import { Suspense, type ReactNode } from "react";

import { useNetworkSwitchTarget } from "@/hooks/useNetworkSwitchTarget";
import {
  NETWORK,
  NETWORK_URLS,
  networkLabel,
  networkSwitchTarget,
  type NetworkSwitchTarget,
} from "@/lib/trading/config";
import { cn } from "@/lib/utils";

/*
 * The network switch: a link to the other deployment (mainnet read-only,
 * testnet with trading). It does not change the network of this app.
 * The link keeps the current path when both hosts have it. The URL hooks
 * need a Suspense boundary (cacheComponents); the fallback links to the
 * other host's home page.
 */

const FALLBACK_TARGET: NetworkSwitchTarget = networkSwitchTarget(NETWORK, NETWORK_URLS, "/");

const SHORT_CODE = { mainnet: "MN", testnet: "TN" } as const;

function NetworkPill({ target, className }: { target: NetworkSwitchTarget; className?: string }) {
  const current = networkLabel(NETWORK);
  const title = `Switch to ${target.label}`;
  // The name starts with the visible word (WCAG 2.5.3), then says what the link does.
  const label = `${current}, switch to ${target.label}`;
  return (
    <a
      href={target.href}
      title={title}
      aria-label={label}
      data-testid="network-switch"
      data-network={NETWORK}
      className={cn(
        "h-6 shrink-0 items-center gap-1.5 rounded-sm border px-1.5 text-2xs font-medium tracking-wider whitespace-nowrap uppercase transition-colors focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring",
        NETWORK === "testnet"
          ? "border-brand/60 text-brand hover:border-brand"
          : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          NETWORK === "testnet" ? "bg-brand" : "bg-muted-foreground",
        )}
      />
      {/* Below sm, a 2-letter code keeps the header on one line at 375 px. */}
      <span aria-hidden="true" className="sm:hidden">
        {SHORT_CODE[NETWORK]}
      </span>
      <span className="max-sm:sr-only">{current}</span>
    </a>
  );
}

function NetworkPillFromUrl({ className }: { className?: string }) {
  const target = useNetworkSwitchTarget();
  return <NetworkPill target={target} className={className} />;
}

/** The header pill. Pass the display classes (for example `hidden sm:inline-flex`). */
export function NetworkSwitch({ className }: { className?: string }) {
  return (
    <Suspense fallback={<NetworkPill target={FALLBACK_TARGET} className={className} />}>
      <NetworkPillFromUrl className={className} />
    </Suspense>
  );
}

function SwitchAnchor({
  target,
  className,
  children,
}: {
  target: NetworkSwitchTarget;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a href={target.href} data-testid="network-switch-link" className={className}>
      {children}
    </a>
  );
}

function SwitchAnchorFromUrl({ className, children }: { className?: string; children: ReactNode }) {
  const target = useNetworkSwitchTarget();
  return (
    <SwitchAnchor target={target} className={className}>
      {children}
    </SwitchAnchor>
  );
}

/** An inline text link to the other host (the footer uses it). */
export function NetworkSwitchLink({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <SwitchAnchor target={FALLBACK_TARGET} className={className}>
          {children}
        </SwitchAnchor>
      }
    >
      <SwitchAnchorFromUrl className={className}>{children}</SwitchAnchorFromUrl>
    </Suspense>
  );
}
