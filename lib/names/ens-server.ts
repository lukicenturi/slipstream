import "server-only";

import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

import {
  forwardCache,
  FORWARD_HIT_TTL_MS,
  FORWARD_MISS_TTL_MS,
  reverseCache,
  REVERSE_TTL_MS,
} from "./cache";
import { isAddress } from "@/lib/address";

import { NameServiceError, type NameLookup } from "./lookup";

/*
 * ENS on Ethereum mainnet, through viem. Read calls only.
 * The RPC comes from ETH_RPC_URL; publicnode needs no key.
 * Multicall batching groups many reverse lookups into a few RPC requests.
 */

const DEFAULT_RPC_URL = "https://ethereum-rpc.publicnode.com";
const RPC_TIMEOUT_MS = 10_000;

function createEnsClient() {
  return createPublicClient({
    chain: mainnet,
    batch: { multicall: true },
    transport: http(process.env.ETH_RPC_URL || DEFAULT_RPC_URL, {
      batch: true,
      timeout: RPC_TIMEOUT_MS,
      retryCount: 1,
    }),
  });
}

let client: ReturnType<typeof createEnsClient> | null = null;

function getClient(): ReturnType<typeof createEnsClient> {
  client ??= createEnsClient();
  return client;
}

/**
 * Resolve a `.eth` name to a lower-case address.
 * Returns null when the name has no address or does not pass UTS-46
 * normalisation. Throws NameServiceError when the RPC call fails.
 */
export async function resolveEnsName(name: string): Promise<string | null> {
  let normalized: string;
  try {
    normalized = normalize(name);
  } catch {
    return null;
  }

  const key = `ens:${normalized}`;
  const cached = forwardCache.get(key);
  if (cached) return cached.value;

  let address: string | null;
  try {
    address = await getClient().getEnsAddress({ name: normalized });
  } catch (error) {
    throw new NameServiceError(`ENS lookup for ${normalized} failed`, { cause: error });
  }
  const result = address ? address.toLowerCase() : null;
  forwardCache.set(key, result, result ? FORWARD_HIT_TTL_MS : FORWARD_MISS_TTL_MS);
  return result;
}

/**
 * The ENS primary names of many addresses (lower-case keys).
 * A failed lookup for one address does not fail the others. Failures are
 * not cached and are logged once per call.
 */
export async function lookupEnsNames(addresses: readonly string[]): Promise<NameLookup> {
  const names = new Map<string, string>();
  const missing: `0x${string}`[] = [];
  for (const address of addresses) {
    const cached = reverseCache.get(`ens:${address}`);
    if (!cached) {
      if (isAddress(address)) missing.push(address);
    } else if (cached.value) names.set(address, cached.value);
  }
  if (missing.length === 0) return { names, complete: true };

  const ens = getClient();
  const results = await Promise.allSettled(missing.map((address) => ens.getEnsName({ address })));

  let failures = 0;
  let firstError: unknown;
  missing.forEach((address, index) => {
    const result = results[index];
    if (!result || result.status === "rejected") {
      failures += 1;
      firstError ??= result?.reason;
      return;
    }
    const name = result.value ?? null;
    reverseCache.set(`ens:${address}`, name, REVERSE_TTL_MS);
    if (name) names.set(address, name);
  });

  if (failures > 0) {
    console.error(
      `[names] ${failures} of ${missing.length} ENS reverse lookups failed.`,
      firstError,
    );
  }
  return { names, complete: failures === 0 };
}
