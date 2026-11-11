"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

import { WALLET_ENABLED } from "@/lib/trading/config";

// wagmi stays in its own chunk, apart from the main bundle.
const WalletWagmiProvider = dynamic(() => import("./WalletWagmiProvider"));

/**
 * Adds wallet support (wagmi) in every build. On mainnet the wallet is
 * read-only: the app reads the address and never requests a signature.
 */
export function WalletProviders({ children }: { children: ReactNode }) {
  if (!WALLET_ENABLED) return children;
  return <WalletWagmiProvider>{children}</WalletWagmiProvider>;
}
