/*
 * Trading mode. Production is read-only. Orders exist only on the
 * Hyperliquid testnet, and only in a build with
 * NEXT_PUBLIC_TRADING_MODE=testnet. There is no mainnet mode.
 */

export type TradingMode = "off" | "testnet";

/** Any value other than the exact string "testnet" is "off". */
export function parseTradingMode(value: string | undefined): TradingMode {
  return value === "testnet" ? "testnet" : "off";
}

// Next inlines NEXT_PUBLIC_ variables only for this literal expression, at build time.
const BUILD_TRADING_MODE: TradingMode = parseTradingMode(process.env.NEXT_PUBLIC_TRADING_MODE);

/** The trading mode of this build. */
export function getTradingMode(): TradingMode {
  return BUILD_TRADING_MODE;
}

/** True only in a testnet build. Components use it to pick the demo or the testnet UI. */
export const TRADING_ENABLED: boolean = BUILD_TRADING_MODE === "testnet";

export class TradingDisabledError extends Error {
  constructor() {
    super("Trading is disabled. Only a testnet build can place orders.");
    this.name = "TradingDisabledError";
  }
}

/** Throws unless the mode is exactly "testnet". Every exchange call starts with it. */
export function assertTestnetTrading(mode: unknown): asserts mode is "testnet" {
  if (mode !== "testnet") throw new TradingDisabledError();
}

export const TESTNET = {
  infoUrl: "https://api.hyperliquid-testnet.xyz/info",
  appUrl: "https://app.hyperliquid-testnet.xyz",
  faucetUrl: "https://app.hyperliquid-testnet.xyz/drip",
  explorerUrl: "https://app.hyperliquid-testnet.xyz/explorer",
} as const;

/** The testnet explorer page of an account. */
export function testnetExplorerUrl(address: string): string {
  return `${TESTNET.explorerUrl}/address/${address.toLowerCase()}`;
}

/*
 * Networks and hosts. Each network has its own deployment (host). The
 * mainnet host is read-only; the testnet host is a build with trading on.
 * The app never switches network at run time: the network switch is a
 * link to the other host.
 */

export type Network = "mainnet" | "testnet";

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

/** The network of this build: testnet when trading is on, else mainnet. */
export const NETWORK: Network = TRADING_ENABLED ? "testnet" : "mainnet";

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
 * The part of a path that exists on both hosts: `/`, `/watchlist` and
 * `/trader/<address>`. On `/` it keeps `?view=live` (the mobile feed).
 * Any other path, and any other query, becomes `/`.
 */
export function sharedPath(path: string): string {
  const queryAt = path.indexOf("?");
  const pathname = queryAt === -1 ? path : path.slice(0, queryAt);
  const query = queryAt === -1 ? "" : path.slice(queryAt + 1);
  if (pathname === "/") {
    return new URLSearchParams(query).get("view") === "live" ? "/?view=live" : "/";
  }
  if (pathname === "/watchlist" || TRADER_PATH.test(pathname)) return pathname;
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
