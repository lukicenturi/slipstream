import { describe, expect, it } from "vitest";

import {
  AGENT_TTL_MS,
  agentName,
  agentStorageKey,
  clearAgent,
  createAgent,
  loadAgent,
  parseStoredAgent,
  saveAgent,
  type AgentStorage,
} from "./agent";

const OWNER = "0xF5082A22bDDBB83D94c7c563f39cCE60Fee4C28E";
const NOW = 1_794_391_401_196;

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
  it("is scoped to testnet and the lower-case owner", () => {
    expect(agentStorageKey(OWNER)).toBe(
      "slipstream.testnet.agent.0xf5082a22bddbb83d94c7c563f39cce60fee4c28e",
    );
  });
});

describe("agentName", () => {
  it("adds a 30-day valid_until suffix in ms", () => {
    expect(agentName(NOW)).toBe(`slipstream valid_until ${NOW + AGENT_TTL_MS}`);
  });
});

describe("createAgent", () => {
  it("creates a key whose address matches", () => {
    const agent = createAgent(NOW);
    expect(agent.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(parseStoredAgent(JSON.stringify(agent), NOW)).toEqual(agent);
    expect(agent.validUntil).toBe(NOW + AGENT_TTL_MS);
  });
});

describe("parseStoredAgent", () => {
  const agent = createAgent(NOW);

  it("returns null for missing, bad JSON and a wrong shape", () => {
    expect(parseStoredAgent(null, NOW)).toBeNull();
    expect(parseStoredAgent("{not json", NOW)).toBeNull();
    expect(parseStoredAgent(JSON.stringify({ ...agent, privateKey: "0x12" }), NOW)).toBeNull();
    expect(parseStoredAgent(JSON.stringify([agent]), NOW)).toBeNull();
  });

  it("returns null when the address does not belong to the key", () => {
    const other = createAgent(NOW);
    expect(parseStoredAgent(JSON.stringify({ ...agent, address: other.address }), NOW)).toBeNull();
  });

  it("returns null after the agent expired", () => {
    expect(parseStoredAgent(JSON.stringify(agent), agent.validUntil)).toBeNull();
    expect(parseStoredAgent(JSON.stringify(agent), agent.validUntil - 1)).toEqual(agent);
  });
});

describe("loadAgent, saveAgent, clearAgent", () => {
  it("round-trips through storage per owner", () => {
    const storage = memoryStorage();
    const agent = createAgent(NOW);
    expect(saveAgent(OWNER, agent, () => storage)).toBe(true);
    expect(loadAgent(OWNER.toLowerCase(), () => storage, NOW)).toEqual(agent);
    expect(loadAgent("0x0000000000000000000000000000000000000001", () => storage, NOW)).toBeNull();
    clearAgent(OWNER, () => storage);
    expect(loadAgent(OWNER, () => storage, NOW)).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it("never throws when storage is blocked", () => {
    const agent = createAgent(NOW);
    expect(loadAgent(OWNER, throwingStorage, NOW)).toBeNull();
    expect(saveAgent(OWNER, agent, throwingStorage)).toBe(false);
    expect(() => clearAgent(OWNER, throwingStorage)).not.toThrow();
  });
});
