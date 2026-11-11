"use client";

import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import type { ConnectionStatus as Status } from "@/lib/hyperliquid/ws";
import { cn } from "@/lib/utils";

const LABEL: Record<Status, string> = {
  open: "Live",
  connecting: "Connecting",
  reconnecting: "Reconnecting",
  closed: "Offline",
};

const DOT: Record<Status, string> = {
  open: "bg-long",
  connecting: "bg-brand",
  reconnecting: "bg-brand",
  closed: "bg-short",
};

/** A 6 px dot plus a word for the state of the shared socket. */
export function ConnectionStatus({ className }: { className?: string }) {
  const status = useConnectionStatus();
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="connection-status"
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground",
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT[status])} />
      {LABEL[status]}
    </span>
  );
}
