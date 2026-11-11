"use client";

import { useHyperliquidWs } from "@/hooks/useHyperliquidWs";
import { midsStore } from "@/lib/hyperliquid/mids";
import type { Subscription } from "@/lib/hyperliquid/ws";

const ALL_MIDS = { type: "allMids" } as const satisfies Subscription;

/** Feeds the mids store from the shared socket. Mount it once. */
export function MidsFeeder() {
  useHyperliquidWs(ALL_MIDS, (message) => midsStore.ingest(message.mids));
  return null;
}
