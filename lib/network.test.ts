import { afterEach, describe, expect, it, vi } from "vitest";

import { ENDPOINTS, parseNetwork, type Network } from "./network";

/*
 * The network decides every data source. These tests load the modules
 * again with each environment and check that the info URL, the socket URL,
 * the leaderboard file and the explorer links all follow lib/network.ts.
 */

const { cacheKeys } = vi.hoisted(() => ({ cacheKeys: [] as unknown[] }));

// leaderboard-server.ts is server-only and wraps its download in unstable_cache.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: <F>(fn: F, keys: unknown) => {
    cacheKeys.push(keys);
    return fn;
  },
}));

type BuildEnv = { NEXT_PUBLIC_NETWORK?: string; NEXT_PUBLIC_TRADING_MODE?: string };

/** Load the modules again, as a build with this environment would. */
async function loadBuild(env: BuildEnv) {
  vi.resetModules();
  cacheKeys.length = 0;
  vi.stubEnv("NEXT_PUBLIC_NETWORK", env.NEXT_PUBLIC_NETWORK ?? "");
  vi.stubEnv("NEXT_PUBLIC_TRADING_MODE", env.NEXT_PUBLIC_TRADING_MODE ?? "");
  return {
    network: await import("./network"),
    config: await import("./trading/config"),
    client: await import("./hyperliquid/client"),
    ws: await import("./hyperliquid/ws"),
    leaderboard: await import("./hyperliquid/leaderboard-server"),
  };
}

/** A fetch that records the URL and then fails, so no request leaves the test. */
function stubFetch() {
  const fetchMock = vi.fn(async (input: unknown) => {
    void input;
    throw new Error("offline");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("parseNetwork", () => {
  it.each([
    [undefined, undefined, "mainnet"],
    ["", "", "mainnet"],
    ["mainnet", undefined, "mainnet"],
    ["testnet", undefined, "testnet"],
    [undefined, "testnet", "testnet"],
    ["mainnet", "testnet", "testnet"],
    ["testnet", "off", "testnet"],
    ["TESTNET", "Testnet", "mainnet"],
    [undefined, "mainnet", "mainnet"],
    ["testnet", "mainnet", "testnet"],
    [" testnet", undefined, "mainnet"],
  ])("NEXT_PUBLIC_NETWORK=%j, NEXT_PUBLIC_TRADING_MODE=%j gives %s", (network, mode, expected) => {
    expect(parseNetwork(network, mode)).toBe(expected);
  });
});

describe("ENDPOINTS", () => {
  it("keeps every testnet URL on testnet and every mainnet URL off it", () => {
    const urls = (network: Network): string[] =>
      (
        [
          ENDPOINTS[network].infoUrl,
          ENDPOINTS[network].wsUrl,
          ENDPOINTS[network].leaderboardUrl,
          ENDPOINTS[network].appUrl,
          ENDPOINTS[network].explorerUrl,
          ENDPOINTS[network].faucetUrl,
        ] as (string | null)[]
      ).filter((url): url is string => url !== null);
    for (const url of urls("testnet")) expect(url.toLowerCase()).toContain("testnet");
    for (const url of urls("mainnet")) expect(url.toLowerCase()).not.toContain("testnet");
    expect(urls("mainnet").map((url) => new URL(url).host)).toEqual([
      "api.hyperliquid.xyz",
      "api.hyperliquid.xyz",
      "stats-data.hyperliquid.xyz",
      "app.hyperliquid.xyz",
      "app.hyperliquid.xyz",
    ]);
    expect(ENDPOINTS.testnet.leaderboardUrl).toBe(
      "https://stats-data.hyperliquid.xyz/Testnet/leaderboard",
    );
    expect(ENDPOINTS.mainnet.faucetUrl).toBeNull();
  });
});

describe.each<[string, BuildEnv, Network, boolean]>([
  ["no variable", {}, "mainnet", false],
  ["NEXT_PUBLIC_TRADING_MODE=testnet", { NEXT_PUBLIC_TRADING_MODE: "testnet" }, "testnet", true],
  ["NEXT_PUBLIC_TRADING_MODE=mainnet", { NEXT_PUBLIC_TRADING_MODE: "mainnet" }, "mainnet", true],
  ["NEXT_PUBLIC_NETWORK=testnet", { NEXT_PUBLIC_NETWORK: "testnet" }, "testnet", false],
  [
    "NEXT_PUBLIC_NETWORK=testnet, NEXT_PUBLIC_TRADING_MODE=testnet",
    { NEXT_PUBLIC_NETWORK: "testnet", NEXT_PUBLIC_TRADING_MODE: "testnet" },
    "testnet",
    true,
  ],
  [
    "NEXT_PUBLIC_NETWORK=testnet, NEXT_PUBLIC_TRADING_MODE=mainnet",
    { NEXT_PUBLIC_NETWORK: "testnet", NEXT_PUBLIC_TRADING_MODE: "mainnet" },
    "testnet",
    false,
  ],
  [
    "NEXT_PUBLIC_NETWORK=mainnet, trading off",
    { NEXT_PUBLIC_NETWORK: "mainnet", NEXT_PUBLIC_TRADING_MODE: "off" },
    "mainnet",
    false,
  ],
])("a build with %s", (_name, env, expected, trades) => {
  it(`is a ${expected} build`, async () => {
    const { network, config } = await loadBuild(env);
    expect(network.NETWORK).toBe(expected);
    expect(network.HL).toEqual(ENDPOINTS[expected]);
    expect(config.NETWORK).toBe(expected);
  });

  it(`${trades ? "trades" : "does not trade"}: the mode must equal the network`, async () => {
    const { config } = await loadBuild(env);
    expect(config.TRADING_ENABLED).toBe(trades);
    expect(config.getTradingMode()).toBe(config.parseTradingMode(env.NEXT_PUBLIC_TRADING_MODE));
    expect(config.TRADING).toEqual(ENDPOINTS[expected]);
  });

  it("exports the info, socket and leaderboard URLs of HL", async () => {
    const { network, client, ws, leaderboard } = await loadBuild(env);
    expect(client.INFO_URL).toBe(network.HL.infoUrl);
    expect(ws.WS_URL).toBe(network.HL.wsUrl);
    expect(leaderboard.RAW_LEADERBOARD_URL).toBe(network.HL.leaderboardUrl);
    expect(cacheKeys).toEqual([["leaderboard-top100", expected]]);
  });

  it("sends info requests to the network's info URL", async () => {
    const { network, client } = await loadBuild(env);
    const fetchMock = stubFetch();
    await expect(client.getUserFills("0xABC")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(network.HL.infoUrl);
  });

  it("downloads the network's leaderboard file", async () => {
    const { network, leaderboard } = await loadBuild(env);
    const fetchMock = stubFetch();
    await expect(leaderboard.getTopLeaderboard()).rejects.toThrow();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(network.HL.leaderboardUrl);
  });

  it("opens the shared socket on the network's socket URL", async () => {
    const { network, ws } = await loadBuild(env);
    const opened: string[] = [];
    const socket = new ws.HyperliquidSocket({
      createSocket: (url) => {
        opened.push(url);
        return {
          readyState: 0,
          onopen: null,
          onclose: null,
          onerror: null,
          onmessage: null,
          send: () => undefined,
          close: () => undefined,
        };
      },
    });
    const unsubscribe = socket.subscribe({ type: "allMids" }, () => undefined);
    expect(opened).toEqual([network.HL.wsUrl]);
    unsubscribe();
  });

  it("links the explorer of the network", async () => {
    const { network } = await loadBuild(env);
    const url = new URL(network.explorerAddressUrl("0xABC"));
    expect(url.host).toBe(
      expected === "testnet" ? "app.hyperliquid-testnet.xyz" : "app.hyperliquid.xyz",
    );
    expect(url.pathname).toBe("/explorer/address/0xabc");
  });
});
