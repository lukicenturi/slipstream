"use client";

import dynamic from "next/dynamic";

import { SkeletonRows } from "@/components/shared/States";

/*
 * The connected wallet's account section in its own chunk, like the wallet
 * button. It shows in every build (read-only on mainnet).
 */
export const LazyWalletAccount = dynamic(() => import("./WalletAccount"), {
  ssr: false,
  loading: () => (
    <div className="rounded-lg border">
      <SkeletonRows rows={4} label="Loading the wallet account" />
    </div>
  ),
});
