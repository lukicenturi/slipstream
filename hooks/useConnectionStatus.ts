"use client";

import { useSyncExternalStore } from "react";

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
