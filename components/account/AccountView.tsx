"use client";

import { TRADING_ENABLED } from "@/lib/trading/config";

import { LazyTestnetAccount } from "./lazy";
import { MyAddressSection } from "./MyAddressSection";

/**
 * The account page. Testnet build: the connected wallet's testnet account,
 * then the saved address. Read-only build: the saved address only. Both
 * read the network of the build. The page only reads; it sends no
 * exchange request.
 */
export function AccountView() {
  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-3 lg:px-6 lg:py-4">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-foreground">My account</h1>
        <p className="text-xs text-muted-foreground">
          {TRADING_ENABLED
            ? "Your testnet wallet and your saved address, with testnet data."
            : "Your saved address and its profile."}
        </p>
      </div>
      {TRADING_ENABLED ? <LazyTestnetAccount /> : null}
      <MyAddressSection title="My address" />
    </div>
  );
}
