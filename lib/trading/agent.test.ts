import { describe, expect, it } from "vitest";

import {
  agentName,
  agentRemainingMs,
  agentStorageKey,
  agentTtlMs,
  clearAgent,
  createAgent,
  formatRemaining,
  isAgentStorageKey,
  loadAgent,
  parseStoredAgent,
  saveAgent,
  type AgentStorage,
} from "./agent";

const OWNER = "0xF5082A22bDDBB83D94c7c563f39cCE60Fee4C28E";
const OWNER_LOWER = OWNER.toLowerCase();
const NOW = 1_794_391_401_196;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const LEGACY_KEY = `slipstream.testnet.agent.${OWNER_LOWER}`;

function memoryStorage(): AgentStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const throwingStorage = (): AgentStorage => {
  throw new Error("SecurityError");
};

describe("agentStorageKey", () => {
  it("is scoped to the network and the lower-case owner", () => {
    expect(agentStorageKey(OWNER, "testnet")).toBe(`slipstream.agent.testnet.${OWNER_LOWER}`);
    expect(agentStorageKey(OWNER, "mainnet")).toBe(`slipstream.agent.mainnet.${OWNER_LOWER}`);
  });

  it("recognises current and legacy agent keys", () => {
    expect(isAgentStorageKey(agentStorageKey(OWNER, "mainnet"))).toBe(true);
    expect(isAgentStorageKey(LEGACY_KEY)).toBe(true);
    expect(isAgentStorageKey("slipstream.watchlist")).toBe(false);
  });
});

describe("agentTtlMs and agentName", () => {
  it("lives 24 h on mainnet and 7 days on testnet", () => {
    expect(agentTtlMs("mainnet")).toBe(DAY);
    expect(agentTtlMs("testnet")).toBe(7 * DAY);
  });

  it("adds a valid_until suffix in ms", () => {
    expect(agentName(NOW, "mainnet")).toBe(`slipstream valid_until ${NOW + DAY}`);
    expect(agentName(NOW, "testnet")).toBe(`slipstream valid_until ${NOW + 7 * DAY}`);
  });
});

describe("createAgent", () => {
  it.each([["mainnet" as const], ["testnet" as const]])(
    "creates a %s key whose address matches",
    (network) => {
      const agent = createAgent(network, NOW);
      expect(agent.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
      expect(parseStoredAgent(JSON.stringify(agent), NOW)).toEqual(agent);
      expect(agent.validUntil).toBe(NOW + agentTtlMs(network));
      expect(agent.name).toBe(agentName(NOW, network));
    },
  );
});

describe("agentRemainingMs and formatRemaining", () => {
  it("counts down to 0", () => {
    const agent = createAgent("mainnet", NOW);
    expect(agentRemainingMs(agent, NOW)).toBe(DAY);
    expect(agentRemainingMs(agent, NOW + DAY + 1)).toBe(0);
  });

  it.each([
    [0, "0 min"],
    [59 * 60_000, "59 min"],
    [HOUR, "1 h"],
    [23 * HOUR + 59 * 60_000, "23 h"],
    [47 * HOUR, "47 h"],
    [48 * HOUR, "2 days"],
    [7 * DAY - 1, "6 days"],
  ])("formats %d ms as %s", (ms, text) => {
    expect(formatRemaining(ms)).toBe(text);
  });
});

describe("parseStoredAgent", () => {
  const agent = createAgent("testnet", NOW);

  it("returns null for missing, bad JSON and a wrong shape", () => {
    expect(parseStoredAgent(null, NOW)).toBeNull();
    expect(parseStoredAgent("{not json", NOW)).toBeNull();
    expect(parseStoredAgent(JSON.stringify({ ...agent, privateKey: "0x12" }), NOW)).toBeNull();
    expect(parseStoredAgent(JSON.stringify([agent]), NOW)).toBeNull();
  });

  it("returns null when the address does not belong to the key", () => {
    const other = createAgent("testnet", NOW);
    expect(parseStoredAgent(JSON.stringify({ ...agent, address: other.address }), NOW)).toBeNull();
  });

  it("returns null after the agent expired", () => {
    expect(parseStoredAgent(JSON.stringify(agent), agent.validUntil)).toBeNull();
    expect(parseStoredAgent(JSON.stringify(agent), agent.validUntil - 1)).toEqual(agent);
  });
});

describe("loadAgent, saveAgent, clearAgent", () => {
  it("round-trips through storage per owner and network", () => {
    const storage = memoryStorage();
    const agent = createAgent("mainnet", NOW);
    expect(saveAgent(OWNER, "mainnet", agent, () => storage)).toBe(true);
    expect(loadAgent(OWNER_LOWER, "mainnet", () => storage, NOW)).toEqual(agent);
    expect(loadAgent(OWNER, "testnet", () => storage, NOW)).toBeNull();
    expect(
      loadAgent("0x0000000000000000000000000000000000000001", "mainnet", () => storage, NOW),
    ).toBeNull();
    clearAgent(OWNER, "mainnet", () => storage);
    expect(loadAgent(OWNER, "mainnet", () => storage, NOW)).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it("moves a legacy testnet agent to the new key once", () => {
    const storage = memoryStorage();
    const agent = createAgent("testnet", NOW);
    storage.data.set(LEGACY_KEY, JSON.stringify(agent));
    expect(loadAgent(OWNER, "testnet", () => storage, NOW)).toEqual(agent);
    expect(storage.data.has(LEGACY_KEY)).toBe(false);
    expect(storage.data.get(agentStorageKey(OWNER, "testnet"))).toBe(JSON.stringify(agent));
    expect(loadAgent(OWNER, "testnet", () => storage, NOW)).toEqual(agent);
  });

  it("never reads the legacy testnet key on mainnet", () => {
    const storage = memoryStorage();
    storage.data.set(LEGACY_KEY, JSON.stringify(createAgent("testnet", NOW)));
    expect(loadAgent(OWNER, "mainnet", () => storage, NOW)).toBeNull();
    expect(storage.data.has(LEGACY_KEY)).toBe(true);
  });

  it("drops an expired or broken legacy agent", () => {
    const storage = memoryStorage();
    storage.data.set(LEGACY_KEY, "{broken");
    expect(loadAgent(OWNER, "testnet", () => storage, NOW)).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it("clears the legacy key too on testnet", () => {
    const storage = memoryStorage();
    storage.data.set(LEGACY_KEY, JSON.stringify(createAgent("testnet", NOW)));
    clearAgent(OWNER, "testnet", () => storage);
    expect(storage.data.size).toBe(0);
  });

  it("never throws when storage is blocked", () => {
    const agent = createAgent("testnet", NOW);
    expect(loadAgent(OWNER, "testnet", throwingStorage, NOW)).toBeNull();
    expect(saveAgent(OWNER, "testnet", agent, throwingStorage)).toBe(false);
    expect(() => clearAgent(OWNER, "testnet", throwingStorage)).not.toThrow();
  });
});
