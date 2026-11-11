"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { CopyTradeProvider } from "@/components/copy-trade/CopyTradeProvider";
import { MidsFeeder } from "@/components/providers/MidsFeeder";
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
      <TooltipProvider>
        <MidsFeeder />
        <CopyTradeProvider>{children}</CopyTradeProvider>
        <Toaster position="bottom-center" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
