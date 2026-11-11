"use client";

import { useSyncExternalStore } from "react";

function subscribe(): () => void {
  return () => {};
}

/**
 * False on the server and during hydration, true after. A view that reads
 * localStorage uses it to show a skeleton instead of a wrong empty state.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
