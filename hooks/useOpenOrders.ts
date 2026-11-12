"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";

import { getFrontendOpenOrders } from "@/lib/hyperliquid/client";
import type { OpenOrder } from "@/lib/hyperliquid/schemas";

/*
 * The open orders of one account on the main perp exchange of this build's
 * network (info endpoint, read-only). The manage sheet, the open orders
 * panel and the trailing stop tracker share one cache entry per address.
 * It polls every 10 s while a reader is mounted and enabled; the trading
 * actions refetch it right after every exchange action.
 */

export const OPEN_ORDERS_REFRESH_MS = 10_000;

/** One cache entry: the orders, and the time at which their request started. */
export interface OpenOrdersSnapshot {
  orders: OpenOrder[];
  /**
   * `Date.now()` right before the request. The book can only predate this
   * time, so the tracker compares it with the time of its last change.
   */
  fetchedAt: number;
}

export function openOrdersKey(address: string | undefined) {
  return ["trader", address, "frontendOpenOrders"] as const;
}

interface OpenOrdersOptions {
  enabled?: boolean;
  refetchInterval?: number | false;
}

function openOrdersQuery(address: string | undefined, options: OpenOrdersOptions) {
  const { enabled = true, refetchInterval = OPEN_ORDERS_REFRESH_MS } = options;
  return {
    queryKey: openOrdersKey(address),
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<OpenOrdersSnapshot> => {
      // `enabled` below keeps this from running without an address.
      if (!address) throw new Error("No address");
      const fetchedAt = Date.now();
      const orders = await getFrontendOpenOrders(address, { signal });
      return { orders, fetchedAt };
    },
    enabled: enabled && address !== undefined,
    refetchInterval: enabled ? refetchInterval : false,
    staleTime: 5_000,
  } as const;
}

const selectOrders = (snapshot: OpenOrdersSnapshot): OpenOrder[] => snapshot.orders;

/** The open orders of an address. */
export function useOpenOrders(address: string | undefined, options: OpenOrdersOptions = {}) {
  return useQuery({ ...openOrdersQuery(address, options), select: selectOrders });
}

/** The open orders of an address with the start time of their request (the trailing tracker). */
export function useOpenOrdersSnapshot(
  address: string | undefined,
  options: OpenOrdersOptions = {},
) {
  return useQuery(openOrdersQuery(address, options));
}

/** The open orders of an address in the query cache, or an empty list. */
export function cachedOpenOrders(queryClient: QueryClient, address: string): OpenOrder[] {
  return queryClient.getQueryData<OpenOrdersSnapshot>(openOrdersKey(address))?.orders ?? [];
}

/** Refetch the open orders of an address now (after an exchange action). */
export function invalidateOpenOrders(
  queryClient: QueryClient,
  address: string | undefined,
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: openOrdersKey(address) });
}
