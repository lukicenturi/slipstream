import { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid";
import type { AbstractWallet } from "@nktkas/hyperliquid/signing";
import { privateKeyToAccount } from "viem/accounts";

import type { StoredAgent } from "./agent";
import { assertTradingEnabled, getTradingMode, NETWORK, type Network } from "./config";
import { toTradingError } from "./errors";
import {
  summarizeOrderResponse,
  summarizeOrderStatuses,
  type IocOrder,
  type OrderResult,
} from "./order";

/*
 * The only module that talks to Hyperliquid's exchange endpoint.
 * Every function first checks that the build's trading mode equals its
 * network (assertTradingEnabled). The transport follows the network:
 * `new HttpTransport({ isTestnet })`, and a host pin refuses any other host.
 * A mainnet build without NEXT_PUBLIC_TRADING_MODE=mainnet creates no client.
 */

/** The exchange host of each network. These literals may appear only here and in lib/network.ts. */
export const EXCHANGE_HOSTS: Readonly<Record<Network, string>> = {
  mainnet: "api.hyperliquid.xyz",
  testnet: "api.hyperliquid-testnet.xyz",
};
const EXCHANGE_TIMEOUT_MS = 15_000;

export type TradingClient = ExchangeClient & { readonly network: Network };

/**
 * The HTTP transport of a network. Throws unless the mode enables trading on
 * that network. The defaults are the build's mode and network; tests pass
 * other values.
 */
export function createTradingTransport(
  mode: unknown = getTradingMode(),
  network: Network = NETWORK,
): HttpTransport {
  assertTradingEnabled(mode, network);
  const isTestnet = network === "testnet";
  const transport = new HttpTransport({ isTestnet, timeout: EXCHANGE_TIMEOUT_MS });
  // Defence in depth: refuse a transport that does not point at the network's host.
  if (
    transport.isTestnet !== isTestnet ||
    new URL(transport.apiUrl).host !== EXCHANGE_HOSTS[network]
  ) {
    throw new Error(`Refusing an exchange transport that is not on ${network}.`);
  }
  return transport;
}

function tradingClient(wallet: AbstractWallet, signatureChainId?: `0x${string}`): TradingClient {
  const client = new ExchangeClient({
    transport: createTradingTransport(),
    wallet,
    ...(signatureChainId ? { signatureChainId } : {}),
  });
  return Object.assign(client, { network: NETWORK });
}

/**
 * A client signed by the user's main wallet. It only sends approveAgent.
 * `chainIdHex` is the wallet's current chain, used in the EIP-712 domain.
 */
export function createApprovalClient(
  wallet: AbstractWallet,
  chainIdHex: `0x${string}`,
): TradingClient {
  assertTradingEnabled(getTradingMode(), NETWORK);
  return tradingClient(wallet, chainIdHex);
}

/** A client signed by the agent key (L1 actions: leverage and orders). */
export function createAgentClient(agentPrivateKey: `0x${string}`): TradingClient {
  assertTradingEnabled(getTradingMode(), NETWORK);
  return tradingClient(privateKeyToAccount(agentPrivateKey));
}

/** Approve the agent with one signature of the main wallet. Throws a TradingError. */
export async function approveAgent(
  client: TradingClient,
  agent: Pick<StoredAgent, "address" | "name">,
): Promise<void> {
  assertTradingEnabled(getTradingMode(), NETWORK);
  try {
    await client.approveAgent({ agentAddress: agent.address, agentName: agent.name });
  } catch (error) {
    throw toTradingError(error, { network: NETWORK });
  }
}

/** Set the leverage of one asset. Signed by the agent. Throws a TradingError. */
export async function setLeverage(
  client: TradingClient,
  input: { assetIndex: number; leverage: number; isCross: boolean; agentAddress: string },
): Promise<void> {
  assertTradingEnabled(getTradingMode(), NETWORK);
  try {
    await client.updateLeverage({
      asset: input.assetIndex,
      isCross: input.isCross,
      leverage: input.leverage,
    });
  } catch (error) {
    throw toTradingError(error, { agentAddress: input.agentAddress, network: NETWORK });
  }
}

/**
 * Place one IOC order. Signed by the agent. A per-order rejection (for
 * example "Insufficient margin") returns `{ kind: "error" }`; other
 * failures throw a TradingError.
 */
export async function placeIocOrder(
  client: TradingClient,
  order: IocOrder,
  agentAddress: string,
): Promise<OrderResult> {
  assertTradingEnabled(getTradingMode(), NETWORK);
  let response: unknown;
  try {
    response = await client.order({ orders: [order], grouping: "na" });
  } catch (error) {
    // The SDK throws for a per-order error too; its raw body holds the status.
    const body =
      typeof error === "object" && error !== null && "response" in error ? error.response : null;
    const result = summarizeOrderResponse(body);
    if (result) return result;
    throw toTradingError(error, { agentAddress, network: NETWORK });
  }
  return summarizeOrderResponse(response) ?? summarizeOrderStatuses(null);
}
