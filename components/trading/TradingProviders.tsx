"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

import { TRADING_ENABLED } from "@/lib/trading/config";

// A separate chunk: the read-only build never loads wagmi.
const TestnetWagmiProvider = dynamic(() => import("./TestnetWagmiProvider"));

/** Adds wallet support in a testnet build. In the read-only build it renders its children only. */
export function TradingProviders({ children }: { children: ReactNode }) {
  if (!TRADING_ENABLED) return children;
  return <TestnetWagmiProvider>{children}</TestnetWagmiProvider>;
}
