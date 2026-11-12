import type { z } from "zod";

import { dexesFromLedger } from "@/lib/calc/balances";
import { HL } from "@/lib/network";

import {
  allMidsSchema,
  clearinghouseStateSchema,
  frontendOpenOrdersSchema,
  leaderboardResponseSchema,
  ledgerDexMovesSchema,
  metaSchema,
  perpDexsSchema,
  portfolioSchema,
  spotClearinghouseStateSchema,
  spotTokenMapSchema,
  userAbstractionSchema,
  userFillsSchema,
  type ClearinghouseState,
  type Fill,
  type LeaderboardResponse,
  type OpenOrder,
  type PerpAsset,
  type PerpDex,
  type Portfolio,
  type SpotBalance,
  type SpotTokenMap,
  type UserAbstraction,
} from "./schemas";

/*
 * REST client. Every response goes through a zod schema here, so the
 * rest of the app only sees parsed domain types with real numbers.
 * This file calls the public info endpoint of this build's network only
 * (lib/network.ts). It never signs.
 */

export const INFO_URL = HL.infoUrl;
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
  | { type: "clearinghouseState"; user: string; dex?: string }
  | { type: "spotClearinghouseState"; user: string }
  | { type: "userNonFundingLedgerUpdates"; user: string; startTime: number }
  | { type: "userFills"; user: string }
  | { type: "frontendOpenOrders"; user: string }
  | { type: "portfolio"; user: string }
  | { type: "userAbstraction"; user: string }
  | { type: "perpDexs" }
  | { type: "meta" }
  | { type: "allMids" };

interface RequestOptions {
  signal?: AbortSignal;
}

interface InfoOptions extends RequestOptions {
  /** The info endpoint. The default is the info URL of this build's network. */
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

/**
 * The perp margin account of an address. Without `dex` (or with ""), the
 * main perp exchange; with `dex`, that builder exchange ("vntls").
 */
export function getClearinghouseState(
  address: string,
  options: InfoOptions & { dex?: string } = {},
): Promise<ClearinghouseState> {
  const { dex, ...rest } = options;
  const body: InfoRequest = dex
    ? { type: "clearinghouseState", user: address.toLowerCase(), dex }
    : { type: "clearinghouseState", user: address.toLowerCase() };
  return infoRequest(body, clearinghouseStateSchema, rest);
}

/** The builder-deployed perp exchanges of this network (the main one is left out). */
export function getPerpDexs(options: InfoOptions = {}): Promise<PerpDex[]> {
  return infoRequest({ type: "perpDexs" }, perpDexsSchema, options);
}

/** The spot balances of an address, with numbers. */
export function getSpotClearinghouseState(
  address: string,
  options: InfoOptions = {},
): Promise<SpotBalance[]> {
  return infoRequest(
    { type: "spotClearinghouseState", user: address.toLowerCase() },
    spotClearinghouseStateSchema,
    options,
  );
}

/**
 * The builder exchanges that the address sent USDC or tokens from or to,
 * read from its ledger (deposits, transfers, sends). Sorted, no duplicates.
 */
export async function getLedgerDexes(
  address: string,
  options: InfoOptions = {},
): Promise<string[]> {
  const user = address.toLowerCase();
  const moves = await infoRequest(
    { type: "userNonFundingLedgerUpdates", user, startTime: 0 },
    ledgerDexMovesSchema,
    options,
  );
  return dexesFromLedger(moves, user);
}

/** The account mode of an address ("default", "unifiedAccount", ...). */
export function getUserAbstraction(
  address: string,
  options: InfoOptions = {},
): Promise<UserAbstraction> {
  return infoRequest(
    { type: "userAbstraction", user: address.toLowerCase() },
    userAbstractionSchema,
    options,
  );
}

/** The trimmed spot token map from our own API route (never the raw spotMeta). */
export function getSpotTokenMap(options: RequestOptions = {}): Promise<SpotTokenMap> {
  return requestJson("/api/spot-meta", { signal: withTimeout(options.signal) }, spotTokenMapSchema);
}

export function getUserFills(address: string, options: InfoOptions = {}): Promise<Fill[]> {
  return infoRequest({ type: "userFills", user: address.toLowerCase() }, userFillsSchema, options);
}

/** The open orders of an address on the main perp exchange, with trigger details. */
export function getFrontendOpenOrders(
  address: string,
  options: InfoOptions = {},
): Promise<OpenOrder[]> {
  return infoRequest(
    { type: "frontendOpenOrders", user: address.toLowerCase() },
    frontendOpenOrdersSchema,
    options,
  );
}

export function getPortfolio(address: string, options: InfoOptions = {}): Promise<Portfolio> {
  return infoRequest({ type: "portfolio", user: address.toLowerCase() }, portfolioSchema, options);
}

/** The perp universe with each asset's id, size decimals and max leverage. */
export function getMeta(baseUrl: string, options: RequestOptions = {}): Promise<PerpAsset[]> {
  return infoRequest({ type: "meta" }, metaSchema, { ...options, baseUrl });
}

/** One REST snapshot of all perp mids. Live mids come from the shared socket instead. */
export function getAllMidsOnce(
  baseUrl: string,
  options: RequestOptions = {},
): Promise<Record<string, number>> {
  return infoRequest({ type: "allMids" }, allMidsSchema, { ...options, baseUrl });
}
