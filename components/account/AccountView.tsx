"use client";

import { TRADING_ENABLED, WALLET_ENABLED } from "@/lib/trading/config";

import { LazyWalletAccount } from "./lazy";

/**
 * The account page, in both builds: the connected wallet's account on the
 * network of the build. The page only reads; it sends no exchange request.
 * On mainnet the wallet is read-only: the app reads its address and never
 * asks for a signature.
 */
export function AccountView() {
  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-3 lg:px-6 lg:py-4">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-foreground">My account</h1>
        <p className="text-xs text-muted-foreground">
          {TRADING_ENABLED
            ? "Your testnet wallet's account, with testnet data."
            : "Your wallet's account, read-only."}
        </p>
      </div>
      {WALLET_ENABLED ? <LazyWalletAccount /> : null}
    </div>
  );
}
