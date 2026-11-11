import { afterEach, describe, expect, it, vi } from "vitest";

import { createTradingTransport, EXCHANGE_HOSTS } from "./exchange";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("createTradingTransport (pure mode and network)", () => {
  it.each<[unknown, "mainnet" | "testnet"]>([
    ["off", "mainnet"],
    ["off", "testnet"],
    ["mainnet", "testnet"],
    ["testnet", "mainnet"],
    [undefined, "mainnet"],
    ["MAINNET", "mainnet"],
  ])("refuses mode %j on %s", (mode, network) => {
    expect(() => createTradingTransport(mode, network)).toThrow(/Trading is disabled/);
  });

  it("uses the mainnet host for mainnet on mainnet", () => {
    const transport = createTradingTransport("mainnet", "mainnet");
    expect(transport.isTestnet).toBe(false);
    expect(String(transport.apiUrl)).toBe("https://api.hyperliquid.xyz");
    expect(new URL(transport.apiUrl).host).toBe(EXCHANGE_HOSTS.mainnet);
  });

  it("uses the testnet host for testnet on testnet", () => {
    const transport = createTradingTransport("testnet", "testnet");
    expect(transport.isTestnet).toBe(true);
    expect(String(transport.apiUrl)).toBe("https://api.hyperliquid-testnet.xyz");
    expect(new URL(transport.apiUrl).host).toBe(EXCHANGE_HOSTS.testnet);
  });
});

/** Load the exchange module again, as a build with this environment would. */
async function loadExchange(env: {
  NEXT_PUBLIC_NETWORK?: string;
  NEXT_PUBLIC_TRADING_MODE?: string;
}) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_NETWORK", env.NEXT_PUBLIC_NETWORK ?? "");
  vi.stubEnv("NEXT_PUBLIC_TRADING_MODE", env.NEXT_PUBLIC_TRADING_MODE ?? "");
  return import("./exchange");
}

describe("exchange guard (build environment)", () => {
  it("refuses every client in a build without the flag", async () => {
    const exchange = await loadExchange({});
    // resetModules loads a fresh config module, so match the error by name.
    expect(() => exchange.createTradingTransport()).toThrow(
      expect.objectContaining({ name: "TradingDisabledError" }),
    );
    expect(() => exchange.createAgentClient(KEY)).toThrow(
      expect.objectContaining({ name: "TradingDisabledError" }),
    );
  });

  it("trades on mainnet in a mainnet build with NEXT_PUBLIC_TRADING_MODE=mainnet", async () => {
    const exchange = await loadExchange({ NEXT_PUBLIC_TRADING_MODE: "mainnet" });
    const transport = exchange.createTradingTransport();
    expect(transport.isTestnet).toBe(false);
    expect(String(transport.apiUrl)).toBe("https://api.hyperliquid.xyz");
    expect(exchange.createAgentClient(KEY).network).toBe("mainnet");
  });

  it("trades on testnet in a testnet build with NEXT_PUBLIC_TRADING_MODE=testnet", async () => {
    const exchange = await loadExchange({ NEXT_PUBLIC_TRADING_MODE: "testnet" });
    const transport = exchange.createTradingTransport();
    expect(transport.isTestnet).toBe(true);
    expect(String(transport.apiUrl)).toBe("https://api.hyperliquid-testnet.xyz");
    expect(exchange.createAgentClient(KEY).network).toBe("testnet");
  });

  it("refuses NEXT_PUBLIC_NETWORK=testnet without the trading flag", async () => {
    const exchange = await loadExchange({ NEXT_PUBLIC_NETWORK: "testnet" });
    expect(() => exchange.createTradingTransport()).toThrow(/Trading is disabled/);
  });

  it("refuses a mainnet flag in a testnet build", async () => {
    const exchange = await loadExchange({
      NEXT_PUBLIC_NETWORK: "testnet",
      NEXT_PUBLIC_TRADING_MODE: "mainnet",
    });
    expect(() => exchange.createTradingTransport()).toThrow(/Trading is disabled/);
    expect(() => exchange.createAgentClient(KEY)).toThrow(/Trading is disabled/);
  });

  it("refuses NEXT_PUBLIC_NETWORK=mainnet with the flag off", async () => {
    const exchange = await loadExchange({
      NEXT_PUBLIC_NETWORK: "mainnet",
      NEXT_PUBLIC_TRADING_MODE: "off",
    });
    expect(() => exchange.createTradingTransport()).toThrow(/Trading is disabled/);
  });
});
