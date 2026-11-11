"use client";

import dynamic from "next/dynamic";

import { SkeletonRows } from "@/components/shared/States";

/*
 * Testnet-only components in their own chunks. The read-only build never
 * renders them, so it never downloads wagmi or the exchange SDK.
 */

export const LazyWalletButton = dynamic(() => import("./WalletButton"), {
  ssr: false,
  loading: () => <span aria-hidden="true" className="block h-7 w-7 shrink-0 sm:w-32" />,
});

export const LazyTestnetCopyTradeForm = dynamic(() => import("./TestnetCopyTradeForm"), {
  ssr: false,
  loading: () => <SkeletonRows rows={8} label="Loading testnet trading" />,
});
