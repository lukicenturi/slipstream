import { describe, expect, it } from "vitest";

import {
  assertTestnetTrading,
  getTradingMode,
  parseTradingMode,
  TESTNET,
  testnetExplorerUrl,
  TradingDisabledError,
} from "./config";

describe("assertTestnetTrading", () => {
  it.each([["off"], [undefined], ["mainnet"], ["TESTNET"], [""], [null], [1]])(
    "throws for %j",
    (mode) => {
      expect(() => assertTestnetTrading(mode)).toThrow(TradingDisabledError);
    },
  );

  it("passes for testnet", () => {
    expect(() => assertTestnetTrading("testnet")).not.toThrow();
  });
});

describe("parseTradingMode", () => {
  it("accepts only the exact string testnet", () => {
    expect(parseTradingMode("testnet")).toBe("testnet");
    expect(parseTradingMode("TESTNET")).toBe("off");
    expect(parseTradingMode("mainnet")).toBe("off");
    expect(parseTradingMode(" testnet")).toBe("off");
    expect(parseTradingMode(undefined)).toBe("off");
  });

  it("is off in the test build, where the variable is unset", () => {
    expect(getTradingMode()).toBe("off");
  });
});

describe("TESTNET", () => {
  it("points only at testnet hosts", () => {
    for (const url of Object.values(TESTNET)) {
      expect(new URL(url).host).toMatch(/hyperliquid-testnet\.xyz$/);
    }
    expect(testnetExplorerUrl("0xABC")).toBe(
      "https://app.hyperliquid-testnet.xyz/explorer/address/0xabc",
    );
  });
});
