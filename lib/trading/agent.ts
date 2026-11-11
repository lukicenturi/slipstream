import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

/*
 * The Slipstream agent key (a Hyperliquid "API wallet").
 *
 * The browser generates this key. The user's main wallet approves it once
 * with one signature. After that, the agent signs orders and leverage
 * changes for that account on testnet. An agent can trade but cannot
 * withdraw or transfer funds. The key lives only in this browser's
 * localStorage, under a key scoped to testnet and to the owner address.
 * The user's own wallet key is never asked for and never stored.
 */

export const AGENT_STORAGE_PREFIX = "slipstream.testnet.agent.";
/** The agent expires on the exchange after 30 days (the maximum is 180). */
export const AGENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
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

export function agentStorageKey(owner: string): string {
  return `${AGENT_STORAGE_PREFIX}${owner.toLowerCase()}`;
}

/**
 * The agentName for approveAgent: "slipstream valid_until <ms>". The suffix
 * sets the expiry on the exchange. The SDK checks the 16-character limit on
 * the part before the suffix.
 */
export function agentName(now: number): string {
  return `${AGENT_BASE_NAME} valid_until ${now + AGENT_TTL_MS}`;
}

/** A new agent key. Nothing is stored until the approval succeeds. */
export function createAgent(now: number = Date.now()): StoredAgent {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    privateKey,
    address: account.address,
    name: agentName(now),
    createdAt: now,
    validUntil: now + AGENT_TTL_MS,
  };
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

/** The stored agent of an owner, or null. Never throws. */
export function loadAgent(
  owner: string,
  storage: () => AgentStorage = defaultStorage,
  now: number = Date.now(),
): StoredAgent | null {
  try {
    return parseStoredAgent(storage().getItem(agentStorageKey(owner)), now);
  } catch {
    return null;
  }
}

/** Store the agent of an owner. Returns false when storage is not available. */
export function saveAgent(
  owner: string,
  agent: StoredAgent,
  storage: () => AgentStorage = defaultStorage,
): boolean {
  try {
    storage().setItem(agentStorageKey(owner), JSON.stringify(agent));
    return true;
  } catch {
    return false;
  }
}

/** Remove the agent of an owner from this browser. Never throws. */
export function clearAgent(owner: string, storage: () => AgentStorage = defaultStorage): void {
  try {
    storage().removeItem(agentStorageKey(owner));
  } catch {
    // Storage is not available. Nothing to clear.
  }
}
