"use client";

import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";

import { createWagmiConfig } from "@/lib/trading/wagmi";

/** wagmi for every build (read-only on mainnet). It shares the app's QueryClient. */
export default function WalletWagmiProvider({ children }: { children: ReactNode }) {
  // One config per browser session (and per server request), as wagmi advises for SSR.
  const [config] = useState(createWagmiConfig);
  return <WagmiProvider config={config}>{children}</WagmiProvider>;
}
