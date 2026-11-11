"use client";

import { useCallback, useSyncExternalStore } from "react";

import { useMidsStore } from "@/components/providers/MidsSourceProvider";
import { totalUnrealizedPnl } from "@/lib/calc/positions";
import type { Position } from "@/lib/hyperliquid/schemas";

const NO_POSITIONS: readonly Position[] = [];

/**
 * The live sum of unrealized PnL over the given positions. It listens only
 * to the coins of these positions, in the store of the nearest
 * MidsSourceProvider (the app-wide mainnet store by default). The snapshot is a number, so React
 * re-renders only when the sum changes.
 */
export function useLiveUnrealizedPnl(positions: readonly Position[] | undefined): number {
  const list = positions ?? NO_POSITIONS;
  const midsStore = useMidsStore();
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribes = [...new Set(list.map((position) => position.coin))].map((coin) =>
        midsStore.subscribe(coin, listener),
      );
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe();
      };
    },
    [list, midsStore],
  );
  const getSnapshot = useCallback(
    () => totalUnrealizedPnl(list, (coin) => midsStore.get(coin)),
    [list, midsStore],
  );
  const getServerSnapshot = useCallback(() => totalUnrealizedPnl(list, () => undefined), [list]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
