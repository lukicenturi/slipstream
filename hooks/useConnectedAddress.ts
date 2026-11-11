"use client";

import { useConnection } from "wagmi";

/**
 * The connected wallet's lower-case address, or undefined. Every build
 * mounts the wallet provider (WalletProviders), so this works on any page.
 * It only reads the address; it never asks the wallet to sign.
 */
export function useConnectedAddress(): string | undefined {
  return useConnection().address?.toLowerCase();
}
