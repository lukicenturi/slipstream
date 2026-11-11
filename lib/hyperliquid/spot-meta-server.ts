import "server-only";

import { unstable_cache } from "next/cache";

import { HL, NETWORK } from "@/lib/network";

import type { SpotTokenMap } from "./schemas";
import { buildSpotTokenMap } from "./spot-meta-trim";

/*
 * Server-side spot metadata. The raw spotMeta is about 140 KB on mainnet
 * and 440 KB on testnet, so the browser never downloads it. We fetch it for
 * this build's network, trim it to a token map, and cache only the map.
 *
 * Two cache layers, as for the leaderboard:
 * 1. unstable_cache (1 h) in the Next.js data cache.
 * 2. A module-level memory cache with a 1 h TTL.
 * Both keys hold the network.
 */

const CACHE_SECONDS = 3600;
const MEMORY_TTL_MS = CACHE_SECONDS * 1000;
const DOWNLOAD_TIMEOUT_MS = 15_000;

export class SpotMetaUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SpotMetaUnavailableError";
  }
}

async function downloadAndTrim(): Promise<SpotTokenMap> {
  const response = await fetch(HL.infoUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "spotMeta" }),
    cache: "no-store",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new SpotMetaUnavailableError(`spotMeta request failed: HTTP ${response.status}`);
  }
  const raw: unknown = await response.json();
  return buildSpotTokenMap(raw, Date.now());
}

const cachedDownload = unstable_cache(downloadAndTrim, ["spot-token-map", NETWORK], {
  revalidate: CACHE_SECONDS,
});

let memory: { network: typeof NETWORK; data: SpotTokenMap; fetchedAt: number } | null = null;
let inFlight: Promise<SpotTokenMap> | null = null;

/**
 * Return the spot token map. When a refresh fails and an older map exists,
 * return the older map. When no map exists, throw SpotMetaUnavailableError.
 */
export async function getSpotTokenMapServer(): Promise<SpotTokenMap> {
  const now = Date.now();
  const cached = memory?.network === NETWORK ? memory : null;
  if (cached && now - cached.fetchedAt < MEMORY_TTL_MS) return cached.data;

  inFlight ??= cachedDownload().finally(() => {
    inFlight = null;
  });

  try {
    const data = await inFlight;
    memory = { network: NETWORK, data, fetchedAt: Date.now() };
    return data;
  } catch (error) {
    if (cached) return cached.data;
    throw new SpotMetaUnavailableError("The spot metadata is not available", { cause: error });
  }
}
