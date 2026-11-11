"use client";

import dynamic from "next/dynamic";

import { SkeletonRows } from "@/components/shared/States";

/*
 * Wallet and trading components in their own chunks. The wallet button
 * shows in every build (read-only on mainnet). The testnet sheet form shows
 * only in the testnet build, so the mainnet build never downloads the
 * exchange SDK.
 */

export const LazyWalletButton = dynamic(() => import("./WalletButton"), {
  ssr: false,
  loading: () => <span aria-hidden="true" className="block h-7 w-7 shrink-0 sm:w-32" />,
});

export const LazyTestnetCopyTradeForm = dynamic(() => import("./TestnetCopyTradeForm"), {
  ssr: false,
  loading: () => <SkeletonRows rows={8} label="Loading testnet trading" />,
});
