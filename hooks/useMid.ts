"use client";

import { useCallback, useSyncExternalStore } from "react";

import { midsStore } from "@/lib/hyperliquid/mids";

/** The live mid price of one perp coin, or undefined before the first tick. */
export function useMid(coin: string): number | undefined {
  const subscribe = useCallback(
    (listener: () => void) => midsStore.subscribe(coin, listener),
    [coin],
  );
  const getSnapshot = useCallback(() => midsStore.get(coin), [coin]);
  return useSyncExternalStore(subscribe, getSnapshot, () => undefined);
}
