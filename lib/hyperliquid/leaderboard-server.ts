import "server-only";

import { unstable_cache } from "next/cache";

import { trimLeaderboard } from "./leaderboard-trim";
import type { LeaderboardResponse } from "./schemas";

/*
 * Server-side leaderboard access. The raw file is about 39 MB, so the
 * browser never sees it. We download it, trim it to the top 100 rows,
 * and cache only the trimmed result.
 *
 * Two cache layers:
 * 1. unstable_cache keeps the trimmed result in the Next.js data cache
 *    (shared across instances where the platform supports it).
 * 2. A module-level memory cache with a 15 min TTL, so dev mode and warm
 *    instances do not download the file again on every request.
 */

const RAW_LEADERBOARD_URL = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";
const CACHE_SECONDS = 900;
const MEMORY_TTL_MS = CACHE_SECONDS * 1000;
const DOWNLOAD_TIMEOUT_MS = 45_000;

export class LeaderboardUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LeaderboardUnavailableError";
  }
}

async function downloadAndTrim(): Promise<LeaderboardResponse> {
  // no-store: the raw file is far above the 2 MB data-cache limit.
  const response = await fetch(RAW_LEADERBOARD_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new LeaderboardUnavailableError(`Leaderboard download failed: HTTP ${response.status}`);
  }
  const raw: unknown = await response.json();
  return trimLeaderboard(raw, Date.now());
}

const cachedDownload = unstable_cache(downloadAndTrim, ["leaderboard-top100"], {
  revalidate: CACHE_SECONDS,
});

let memory: { data: LeaderboardResponse; fetchedAt: number } | null = null;
let inFlight: Promise<LeaderboardResponse> | null = null;

/**
 * Return the top 100 leaderboard rows.
 * When a refresh fails and older data exists, return the older data with
 * `stale: true`. When no data exists, throw LeaderboardUnavailableError.
 */
export async function getTopLeaderboard(): Promise<LeaderboardResponse> {
  const now = Date.now();
  if (memory && now - memory.fetchedAt < MEMORY_TTL_MS) return memory.data;

  // One download at a time, even when many requests arrive together.
  inFlight ??= cachedDownload().finally(() => {
    inFlight = null;
  });

  try {
    const data = await inFlight;
    memory = { data, fetchedAt: Date.now() };
    return data;
  } catch (error) {
    if (memory) return { ...memory.data, stale: true };
    throw new LeaderboardUnavailableError("The leaderboard is not available", { cause: error });
  }
}
