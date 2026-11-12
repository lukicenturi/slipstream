import { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid";
import type { AbstractWallet } from "@nktkas/hyperliquid/signing";
import { privateKeyToAccount } from "viem/accounts";

import type { StoredAgent } from "./agent";
import { assertTradingEnabled, getTradingMode, NETWORK, type Network } from "./config";
import { toTradingError, TradingError } from "./errors";
import { modifyResponseSchema, summarizeCancel, type CancelStatus } from "./openOrders";
import {
  summarizeOrderResponse,
  summarizeOrdersResponse,
  summarizeOrderStatuses,
  type IocOrder,
  type OrderResult,
} from "./order";
import type { TriggerOrder } from "./tpsl";

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

/** The raw body that the SDK keeps on an ApiRequestError, or null. */
function errorBody(error: unknown): unknown {
  return typeof error === "object" && error !== null && "response" in error ? error.response : null;
}

/**
 * Place reduce-only trigger orders (take profit, stop loss) in one request.
 * Signed by the agent. `"positionTpsl"` makes them follow the position size.
 * Returns one result per order, in the order sent; a per-order rejection
 * is a `{ kind: "error" }` entry. Other failures throw a TradingError.
 */
export async function placeTriggerOrders(
  client: TradingClient,
  orders: readonly TriggerOrder[],
  grouping: "positionTpsl" | "normalTpsl",
  agentAddress: string,
): Promise<OrderResult[]> {
  assertTradingEnabled(getTradingMode(), NETWORK);
  // Defence in depth: a trigger order from Slipstream is always reduce-only.
  if (orders.length === 0 || orders.some((order) => order.r !== true)) {
    throw new TradingError("api", "Refusing a trigger order that is not reduce-only.");
  }
  let response: unknown;
  try {
    response = await client.order({ orders: [...orders], grouping });
  } catch (error) {
    // The SDK throws when any order has an error; its raw body holds every status.
    const results = summarizeOrdersResponse(errorBody(error));
    if (results) return results;
    throw toTradingError(error, { agentAddress, network: NETWORK });
  }
  return summarizeOrdersResponse(response) ?? [summarizeOrderStatuses(null)];
}

/**
 * Cancel orders by asset and oid. Signed by the agent. Returns the status
 * of each cancel, in the order sent ("Order was never placed, already
 * canceled, or filled." is an error entry). Other failures throw a TradingError.
 */
export async function cancelOrders(
  client: TradingClient,
  cancels: readonly { a: number; o: number }[],
  agentAddress: string,
): Promise<CancelStatus[]> {
  assertTradingEnabled(getTradingMode(), NETWORK);
  if (cancels.length === 0) return [];
  let response: unknown;
  try {
    response = await client.cancel({ cancels: [...cancels] });
  } catch (error) {
    const statuses = summarizeCancel(errorBody(error));
    if (statuses) return statuses;
    throw toTradingError(error, { agentAddress, network: NETWORK });
  }
  const statuses = summarizeCancel(response);
  if (!statuses) throw new TradingError("api", "Unknown cancel response.");
  return statuses;
}

/**
 * Replace one open order in place (the trailing stop update). Signed by
 * the agent. Only reduce-only trigger orders go through here, so the
 * request carries `a: true`: the SDK and the exchange refuse a modify to a
 * trigger order without it. With `a: true`, the new order goes out even
 * when the cancel of the old one fails, so the caller cleans up a leftover
 * stop on the next open-orders poll. The body must parse as
 * `{ status: "ok" }`; an `err` body or any other body throws a TradingError.
 */
export async function modifyOrder(
  client: TradingClient,
  oid: number,
  order: TriggerOrder,
  agentAddress: string,
): Promise<void> {
  assertTradingEnabled(getTradingMode(), NETWORK);
  if (order.r !== true) {
    throw new TradingError("api", "Refusing a modify that is not reduce-only.");
  }
  let response: unknown;
  try {
    response = await client.modify({ oid, order, a: true });
  } catch (error) {
    throw toTradingError(error, { agentAddress, network: NETWORK });
  }
  const parsed = modifyResponseSchema.safeParse(response);
  if (!parsed.success) throw new TradingError("api", "Unknown modify response.");
  if (parsed.data.status === "err") {
    // The same mapping as a thrown SDK error, so an unknown agent still reads as "agent".
    const body = parsed.data;
    throw toTradingError(
      { name: "ApiRequestError", message: body.response, response: body },
      { agentAddress, network: NETWORK },
    );
  }
}
