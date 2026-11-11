import { afterEach, describe, expect, it, vi } from "vitest";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("exchange guard", () => {
  it("refuses every client outside a testnet build", async () => {
    vi.stubEnv("NEXT_PUBLIC_TRADING_MODE", "");
    vi.resetModules();
    const exchange = await import("./exchange");
    // resetModules loads a fresh config module, so match the error by name.
    expect(() => exchange.createTestnetTransport()).toThrow(
      expect.objectContaining({ name: "TradingDisabledError" }),
    );
    expect(() => exchange.createAgentClient(KEY)).toThrow(
      expect.objectContaining({ name: "TradingDisabledError" }),
    );
  });

  it("refuses a mainnet value of the flag", async () => {
    vi.stubEnv("NEXT_PUBLIC_TRADING_MODE", "mainnet");
    vi.resetModules();
    const exchange = await import("./exchange");
    expect(() => exchange.createTestnetTransport()).toThrow(/Trading is disabled/);
  });

  it("uses only the testnet API in a testnet build", async () => {
    vi.stubEnv("NEXT_PUBLIC_TRADING_MODE", "testnet");
    vi.resetModules();
    const exchange = await import("./exchange");
    const transport = exchange.createTestnetTransport();
    expect(transport.isTestnet).toBe(true);
    expect(String(transport.apiUrl)).toBe("https://api.hyperliquid-testnet.xyz");
    expect(exchange.createAgentClient(KEY).testnet).toBe(true);
  });
});
