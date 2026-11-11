"use client";

import { useSyncExternalStore } from "react";

import { NETWORK } from "@/lib/network";
import {
  clampMaxOrderUsd,
  defaultTradingSettings,
  parseTradingSettings,
  tradingSettingsKey,
  type TradingSettings,
} from "@/lib/trading/settings";

import { createLocalStore } from "./createLocalStore";

const store = createLocalStore<TradingSettings>(
  tradingSettingsKey(NETWORK),
  (raw) => parseTradingSettings(raw, NETWORK),
  defaultTradingSettings(NETWORK),
);

/** The current settings, outside React (the order hook reads the cap at send time). */
export function readTradingSettings(): TradingSettings {
  return store.getSnapshot();
}

/** The trading settings of this build's network, kept in this browser. */
export function useTradingSettings(): {
  settings: TradingSettings;
  setMaxOrderUsd: (value: number) => void;
} {
  const settings = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  return {
    settings,
    setMaxOrderUsd: (value) =>
      store.update((current) => {
        const maxOrderUsd = clampMaxOrderUsd(value, NETWORK);
        return maxOrderUsd === current.maxOrderUsd ? current : { ...current, maxOrderUsd };
      }),
  };
}
