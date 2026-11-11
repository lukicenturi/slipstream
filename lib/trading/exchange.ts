import { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid";
import type { AbstractWallet } from "@nktkas/hyperliquid/signing";
import { privateKeyToAccount } from "viem/accounts";

import type { StoredAgent } from "./agent";
import { assertTestnetTrading, getTradingMode } from "./config";
import { toTradingError } from "./errors";
import {
  summarizeOrderResponse,
  summarizeOrderStatuses,
  type IocOrder,
  type OrderResult,
} from "./order";

/*
 * The only module that talks to Hyperliquid's exchange endpoint.
 * Every function first checks that this is a testnet build, and the only
 * transport is `new HttpTransport({ isTestnet: true })`. There is no code
 * path that creates a mainnet exchange client.
 */

const TESTNET_API_HOST = "api.hyperliquid-testnet.xyz";
const EXCHANGE_TIMEOUT_MS = 15_000;

type TestnetClient = ExchangeClient & { readonly testnet: true };

/** The testnet HTTP transport. Throws outside a testnet build. */
export function createTestnetTransport(): HttpTransport {
  assertTestnetTrading(getTradingMode());
  const transport = new HttpTransport({ isTestnet: true, timeout: EXCHANGE_TIMEOUT_MS });
  // Defence in depth: refuse any transport that does not point at the testnet host.
  if (!transport.isTestnet || new URL(transport.apiUrl).host !== TESTNET_API_HOST) {
    throw new Error("Refusing a non-testnet exchange transport.");
  }
  return transport;
}

function testnetClient(wallet: AbstractWallet, signatureChainId?: `0x${string}`): TestnetClient {
  const client = new ExchangeClient({
    transport: createTestnetTransport(),
    wallet,
    ...(signatureChainId ? { signatureChainId } : {}),
  });
  return Object.assign(client, { testnet: true as const });
}

/**
 * A client signed by the user's main wallet. It only sends approveAgent.
 * `chainIdHex` is the wallet's current chain, used in the EIP-712 domain.
 */
export function createApprovalClient(
  wallet: AbstractWallet,
  chainIdHex: `0x${string}`,
): TestnetClient {
  assertTestnetTrading(getTradingMode());
  return testnetClient(wallet, chainIdHex);
}

/** A client signed by the agent key (L1 actions: leverage and orders). */
export function createAgentClient(agentPrivateKey: `0x${string}`): TestnetClient {
  assertTestnetTrading(getTradingMode());
  return testnetClient(privateKeyToAccount(agentPrivateKey));
}

/** Approve the agent with one signature of the main wallet. Throws a TradingError. */
export async function approveAgent(
  client: TestnetClient,
  agent: Pick<StoredAgent, "address" | "name">,
): Promise<void> {
  assertTestnetTrading(getTradingMode());
  try {
    await client.approveAgent({ agentAddress: agent.address, agentName: agent.name });
  } catch (error) {
    throw toTradingError(error);
  }
}

/** Set the leverage of one asset. Signed by the agent. Throws a TradingError. */
export async function setLeverage(
  client: TestnetClient,
  input: { assetIndex: number; leverage: number; isCross: boolean; agentAddress: string },
): Promise<void> {
  assertTestnetTrading(getTradingMode());
  try {
    await client.updateLeverage({
      asset: input.assetIndex,
      isCross: input.isCross,
      leverage: input.leverage,
    });
  } catch (error) {
    throw toTradingError(error, { agentAddress: input.agentAddress });
  }
}

/**
 * Place one IOC order. Signed by the agent. A per-order rejection (for
 * example "Insufficient margin") returns `{ kind: "error" }`; other
 * failures throw a TradingError.
 */
export async function placeIocOrder(
  client: TestnetClient,
  order: IocOrder,
  agentAddress: string,
): Promise<OrderResult> {
  assertTestnetTrading(getTradingMode());
  let response: unknown;
  try {
    response = await client.order({ orders: [order], grouping: "na" });
  } catch (error) {
    // The SDK throws for a per-order error too; its raw body holds the status.
    const body =
      typeof error === "object" && error !== null && "response" in error ? error.response : null;
    const result = summarizeOrderResponse(body);
    if (result) return result;
    throw toTradingError(error, { agentAddress });
  }
  return summarizeOrderResponse(response) ?? summarizeOrderStatuses(null);
}
