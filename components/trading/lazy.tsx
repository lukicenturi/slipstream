"use client";

import dynamic from "next/dynamic";

import { SkeletonRows } from "@/components/shared/States";

/*
 * Wallet and trading components in their own chunks. The wallet button
 * shows in every build (read-only unless trading is on). The trading sheet
 * form shows only in a trading build, so a read-only build never downloads
 * the exchange SDK.
 */

export const LazyWalletButton = dynamic(() => import("./WalletButton"), {
  ssr: false,
  loading: () => <span aria-hidden="true" className="block h-7 w-7 shrink-0 sm:w-32" />,
});

export const LazyTradingCopyTradeForm = dynamic(() => import("./TradingCopyTradeForm"), {
  ssr: false,
  loading: () => <SkeletonRows rows={8} label="Loading trading" />,
});
