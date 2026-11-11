/*
 * The network of this build. A build has exactly one network:
 * - mainnet: reads mainnet data and is read-only;
 * - testnet: reads testnet data everywhere and can place testnet orders.
 * The app never switches network at run time. The network switch in the
 * header is a link to the other deployment.
 *
 * This is the only file that holds the Hyperliquid endpoint URLs (the
 * exchange host pin in lib/trading/exchange.ts is the one exception).
 * lib/network-guard.test.ts fails when an endpoint literal appears elsewhere.
 */

export type Network = "mainnet" | "testnet";

export interface NetworkEndpoints {
  /** POST endpoint for the read-only info requests. */
  infoUrl: string;
  /** The one shared WebSocket. */
  wsUrl: string;
  /** The raw leaderboard file. The server downloads it; the browser never does. */
  leaderboardUrl: string;
  /** The Hyperliquid web app of this network. */
  appUrl: string;
  /** The explorer base URL; see explorerAddressUrl. */
  explorerUrl: string;
  /** The text of an explorer link. */
  explorerLabel: "Hyperliquid explorer" | "Testnet explorer";
  /** The test USDC faucet, or null on mainnet. */
  faucetUrl: string | null;
  label: "Mainnet" | "Testnet";
}

export const ENDPOINTS = {
  mainnet: {
    infoUrl: "https://api.hyperliquid.xyz/info",
    wsUrl: "wss://api.hyperliquid.xyz/ws",
    leaderboardUrl: "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard",
    appUrl: "https://app.hyperliquid.xyz",
    explorerUrl: "https://app.hyperliquid.xyz/explorer",
    explorerLabel: "Hyperliquid explorer",
    faucetUrl: null,
    label: "Mainnet",
  },
  testnet: {
    infoUrl: "https://api.hyperliquid-testnet.xyz/info",
    wsUrl: "wss://api.hyperliquid-testnet.xyz/ws",
    leaderboardUrl: "https://stats-data.hyperliquid.xyz/Testnet/leaderboard",
    appUrl: "https://app.hyperliquid-testnet.xyz",
    explorerUrl: "https://app.hyperliquid-testnet.xyz/explorer",
    explorerLabel: "Testnet explorer",
    faucetUrl: "https://app.hyperliquid-testnet.xyz/drip",
    label: "Testnet",
  },
} as const satisfies Record<Network, NetworkEndpoints>;

/**
 * Testnet when either variable is exactly "testnet", else mainnet.
 * NEXT_PUBLIC_NETWORK is the switch; NEXT_PUBLIC_TRADING_MODE still works.
 */
export function parseNetwork(
  networkEnv: string | undefined,
  tradingModeEnv: string | undefined,
): Network {
  return networkEnv === "testnet" || tradingModeEnv === "testnet" ? "testnet" : "mainnet";
}

// Next inlines NEXT_PUBLIC_ variables only for these literal expressions, at
// build time, so the server and the browser bundle agree on the network.
export const NETWORK: Network = parseNetwork(
  process.env.NEXT_PUBLIC_NETWORK,
  process.env.NEXT_PUBLIC_TRADING_MODE,
);

/** The endpoints of this build's network. Every data source reads from here. */
export const HL: Readonly<NetworkEndpoints> = ENDPOINTS[NETWORK];

/** The explorer page of an account on this build's network. */
export function explorerAddressUrl(address: string): string {
  return `${HL.explorerUrl}/address/${address.toLowerCase()}`;
}
