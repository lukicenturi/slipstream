import { describe, expect, it } from "vitest";

import { ENDPOINTS } from "@/lib/network";

import {
  assertTradingEnabled,
  DEFAULT_NETWORK_URLS,
  getTradingMode,
  isTradingEnabled,
  NETWORK,
  NETWORK_URLS,
  networkHost,
  networkSwitchTarget,
  otherNetwork,
  parseNetworkUrl,
  parseTradingMode,
  sharedPath,
  TRADING,
  TRADING_ENABLED,
  TRADING_LIMITS,
  TradingDisabledError,
} from "./config";

describe("assertTradingEnabled", () => {
  it.each<[unknown, unknown]>([
    ["off", "mainnet"],
    ["off", "testnet"],
    [undefined, "mainnet"],
    ["mainnet", "testnet"],
    ["testnet", "mainnet"],
    ["TESTNET", "testnet"],
    ["MAINNET", "mainnet"],
    ["", "mainnet"],
    [null, null],
    ["off", "off"],
    [1, "mainnet"],
  ])("throws for mode %j on %j", (mode, network) => {
    expect(() => assertTradingEnabled(mode, network)).toThrow(TradingDisabledError);
  });

  it.each([["testnet"], ["mainnet"]])("passes when the mode is %s on the same network", (net) => {
    expect(() => assertTradingEnabled(net, net)).not.toThrow();
  });
});

describe("isTradingEnabled", () => {
  it("is true only when the mode names the network", () => {
    expect(isTradingEnabled("mainnet", "mainnet")).toBe(true);
    expect(isTradingEnabled("testnet", "testnet")).toBe(true);
    expect(isTradingEnabled("mainnet", "testnet")).toBe(false);
    expect(isTradingEnabled("testnet", "mainnet")).toBe(false);
    expect(isTradingEnabled("off", "mainnet")).toBe(false);
    expect(isTradingEnabled("off", "testnet")).toBe(false);
  });
});

describe("parseTradingMode", () => {
  it("accepts only the exact strings testnet and mainnet", () => {
    expect(parseTradingMode("testnet")).toBe("testnet");
    expect(parseTradingMode("mainnet")).toBe("mainnet");
    expect(parseTradingMode("TESTNET")).toBe("off");
    expect(parseTradingMode("Mainnet")).toBe("off");
    expect(parseTradingMode(" testnet")).toBe("off");
    expect(parseTradingMode("on")).toBe("off");
    expect(parseTradingMode(undefined)).toBe("off");
  });

  it("is off in the test build, where the variable is unset", () => {
    expect(getTradingMode()).toBe("off");
    expect(TRADING_ENABLED).toBe(false);
  });
});

describe("TRADING", () => {
  it("is the endpoint table of the build's network", () => {
    expect(TRADING).toBe(ENDPOINTS[NETWORK]);
    expect(ENDPOINTS.testnet.faucetUrl).toBe("https://app.hyperliquid-testnet.xyz/drip");
    expect(ENDPOINTS.mainnet.faucetUrl).toBeNull();
  });
});

describe("TRADING_LIMITS", () => {
  it("has the planned safeguards per network", () => {
    expect(TRADING_LIMITS.mainnet).toEqual({
      defaultMaxOrderUsd: 500,
      hardMaxOrderUsd: 50_000,
      agentTtlMs: 24 * 60 * 60 * 1000,
      slippage: 0.01,
    });
    expect(TRADING_LIMITS.testnet).toEqual({
      defaultMaxOrderUsd: 10_000,
      hardMaxOrderUsd: 50_000,
      agentTtlMs: 7 * 24 * 60 * 60 * 1000,
      slippage: 0.01,
    });
  });
});

describe("network URLs", () => {
  it("defaults to the two Slipstream hosts when the variables are unset", () => {
    expect(DEFAULT_NETWORK_URLS).toEqual({
      mainnet: "https://slipstream-hl.vercel.app",
      testnet: "https://slipstream-testnet.vercel.app",
    });
    expect(NETWORK_URLS).toEqual(DEFAULT_NETWORK_URLS);
  });

  it("is mainnet in the test build, where trading is off", () => {
    expect(NETWORK).toBe("mainnet");
    expect(otherNetwork("mainnet")).toBe("testnet");
    expect(otherNetwork("testnet")).toBe("mainnet");
  });

  it("keeps only the origin of a valid http(s) URL", () => {
    const fallback = "https://fallback.example";
    expect(parseNetworkUrl("https://preview.example.com/", fallback)).toBe(
      "https://preview.example.com",
    );
    expect(parseNetworkUrl(" http://localhost:3100/x?y=1 ", fallback)).toBe(
      "http://localhost:3100",
    );
  });

  it.each([
    [undefined],
    [""],
    ["   "],
    ["not a url"],
    ["ftp://example.com"],
    ["javascript:alert(1)"],
  ])("falls back for %j", (value) => {
    expect(parseNetworkUrl(value, "https://fallback.example")).toBe("https://fallback.example");
  });

  it("gives the host for link text", () => {
    expect(networkHost("https://slipstream-testnet.vercel.app")).toBe(
      "slipstream-testnet.vercel.app",
    );
  });
});

describe("sharedPath", () => {
  it.each([
    ["/", "/"],
    ["/?view=live", "/?view=live"],
    ["/?view=leaderboard", "/"],
    ["/?view=live&x=1", "/?view=live"],
    ["/watchlist", "/watchlist"],
    ["/watchlist?view=live", "/watchlist"],
    ["/account", "/account"],
    ["/account?x=1", "/account"],
    ["/account/extra", "/"],
    [
      "/trader/0xf5d81a135f756ca16544e53c20fc20643ec3ad53",
      "/trader/0xf5d81a135f756ca16544e53c20fc20643ec3ad53",
    ],
    ["/trader/0x123", "/trader/0x123"],
    ["/trader/", "/"],
    ["/trader/0xabc/extra", "/"],
    ["/dev", "/"],
    ["/api/leaderboard", "/"],
    ["", "/"],
  ])("maps %j to %j", (path, expected) => {
    expect(sharedPath(path)).toBe(expected);
  });
});

describe("networkSwitchTarget", () => {
  const urls = DEFAULT_NETWORK_URLS;

  it("links mainnet to the testnet host with the same path", () => {
    expect(networkSwitchTarget("mainnet", urls, "/")).toEqual({
      label: "Testnet",
      href: "https://slipstream-testnet.vercel.app/",
    });
    expect(networkSwitchTarget("mainnet", urls, "/watchlist").href).toBe(
      "https://slipstream-testnet.vercel.app/watchlist",
    );
    expect(
      networkSwitchTarget("mainnet", urls, "/trader/0xf5d81a135f756ca16544e53c20fc20643ec3ad53")
        .href,
    ).toBe(
      "https://slipstream-testnet.vercel.app/trader/0xf5d81a135f756ca16544e53c20fc20643ec3ad53",
    );
  });

  it("links testnet to the mainnet host and keeps ?view=live", () => {
    expect(networkSwitchTarget("testnet", urls, "/?view=live")).toEqual({
      label: "Mainnet",
      href: "https://slipstream-hl.vercel.app/?view=live",
    });
  });

  it("falls back to / for a path that only one host has", () => {
    expect(networkSwitchTarget("testnet", urls, "/dev").href).toBe(
      "https://slipstream-hl.vercel.app/",
    );
  });

  it("does not double the slash when a URL ends with one", () => {
    const withSlash = { mainnet: "https://a.example/", testnet: "https://b.example//" };
    expect(networkSwitchTarget("mainnet", withSlash, "/watchlist").href).toBe(
      "https://b.example/watchlist",
    );
    expect(networkSwitchTarget("testnet", withSlash, "/").href).toBe("https://a.example/");
  });
});
