"use client";

import { useSyncExternalStore } from "react";

import { parseRiskAck, RISK_ACK_KEY, type RiskAck } from "@/lib/trading/riskAck";

import { createLocalStore } from "./createLocalStore";

const store = createLocalStore<RiskAck | null>(RISK_ACK_KEY, parseRiskAck, null);

/** The stored mainnet risk acknowledgement (null when none), and a function to store one now. */
export function useRiskAck(): { value: RiskAck | null; acknowledge: () => void } {
  const value = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return {
    value,
    acknowledge: () => store.update(() => ({ at: Date.now() })),
  };
}
