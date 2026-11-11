import { describe, expect, it } from "vitest";

import type { Network } from "@/lib/network";

import { agentName, agentTtlMs, createAgent } from "./agent";
import { assertTradingEnabled, MIN_ORDER_USD, TRADING_LIMITS } from "./config";
import { createTradingTransport, EXCHANGE_HOSTS } from "./exchange";
import { assertWithinCap, OrderTooLargeError } from "./order";
import { clampMaxOrderUsd, defaultTradingSettings, sizeLimitUsd } from "./settings";

/*
 * Mainnet and testnet trading are at parity: the same flow, the same
 * guards, with stricter limits on mainnet. These tests use the pure
 * functions with an explicit mode and network, not the build environment.
 */

const NOW = 1_794_391_401_196;
const NETWORKS: Network[] = ["mainnet", "testnet"];

describe.each(NETWORKS)("%s trading", (network) => {
  const limits = TRADING_LIMITS[network];
  const other: Network = network === "mainnet" ? "testnet" : "mainnet";

  it("has sane limits", () => {
    expect(limits.defaultMaxOrderUsd).toBeGreaterThanOrEqual(MIN_ORDER_USD);
    expect(limits.defaultMaxOrderUsd).toBeLessThanOrEqual(limits.hardMaxOrderUsd);
    expect(limits.hardMaxOrderUsd).toBe(50_000);
    expect(limits.slippage).toBeGreaterThan(0);
    expect(limits.slippage).toBeLessThanOrEqual(0.05);
    // The exchange accepts at most 180 days.
    expect(limits.agentTtlMs).toBeGreaterThan(0);
    expect(limits.agentTtlMs).toBeLessThanOrEqual(180 * 24 * 60 * 60 * 1000);
  });

  it("names the agent within the SDK limit and with the network TTL", () => {
    const name = agentName(NOW, network);
    // The SDK checks 16 characters before the valid_until suffix.
    expect(name.split(" valid_until ")[0]?.length).toBeLessThanOrEqual(16);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(createAgent(network, NOW).validUntil).toBe(NOW + agentTtlMs(network));
  });

  it("clamps the cap and the size", () => {
    expect(defaultTradingSettings(network).maxOrderUsd).toBe(limits.defaultMaxOrderUsd);
    expect(clampMaxOrderUsd(limits.hardMaxOrderUsd + 1, network)).toBe(limits.hardMaxOrderUsd);
    const cap = limits.defaultMaxOrderUsd;
    expect(sizeLimitUsd({ maxOrderUsd: cap, balanceUsd: 1_000_000, leverage: 10 })).toBe(cap);
    expect(() => assertWithinCap(cap, cap)).not.toThrow();
    expect(() => assertWithinCap(cap + 1, cap)).toThrow(OrderTooLargeError);
  });

  it("creates a transport on its own host only under its own mode", () => {
    const transport = createTradingTransport(network, network);
    expect(new URL(transport.apiUrl).host).toBe(EXCHANGE_HOSTS[network]);
    expect(transport.isTestnet).toBe(network === "testnet");
    expect(() => createTradingTransport(other, network)).toThrow(/Trading is disabled/);
    expect(() => createTradingTransport("off", network)).toThrow(/Trading is disabled/);
    expect(() => assertTradingEnabled(network, other)).toThrow();
  });
});

describe("mainnet safeguards", () => {
  it("are stricter than testnet", () => {
    expect(TRADING_LIMITS.mainnet.defaultMaxOrderUsd).toBe(500);
    expect(TRADING_LIMITS.mainnet.defaultMaxOrderUsd).toBeLessThan(
      TRADING_LIMITS.testnet.defaultMaxOrderUsd,
    );
    expect(TRADING_LIMITS.mainnet.agentTtlMs).toBe(24 * 60 * 60 * 1000);
    expect(TRADING_LIMITS.mainnet.agentTtlMs).toBeLessThan(TRADING_LIMITS.testnet.agentTtlMs);
  });

  it("pin different hosts per network", () => {
    expect(EXCHANGE_HOSTS).toEqual({
      mainnet: "api.hyperliquid.xyz",
      testnet: "api.hyperliquid-testnet.xyz",
    });
  });
});
