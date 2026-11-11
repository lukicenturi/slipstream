import type { z } from "zod";

import {
  allMidsSchema,
  clearinghouseStateSchema,
  leaderboardResponseSchema,
  metaSchema,
  portfolioSchema,
  userFillsSchema,
  type ClearinghouseState,
  type Fill,
  type LeaderboardResponse,
  type PerpAsset,
  type Portfolio,
} from "./schemas";

/*
 * REST client. Every response goes through a zod schema here, so the
 * rest of the app only sees parsed domain types with real numbers.
 * This file calls the public info endpoint only (mainnet by default, or
 * the testnet info URL for the testnet trading build). It never signs.
 */

export const INFO_URL = "https://api.hyperliquid.xyz/info";
const REQUEST_TIMEOUT_MS = 10_000;
// A cold /api/leaderboard downloads the 39 MB file first, so it gets more time.
const LEADERBOARD_TIMEOUT_MS = 60_000;

export type HyperliquidErrorKind = "network" | "http" | "schema";

export class HyperliquidError extends Error {
  readonly kind: HyperliquidErrorKind;
  readonly status: number | undefined;

  constructor(
    kind: HyperliquidErrorKind,
    message: string,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "HyperliquidError";
    this.kind = kind;
    this.status = options?.status;
  }
}

/** The read-only info requests that the app sends. */
export type InfoRequest =
  | { type: "clearinghouseState"; user: string }
  | { type: "userFills"; user: string }
  | { type: "portfolio"; user: string }
  | { type: "meta" }
  | { type: "allMids" };

interface RequestOptions {
  signal?: AbortSignal;
}

interface InfoOptions extends RequestOptions {
  /** The info endpoint. The default is mainnet; the testnet build passes TESTNET.infoUrl. */
  baseUrl?: string;
}

function withTimeout(signal: AbortSignal | undefined, ms = REQUEST_TIMEOUT_MS): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function requestJson<S extends z.ZodType>(
  url: string,
  init: RequestInit,
  schema: S,
): Promise<z.output<S>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new HyperliquidError("network", `Request to ${url} failed`, { cause: error });
  }
  if (!response.ok) {
    throw new HyperliquidError("http", `Request to ${url} returned HTTP ${response.status}`, {
      status: response.status,
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new HyperliquidError("schema", `Response from ${url} is not JSON`, { cause: error });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HyperliquidError("schema", `Response from ${url} does not match the schema`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** POST one read-only request to the info endpoint and validate the result. */
export function infoRequest<S extends z.ZodType>(
  body: InfoRequest,
  schema: S,
  options: InfoOptions = {},
): Promise<z.output<S>> {
  return requestJson(
    options.baseUrl ?? INFO_URL,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: withTimeout(options.signal),
    },
    schema,
  );
}

/** The trimmed leaderboard from our own API route (never the raw file). */
export function getLeaderboard(options: RequestOptions = {}): Promise<LeaderboardResponse> {
  return requestJson(
    "/api/leaderboard",
    { signal: withTimeout(options.signal, LEADERBOARD_TIMEOUT_MS) },
    leaderboardResponseSchema,
  );
}

export function getClearinghouseState(
  address: string,
  options: InfoOptions = {},
): Promise<ClearinghouseState> {
  return infoRequest(
    { type: "clearinghouseState", user: address.toLowerCase() },
    clearinghouseStateSchema,
    options,
  );
}

export function getUserFills(address: string, options: InfoOptions = {}): Promise<Fill[]> {
  return infoRequest({ type: "userFills", user: address.toLowerCase() }, userFillsSchema, options);
}

export function getPortfolio(address: string, options: InfoOptions = {}): Promise<Portfolio> {
  return infoRequest({ type: "portfolio", user: address.toLowerCase() }, portfolioSchema, options);
}

/** The perp universe with each asset's id, size decimals and max leverage. */
export function getMeta(baseUrl: string, options: RequestOptions = {}): Promise<PerpAsset[]> {
  return infoRequest({ type: "meta" }, metaSchema, { ...options, baseUrl });
}

/** One REST snapshot of all perp mids. Live mainnet mids come from the socket instead. */
export function getAllMidsOnce(
  baseUrl: string,
  options: RequestOptions = {},
): Promise<Record<string, number>> {
  return infoRequest({ type: "allMids" }, allMidsSchema, { ...options, baseUrl });
}
