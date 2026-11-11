"use client";

import { useSyncExternalStore } from "react";

import {
  clearMyAddress,
  MY_ADDRESS_STORAGE_KEY,
  parseMyAddress,
  setMyAddress,
  type MyAddress,
} from "@/lib/myAddress";

import { createLocalStore } from "./createLocalStore";

/** The "My address" store (`slipstream.myAddress`), shared by every reader. */
export const myAddressStore = createLocalStore<MyAddress | null>(
  MY_ADDRESS_STORAGE_KEY,
  parseMyAddress,
  null,
);

/** Save an address (and the name the user typed). Does nothing for an invalid address. */
function save(address: string, label?: string): void {
  const next = setMyAddress(address, label);
  if (next) myAddressStore.update(() => next);
}

/** Remove the saved address from this browser. */
function forget(): void {
  myAddressStore.update(clearMyAddress);
}

/** The saved address (or null) and helpers to change it. */
export function useMyAddress() {
  const myAddress = useSyncExternalStore(
    myAddressStore.subscribe,
    myAddressStore.getSnapshot,
    myAddressStore.getServerSnapshot,
  );
  return { myAddress, save, forget };
}
