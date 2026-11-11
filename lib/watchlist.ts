import { z } from "zod";

import { normalizeAddress } from "@/lib/address";

/*
 * Pure helpers for the watchlist. The list is a JSON array of lower-case
 * addresses in localStorage. hooks/useWatchlist.ts does the storage work.
 */

export const WATCHLIST_STORAGE_KEY = "slipstream.watchlist";

const storedSchema = z.array(z.unknown());

/**
 * Parse the stored value. Bad JSON or a value that is not an array gives an
 * empty list. Entries that are not addresses are dropped; duplicates are removed.
 */
export function parseWatchlist(raw: string | null): string[] {
  if (raw === null) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const parsed = storedSchema.safeParse(json);
  if (!parsed.success) return [];
  const result: string[] = [];
  for (const entry of parsed.data) {
    const address = typeof entry === "string" ? normalizeAddress(entry) : null;
    if (address && !result.includes(address)) result.push(address);
  }
  return result;
}

/** Add or remove an address. New addresses go to the end. Returns a new list. */
export function toggleWatchlist(list: readonly string[], address: string): string[] {
  const lower = address.toLowerCase();
  return list.includes(lower) ? list.filter((entry) => entry !== lower) : [...list, lower];
}
