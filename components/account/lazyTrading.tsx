"use client";

import dynamic from "next/dynamic";

import { SkeletonRows } from "@/components/shared/States";

/*
 * The open orders panel signs cancels with the agent, so it loads in its
 * own chunk. Render it only in a trading build (TRADING_ENABLED). The
 * wallet account imports this file, and lib/wallet-guard.test.ts does not
 * follow the dynamic import.
 */
export const LazyOpenOrdersPanel = dynamic(() => import("./OpenOrdersPanel"), {
  ssr: false,
  loading: () => (
    <div className="rounded-lg border">
      <SkeletonRows rows={2} label="Loading open orders" />
    </div>
  ),
});
