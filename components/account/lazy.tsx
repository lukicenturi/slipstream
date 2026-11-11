"use client";

import dynamic from "next/dynamic";

import { SkeletonRows } from "@/components/shared/States";

/*
 * The testnet account section in its own chunk, like the wallet button.
 * The read-only build never renders it, so it never downloads wagmi.
 */
export const LazyTestnetAccount = dynamic(() => import("./TestnetAccount"), {
  ssr: false,
  loading: () => (
    <div className="rounded-lg border">
      <SkeletonRows rows={4} label="Loading the testnet account" />
    </div>
  ),
});
