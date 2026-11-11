import "server-only";

import type { z } from "zod";

import {
  forwardCache,
  FORWARD_HIT_TTL_MS,
  FORWARD_MISS_TTL_MS,
  reverseCache,
  REVERSE_TTL_MS,
} from "./cache";
import { NameServiceError, type NameLookup } from "./lookup";
import { hlBulkPrimaryNamesSchema, hlResolveSchema, ZERO_ADDRESS } from "./schemas";

/*
 * Hyperliquid Names (.hl on HyperEVM) through its REST API. Read calls only.
 * The key comes from HLNAMES_API_KEY. Without it, we use the public
 * integration key that the provider publishes in its docs and its
 * open-source MetaMask snap.
 */

const API_URL = "https://api.hlnames.xyz";
const PUBLIC_API_KEY = "CPEPKMI-HUSUX6I-SE2DHEA-YYWFG5Y";
const REQUEST_TIMEOUT_MS = 10_000;
/** Addresses per bulk primary-name request. */
const BULK_CHUNK_SIZE = 100;

function headers(json = false): HeadersInit {
  const base: Record<string, string> = {
    "X-API-Key": process.env.HLNAMES_API_KEY || PUBLIC_API_KEY,
  };
  if (json) base["content-type"] = "application/json";
  return base;
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${API_URL}${path}`, {
      ...init,
      // We cache parsed results in memory; the raw responses are not cached.
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new NameServiceError(`HL Names request ${path} failed`, { cause: error });
  }
}

async function parseBody<S extends z.ZodType>(
  response: Response,
  path: string,
  schema: S,
): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new NameServiceError(`HL Names response for ${path} is not JSON`, { cause: error });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new NameServiceError(`HL Names response for ${path} does not match the schema`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/**
 * Resolve a `.hl` name to a lower-case address.
 * Returns null for an unknown name (404), a name the API rejects (422),
 * and a name without an address (the zero address).
 * Throws NameServiceError for other failures.
 */
export async function resolveHlName(name: string): Promise<string | null> {
  const key = `hl:${name}`;
  const cached = forwardCache.get(key);
  if (cached) return cached.value;

  const path = `/resolve/address/${encodeURIComponent(name)}`;
  const response = await send(path, { headers: headers() });

  let result: string | null;
  if (response.status === 404 || response.status === 422) {
    result = null;
  } else if (!response.ok) {
    throw new NameServiceError(`HL Names returned HTTP ${response.status} for ${path}`);
  } else {
    const { address } = await parseBody(response, path, hlResolveSchema);
    result = address === ZERO_ADDRESS ? null : address;
  }
  forwardCache.set(key, result, result ? FORWARD_HIT_TTL_MS : FORWARD_MISS_TTL_MS);
  return result;
}

async function fetchPrimaryNames(addresses: readonly string[]): Promise<Map<string, string>> {
  const path = "/utils/all_primary_names";
  const response = await send(path, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ addresses }),
  });
  if (!response.ok) {
    throw new NameServiceError(`HL Names returned HTTP ${response.status} for ${path}`);
  }
  const entries = await parseBody(response, path, hlBulkPrimaryNamesSchema);
  // The schema lower-cases the addresses, so they match our keys.
  const found = new Map<string, string>();
  for (const { address, primaryName } of entries) {
    if (primaryName.trim() !== "") found.set(address, primaryName);
  }
  return found;
}

/**
 * The `.hl` primary names of many lower-case addresses.
 * One bulk POST per 100 uncached addresses. A failed chunk does not fail
 * the others. Failures are not cached and are logged once per call.
 */
export async function lookupHlNames(addresses: readonly string[]): Promise<NameLookup> {
  const names = new Map<string, string>();
  const missing: string[] = [];
  for (const address of addresses) {
    const cached = reverseCache.get(`hl:${address}`);
    if (!cached) missing.push(address);
    else if (cached.value) names.set(address, cached.value);
  }
  if (missing.length === 0) return { names, complete: true };

  const chunks: string[][] = [];
  for (let start = 0; start < missing.length; start += BULK_CHUNK_SIZE) {
    chunks.push(missing.slice(start, start + BULK_CHUNK_SIZE));
  }
  const results = await Promise.allSettled(chunks.map((chunk) => fetchPrimaryNames(chunk)));

  let failed = 0;
  let firstError: unknown;
  chunks.forEach((chunk, index) => {
    const result = results[index];
    if (!result || result.status === "rejected") {
      failed += chunk.length;
      firstError ??= result?.reason;
      return;
    }
    for (const address of chunk) {
      const name = result.value.get(address) ?? null;
      reverseCache.set(`hl:${address}`, name, REVERSE_TTL_MS);
      if (name) names.set(address, name);
    }
  });

  if (failed > 0) {
    console.error(
      `[names] HL Names lookup failed for ${failed} of ${missing.length} addresses.`,
      firstError,
    );
  }
  return { names, complete: failed === 0 };
}
