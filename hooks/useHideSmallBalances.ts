"use client";

import { useSyncExternalStore } from "react";

import { createLocalStore } from "./createLocalStore";

export const HIDE_SMALL_BALANCES_KEY = "slipstream.hideSmallBalances";

/** On by default. Only the stored value false turns it off. */
function parseHideSmall(raw: string | null): boolean {
  return raw !== "false";
}

const store = createLocalStore<boolean>(HIDE_SMALL_BALANCES_KEY, parseHideSmall, true);

/** The "Hide small balances" switch of the Balances panel, kept in this browser. */
export function useHideSmallBalances(): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return [value, (next) => store.update(() => next)];
}
