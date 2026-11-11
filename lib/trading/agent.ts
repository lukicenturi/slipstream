import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

import type { Network } from "@/lib/network";

import { TRADING_LIMITS } from "./config";

/*
 * The Slipstream agent key (a Hyperliquid "API wallet").
 *
 * The browser generates this key. The user's main wallet approves it once
 * with one signature. After that, the agent signs orders and leverage
 * changes for that account on the build's network. An agent can trade but
 * cannot withdraw or transfer funds. The key lives only in this browser's
 * localStorage, under a key scoped to the network and to the owner address.
 * It expires on the exchange after 24 h on mainnet and 7 days on testnet.
 * The user's own wallet key is never asked for and never stored.
 */

/** Every agent key starts with this; the network and the owner follow. */
export const AGENT_STORAGE_ROOT = "slipstream.agent.";
/** The key of the testnet build before mainnet trading. It is read once and moved. */
export const LEGACY_AGENT_STORAGE_PREFIX = "slipstream.testnet.agent.";
const AGENT_BASE_NAME = "slipstream";

export interface StoredAgent {
  privateKey: `0x${string}`;
  address: `0x${string}`;
  /** The agentName sent with approveAgent, with its expiry suffix. */
  name: string;
  createdAt: number;
  /** Time in ms after which the exchange no longer accepts the agent. */
  validUntil: number;
}

/** The part of localStorage that this module uses. Tests pass a fake. */
export type AgentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const hex = (length: number) =>
  z
    .string()
    .regex(new RegExp(`^0x[0-9a-fA-F]{${length}}$`))
    .transform((value) => value as `0x${string}`);

const storedAgentSchema = z.object({
  privateKey: hex(64),
  address: hex(40),
  name: z.string().min(1).max(64),
  createdAt: z.number().int().positive(),
  validUntil: z.number().int().positive(),
});

/** `slipstream.agent.<network>.<owner lower-case>`. */
export function agentStorageKey(owner: string, network: Network): string {
  return `${AGENT_STORAGE_ROOT}${network}.${owner.toLowerCase()}`;
}

function legacyAgentStorageKey(owner: string): string {
  return `${LEGACY_AGENT_STORAGE_PREFIX}${owner.toLowerCase()}`;
}

/** True for a storage key that holds an agent (current or legacy format). */
export function isAgentStorageKey(key: string): boolean {
  return key.startsWith(AGENT_STORAGE_ROOT) || key.startsWith(LEGACY_AGENT_STORAGE_PREFIX);
}

/** How long a new agent stays valid on the network: 24 h on mainnet, 7 days on testnet. */
export function agentTtlMs(network: Network): number {
  return TRADING_LIMITS[network].agentTtlMs;
}

/**
 * The agentName for approveAgent: "slipstream valid_until <ms>". The suffix
 * sets the expiry on the exchange. The SDK checks the 16-character limit on
 * the part before the suffix.
 */
export function agentName(now: number, network: Network): string {
  return `${AGENT_BASE_NAME} valid_until ${now + agentTtlMs(network)}`;
}

/** A new agent key. Nothing is stored until the approval succeeds. */
export function createAgent(network: Network, now: number = Date.now()): StoredAgent {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    privateKey,
    address: account.address,
    name: agentName(now, network),
    createdAt: now,
    validUntil: now + agentTtlMs(network),
  };
}

/** The ms until the agent expires, 0 when it already expired. */
export function agentRemainingMs(agent: Pick<StoredAgent, "validUntil">, now: number): number {
  return Math.max(0, agent.validUntil - now);
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** A short remaining time for the sheet: "45 min", "23 h", "6 days". Rounded down. */
export function formatRemaining(ms: number): string {
  if (ms < HOUR_MS) return `${Math.max(0, Math.floor(ms / MINUTE_MS))} min`;
  if (ms < 48 * HOUR_MS) return `${Math.floor(ms / HOUR_MS)} h`;
  return `${Math.floor(ms / (24 * HOUR_MS))} days`;
}

/**
 * Parse a stored value. Returns null for bad JSON, a wrong shape, an address
 * that does not belong to the key, or an agent that expired.
 */
export function parseStoredAgent(raw: string | null, now: number = Date.now()): StoredAgent | null {
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = storedAgentSchema.safeParse(json);
  if (!parsed.success) return null;
  const agent = parsed.data;
  let derived: string;
  try {
    derived = privateKeyToAccount(agent.privateKey).address;
  } catch {
    return null;
  }
  if (derived.toLowerCase() !== agent.address.toLowerCase()) return null;
  if (agent.validUntil <= now) return null;
  return agent;
}

function defaultStorage(): AgentStorage {
  return window.localStorage;
}

/**
 * The stored agent of an owner on a network, or null. Never throws.
 * On testnet, an agent under the legacy key is moved to the new key once.
 */
export function loadAgent(
  owner: string,
  network: Network,
  storage: () => AgentStorage = defaultStorage,
  now: number = Date.now(),
): StoredAgent | null {
  try {
    const store = storage();
    const current = parseStoredAgent(store.getItem(agentStorageKey(owner, network)), now);
    if (current || network !== "testnet") return current;
    const legacyKey = legacyAgentStorageKey(owner);
    const legacyRaw = store.getItem(legacyKey);
    if (legacyRaw === null) return null;
    const legacy = parseStoredAgent(legacyRaw, now);
    if (legacy) store.setItem(agentStorageKey(owner, network), JSON.stringify(legacy));
    store.removeItem(legacyKey);
    return legacy;
  } catch {
    return null;
  }
}

/** Store the agent of an owner on a network. Returns false when storage is not available. */
export function saveAgent(
  owner: string,
  network: Network,
  agent: StoredAgent,
  storage: () => AgentStorage = defaultStorage,
): boolean {
  try {
    storage().setItem(agentStorageKey(owner, network), JSON.stringify(agent));
    return true;
  } catch {
    return false;
  }
}

/** Remove the agent of an owner on a network from this browser. Never throws. */
export function clearAgent(
  owner: string,
  network: Network,
  storage: () => AgentStorage = defaultStorage,
): void {
  try {
    const store = storage();
    store.removeItem(agentStorageKey(owner, network));
    if (network === "testnet") store.removeItem(legacyAgentStorageKey(owner));
  } catch {
    // Storage is not available. Nothing to clear.
  }
}
