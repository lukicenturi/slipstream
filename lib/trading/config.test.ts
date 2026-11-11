import { describe, expect, it } from "vitest";

import {
  assertTestnetTrading,
  DEFAULT_NETWORK_URLS,
  getTradingMode,
  NETWORK,
  NETWORK_URLS,
  networkHost,
  networkSwitchTarget,
  otherNetwork,
  parseNetworkUrl,
  parseTradingMode,
  sharedPath,
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
