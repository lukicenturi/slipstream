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
