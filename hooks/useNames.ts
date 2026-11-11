"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo } from "react";

import { getLeaderboard } from "@/lib/hyperliquid/client";
import type { LeaderboardResponse } from "@/lib/hyperliquid/schemas";
import { pickDisplayName, uniqueAddresses, type DisplayName } from "@/lib/names";
import { lookupNames } from "@/lib/names/client";
import { MAX_NAME_LOOKUP, type TraderNames } from "@/lib/names/schemas";

/** Lower-case address -> its .hl and ENS primary names. */
export type NameMap = ReadonlyMap<string, TraderNames>;

const EMPTY_NAMES: NameMap = new Map();

/**
 * Reverse names for a list of addresses, through /api/names.
 * Names are an enhancement: the map is empty while it loads and on error,
 * so a provider failure never blocks a view.
 */
export function useNames(addresses: readonly string[]): NameMap {
  const key = uniqueAddresses(addresses, MAX_NAME_LOOKUP);
  const query = useQuery({
    queryKey: ["names", key],
    queryFn: ({ signal }) => lookupNames(key, { signal }),
    enabled: key.length > 0,
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
    retry: 1,
  });
  const names = query.data?.names;
  return useMemo(() => (names ? new Map(Object.entries(names)) : EMPTY_NAMES), [names]);
}

/**
 * Hyperliquid display names from the leaderboard query, when it is already
 * in the cache. It never fetches the leaderboard.
 */
export function useCachedDisplayNames(): ReadonlyMap<string, string> {
  const { data } = useQuery({
    queryKey: ["leaderboard"],
    queryFn: ({ signal }) => getLeaderboard({ signal }),
    enabled: false,
  });
  const rows = data?.rows;
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows ?? []) if (row.displayName) map.set(row.address, row.displayName);
    return map;
  }, [rows]);
}

/**
 * A label function for any address: the cached Hyperliquid display name,
 * then the names from /api/names for `addresses`, then the short address.
 */
export function useTraderLabels(addresses: readonly string[]): (address: string) => DisplayName {
  const names = useNames(addresses);
  const displayNames = useCachedDisplayNames();
  return useCallback(
    (address: string) => {
      const lower = address.toLowerCase();
      const entry = names.get(lower);
      return pickDisplayName({
        displayName: displayNames.get(lower),
        hlName: entry?.hl,
        ensName: entry?.ens,
        address: lower,
      });
    },
    [names, displayNames],
  );
}

/** The names of the home page addresses. NamesProvider fills it. */
export const NamesContext = createContext<NameMap>(EMPTY_NAMES);

/**
 * The label for one trader, with the names from the nearest NamesProvider.
 * Outside a provider it falls back to the display name or the short address.
 */
export function useDisplayName(address: string, displayName?: string | null): DisplayName {
  const names = useContext(NamesContext).get(address.toLowerCase());
  return pickDisplayName({ displayName, hlName: names?.hl, ensName: names?.ens, address });
}

/**
 * The label for the profile header. It reads the Hyperliquid display name
 * from the leaderboard query when it is already in the cache (it never
 * fetches the leaderboard), then asks /api/names for this one address.
 */
export function useProfileDisplayName(address: string): DisplayName {
  const lower = address.toLowerCase();
  const { data: displayName } = useQuery({
    queryKey: ["leaderboard"],
    queryFn: ({ signal }) => getLeaderboard({ signal }),
    enabled: false,
    select: (data: LeaderboardResponse) =>
      data.rows.find((row) => row.address === lower)?.displayName ?? null,
  });
  const names = useNames([lower]).get(lower);
  return pickDisplayName({ displayName, hlName: names?.hl, ensName: names?.ens, address: lower });
}
