"use client";

import { useCallback, useSyncExternalStore } from "react";

import { useMidsStore } from "@/components/providers/MidsSourceProvider";

/**
 * The live mid price of one perp coin, or undefined before the first tick.
 * It reads the store of the nearest MidsSourceProvider (the app-wide
 * mainnet store by default).
 */
export function useMid(coin: string): number | undefined {
  const store = useMidsStore();
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(coin, listener),
    [store, coin],
  );
  const getSnapshot = useCallback(() => store.get(coin), [store, coin]);
  return useSyncExternalStore(subscribe, getSnapshot, () => undefined);
}
