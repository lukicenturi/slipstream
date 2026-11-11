import { describe, expect, it } from "vitest";

import {
  clampMaxOrderUsd,
  defaultTradingSettings,
  parseTradingSettings,
  sizeLimitUsd,
  tradingSettingsKey,
} from "./settings";

describe("tradingSettingsKey", () => {
  it("is scoped to the network", () => {
    expect(tradingSettingsKey("mainnet")).toBe("slipstream.trading.mainnet");
    expect(tradingSettingsKey("testnet")).toBe("slipstream.trading.testnet");
  });
});

describe("defaultTradingSettings", () => {
  it("caps mainnet at $500 and testnet at $10,000", () => {
    expect(defaultTradingSettings("mainnet")).toEqual({ maxOrderUsd: 500 });
    expect(defaultTradingSettings("testnet")).toEqual({ maxOrderUsd: 10_000 });
  });
});

describe("clampMaxOrderUsd", () => {
  it.each([
    [800, 800],
    [800.9, 800],
    [5, 10],
    [-1, 10],
    [50_000, 50_000],
    [99_999, 50_000],
    [Number.POSITIVE_INFINITY, 500],
    [Number.NaN, 500],
  ])("clamps %d to %d on mainnet", (value, expected) => {
    expect(clampMaxOrderUsd(value, "mainnet")).toBe(expected);
  });

  it("falls back to the testnet default on testnet", () => {
    expect(clampMaxOrderUsd(Number.NaN, "testnet")).toBe(10_000);
  });
});

describe("parseTradingSettings", () => {
  it("gives the defaults for a missing, broken or wrong value", () => {
    expect(parseTradingSettings(null, "mainnet")).toEqual({ maxOrderUsd: 500 });
    expect(parseTradingSettings("{bad", "mainnet")).toEqual({ maxOrderUsd: 500 });
    expect(parseTradingSettings('{"maxOrderUsd":"800"}', "mainnet")).toEqual({ maxOrderUsd: 500 });
    expect(parseTradingSettings("[]", "testnet")).toEqual({ maxOrderUsd: 10_000 });
  });

  it("keeps a valid cap and clamps one out of range", () => {
    expect(parseTradingSettings('{"maxOrderUsd":800}', "mainnet")).toEqual({ maxOrderUsd: 800 });
    expect(parseTradingSettings('{"maxOrderUsd":1000000}', "mainnet")).toEqual({
      maxOrderUsd: 50_000,
    });
    expect(parseTradingSettings('{"maxOrderUsd":1}', "testnet")).toEqual({ maxOrderUsd: 10 });
  });
});

describe("sizeLimitUsd", () => {
  it("is the cap while the balance is unknown or zero", () => {
    expect(sizeLimitUsd({ maxOrderUsd: 500, balanceUsd: undefined, leverage: 5 })).toBe(500);
    expect(sizeLimitUsd({ maxOrderUsd: 500, balanceUsd: 0, leverage: 5 })).toBe(500);
  });

  it("is at most balance x leverage, rounded down to $10", () => {
    expect(sizeLimitUsd({ maxOrderUsd: 500, balanceUsd: 1000, leverage: 5 })).toBe(500);
    expect(sizeLimitUsd({ maxOrderUsd: 10_000, balanceUsd: 1000, leverage: 5 })).toBe(5000);
    expect(sizeLimitUsd({ maxOrderUsd: 10_000, balanceUsd: 123.45, leverage: 3 })).toBe(370);
  });

  it("never goes below the $10 minimum", () => {
    expect(sizeLimitUsd({ maxOrderUsd: 500, balanceUsd: 2, leverage: 1 })).toBe(10);
  });
});
