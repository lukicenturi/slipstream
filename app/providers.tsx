"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { ClosePositionProvider } from "@/components/close-position/ClosePositionProvider";
import { CopyTradeProvider } from "@/components/copy-trade/CopyTradeProvider";
import { MidsFeeder } from "@/components/providers/MidsFeeder";
import { PushSync } from "@/components/providers/PushSync";
import { WatchlistTracker } from "@/components/providers/WatchlistTracker";
import { WalletProviders } from "@/components/trading/WalletProviders";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/* wagmi in every build: read-only on mainnet, trading on testnet. */}
      <WalletProviders>
        <TooltipProvider>
          <MidsFeeder />
          <CopyTradeProvider>
            {/* The close sheet for your own positions (trading builds only). */}
            <ClosePositionProvider>
              {/* Live alerts for followed traders, on every page. */}
              <WatchlistTracker />
              {/* Sends the watchlist to the push Worker when push alerts are on. */}
              <PushSync />
              {children}
            </ClosePositionProvider>
          </CopyTradeProvider>
          {/* Toasts sit above the mobile bottom bar (the variable is 0 from lg up). */}
          <Toaster
            position="bottom-center"
            offset={{ bottom: "calc(24px + var(--bottom-nav-space))" }}
            mobileOffset={{ bottom: "calc(16px + var(--bottom-nav-space))" }}
          />
        </TooltipProvider>
      </WalletProviders>
    </QueryClientProvider>
  );
}
