"use client";

import { createContext, useContext, type ReactNode } from "react";

import { midsStore, type MidsStore } from "@/lib/hyperliquid/mids";

/*
 * The mids store that `useMid` and `useLiveUnrealizedPnl` read. The
 * default is the app-wide store (mainnet, fed by the shared socket), so
 * every view outside a provider works as before. The account page wraps
 * its testnet positions in a provider with a testnet store, so the same
 * row components show testnet prices.
 */
export const MidsSourceContext = createContext<MidsStore>(midsStore);

export function MidsSourceProvider({
  store,
  children,
}: {
  store: MidsStore;
  children?: ReactNode;
}) {
  return <MidsSourceContext value={store}>{children}</MidsSourceContext>;
}

/** The mids store of the nearest provider, or the app-wide store. */
export function useMidsStore(): MidsStore {
  return useContext(MidsSourceContext);
}
