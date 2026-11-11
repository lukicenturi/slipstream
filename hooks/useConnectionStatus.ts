"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { getHyperliquidSocket, type ConnectionStatus } from "@/lib/hyperliquid/ws";

function subscribe(listener: () => void): () => void {
  return getHyperliquidSocket()?.onStatus(listener) ?? (() => {});
}

function getSnapshot(): ConnectionStatus {
  return getHyperliquidSocket()?.getStatus() ?? "connecting";
}

// The app subscribes to allMids on mount, so "connecting" is the first
// real state. Using it on the server avoids a flash of "closed".
function getServerSnapshot(): ConnectionStatus {
  return "connecting";
}

/** The status of the shared WebSocket. */
export function useConnectionStatus(): ConnectionStatus {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function getDownSince(): number | null {
  return getHyperliquidSocket()?.getDownSince() ?? null;
}

function getServerDownSince(): number | null {
  return null;
}

/**
 * True when the shared socket has not been open for `thresholdMs`.
 * While the socket retries, its status stays "reconnecting", so the
 * check uses the time since it was last open, not the "closed" status.
 */
export function useConnectionLost(thresholdMs = 30_000): boolean {
  const downSince = useSyncExternalStore(subscribe, getDownSince, getServerDownSince);
  // The downSince value for which the threshold passed.
  const [expiredFor, setExpiredFor] = useState<number | null>(null);

  useEffect(() => {
    if (downSince === null) return;
    const remaining = Math.max(0, downSince + thresholdMs - Date.now());
    const timer = setTimeout(() => setExpiredFor(downSince), remaining);
    return () => clearTimeout(timer);
  }, [downSince, thresholdMs]);

  return downSince !== null && expiredFor === downSince;
}

/** Drop and reopen the shared socket. Used by the Reconnect buttons. */
export function useReconnect(): () => void {
  return useCallback(() => getHyperliquidSocket()?.forceReconnect(), []);
}
