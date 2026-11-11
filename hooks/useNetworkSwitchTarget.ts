"use client";

import { usePathname, useSearchParams } from "next/navigation";

import {
  NETWORK,
  NETWORK_URLS,
  networkSwitchTarget,
  type NetworkSwitchTarget,
} from "@/lib/trading/config";

/**
 * The link to the other network's host for the current URL. It reads
 * request data (the pathname and the search params), so the component
 * that calls it must render inside a <Suspense> boundary (cacheComponents).
 */
export function useNetworkSwitchTarget(): NetworkSwitchTarget {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  return networkSwitchTarget(NETWORK, NETWORK_URLS, query ? `${pathname}?${query}` : pathname);
}
