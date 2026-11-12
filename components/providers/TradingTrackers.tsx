"use client";

import dynamic from "next/dynamic";

import { TRADING_ENABLED } from "@/lib/trading/config";

/*
 * Background trading work of a trading build: the trailing stop tracker.
 * It signs `modify` actions with the agent, so it loads in its own chunk
 * (a dynamic import) and a read-only build never renders or downloads it.
 */
const TrailingStopTracker = dynamic(() => import("./TrailingStopTracker"), { ssr: false });

/** Mount once, inside the wallet and query providers. Renders nothing visible. */
export function TradingTrackers() {
  return TRADING_ENABLED ? <TrailingStopTracker /> : null;
}
