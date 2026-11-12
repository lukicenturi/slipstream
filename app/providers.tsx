"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { CopyTradeProvider } from "@/components/copy-trade/CopyTradeProvider";
import { ManagePositionProvider } from "@/components/manage-position/ManagePositionProvider";
import { MidsFeeder } from "@/components/providers/MidsFeeder";
import { PushSync } from "@/components/providers/PushSync";
import { TradingTrackers } from "@/components/providers/TradingTrackers";
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
            {/* The manage sheet for your own positions (trading builds only). */}
            <ManagePositionProvider>
              {/* Live alerts for followed traders, on every page. */}
              <WatchlistTracker />
              {/* Sends the watchlist to the push Worker when push alerts are on. */}
              <PushSync />
              {/* Moves trailing stops while a tab is open (trading builds only). */}
              <TradingTrackers />
              {children}
            </ManagePositionProvider>
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
