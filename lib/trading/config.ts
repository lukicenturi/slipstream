import { ENDPOINTS, NETWORK, type Network } from "@/lib/network";

/*
 * Trading mode. A build has one network (lib/network.ts). Trading is on
 * only when NEXT_PUBLIC_TRADING_MODE names that same network: "testnet" in
 * a testnet build, "mainnet" in a mainnet build. Any other combination is
 * read-only, so a mainnet build without the flag (previews, local dev)
 * never signs. The user enabled mainnet trading on 2026-11-11 and accepts
 * the risk; the safeguards in TRADING_LIMITS apply on both networks.
 */

export { NETWORK, type Network };

export type TradingMode = "off" | Network;

/** Only the exact strings "testnet" and "mainnet" are modes; anything else is "off". */
export function parseTradingMode(value: string | undefined): TradingMode {
  return value === "testnet" || value === "mainnet" ? value : "off";
}

// A literal process.env expression, so Next inlines it at build time.
const BUILD_TRADING_MODE: TradingMode = parseTradingMode(process.env.NEXT_PUBLIC_TRADING_MODE);

/** The trading mode of this build, from NEXT_PUBLIC_TRADING_MODE. */
export function getTradingMode(): TradingMode {
  return BUILD_TRADING_MODE;
}

/** True when a mode enables trading on a network: the mode names that network. */
export function isTradingEnabled(mode: TradingMode, network: Network): boolean {
  return mode !== "off" && mode === network;
}

/** True only when the build's mode equals its network. Components pick the demo or the trading UI with it. */
export const TRADING_ENABLED: boolean = isTradingEnabled(BUILD_TRADING_MODE, NETWORK);

/**
 * True in every build: the header wallet button, the wallet providers and
 * the connected account view show on both hosts. The wallet is read-only
 * unless TRADING_ENABLED: then the app only reads the address. It never
 * requests a signature and never creates an exchange client there.
 * Anything that signs or trades stays behind TRADING_ENABLED.
 */
export const WALLET_ENABLED: boolean = true;

export class TradingDisabledError extends Error {
  constructor() {
    super("Trading is disabled. NEXT_PUBLIC_TRADING_MODE must match the build's network.");
    this.name = "TradingDisabledError";
  }
}

/** Throws unless the mode is not "off" and equals the network. Every exchange call starts with it. */
export function assertTradingEnabled(mode: unknown, network: unknown): asserts mode is Network {
  if ((mode !== "testnet" && mode !== "mainnet") || mode !== network) {
    throw new TradingDisabledError();
  }
}

/** The endpoints of this build's network, for the trading code (faucetUrl is null on mainnet). */
export const TRADING = ENDPOINTS[NETWORK];

/** The exchange rejects orders below $10 notional. */
export const MIN_ORDER_USD = 10;

export interface TradingLimits {
  /** The per-order size cap before the user changes it, in USD. */
  defaultMaxOrderUsd: number;
  /** The highest cap that the settings accept, in USD. */
  hardMaxOrderUsd: number;
  /** How long an approved agent key stays valid on the exchange. */
  agentTtlMs: number;
  /** How far through the mid the IOC limit price goes (0.01 = 1 %). */
  slippage: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The safeguards of each network. Mainnet is stricter: a small cap and a short agent life. */
export const TRADING_LIMITS: Readonly<Record<Network, Readonly<TradingLimits>>> = {
  mainnet: {
    defaultMaxOrderUsd: 500,
    hardMaxOrderUsd: 50_000,
    agentTtlMs: 24 * HOUR_MS,
    slippage: 0.01,
  },
  testnet: {
    defaultMaxOrderUsd: 10_000,
    hardMaxOrderUsd: 50_000,
    agentTtlMs: 7 * DAY_MS,
    slippage: 0.01,
  },
};

/*
 * Networks and hosts. Each network has its own deployment (host). Each
 * host trades only when its build sets NEXT_PUBLIC_TRADING_MODE to its
 * network. The app never switches network at run time: the network switch
 * is a link to the other host.
 */

export type NetworkUrls = Readonly<Record<Network, string>>;

export const DEFAULT_NETWORK_URLS: NetworkUrls = {
  mainnet: "https://slipstream-hl.vercel.app",
  testnet: "https://slipstream-testnet.vercel.app",
};

/**
 * The origin of an http(s) URL without a trailing slash, or the fallback
 * when the value is unset, empty or not an http(s) URL.
 */
export function parseNetworkUrl(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
}

// Literal process.env expressions, so Next inlines them at build time.
export const NETWORK_URLS: NetworkUrls = {
  mainnet: parseNetworkUrl(process.env.NEXT_PUBLIC_MAINNET_URL, DEFAULT_NETWORK_URLS.mainnet),
  testnet: parseNetworkUrl(process.env.NEXT_PUBLIC_TESTNET_URL, DEFAULT_NETWORK_URLS.testnet),
};

const NETWORK_LABEL: Record<Network, "Mainnet" | "Testnet"> = {
  mainnet: "Mainnet",
  testnet: "Testnet",
};

/** The display name of a network ("Mainnet" or "Testnet"). */
export function networkLabel(network: Network): "Mainnet" | "Testnet" {
  return NETWORK_LABEL[network];
}

export function otherNetwork(network: Network): Network {
  return network === "mainnet" ? "testnet" : "mainnet";
}

/** The host of a network URL, for link text ("slipstream-testnet.vercel.app"). */
export function networkHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const TRADER_PATH = /^\/trader\/[^/?#]+$/;

/**
 * The part of a path that exists on both hosts: `/`, `/watchlist`,
 * `/account` and `/trader/<address>`. On `/` it keeps `?view=live` (the mobile feed).
 * Any other path, and any other query, becomes `/`.
 */
export function sharedPath(path: string): string {
  const queryAt = path.indexOf("?");
  const pathname = queryAt === -1 ? path : path.slice(0, queryAt);
  const query = queryAt === -1 ? "" : path.slice(queryAt + 1);
  if (pathname === "/") {
    return new URLSearchParams(query).get("view") === "live" ? "/?view=live" : "/";
  }
  if (pathname === "/watchlist" || pathname === "/account" || TRADER_PATH.test(pathname)) {
    return pathname;
  }
  return "/";
}

export type NetworkSwitchTarget = {
  /** The network that the link opens. */
  label: "Mainnet" | "Testnet";
  href: string;
};

/** The link to the other network's host, with the current path when both hosts have it. */
export function networkSwitchTarget(
  network: Network,
  urls: NetworkUrls,
  path: string,
): NetworkSwitchTarget {
  const target = otherNetwork(network);
  return {
    label: networkLabel(target),
    href: `${urls[target].replace(/\/+$/, "")}${sharedPath(path)}`,
  };
}
