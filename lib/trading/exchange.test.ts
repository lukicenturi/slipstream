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

describe("trigger orders, cancel and modify (fake client)", () => {
  const SL = {
    a: 3,
    b: false,
    p: "61740",
    s: "0.01",
    r: true,
    t: { trigger: { isMarket: true, triggerPx: "68600", tpsl: "sl" } },
  } as const;
  const AGENT = "0x9148b559d614115a28b805dda4dc5bc6cd9be819";

  /** A client whose methods return or throw what the test says. */
  function fakeClient(methods: Record<string, (params: unknown) => Promise<unknown>>) {
    const calls: { method: string; params: unknown }[] = [];
    const client = new Proxy(
      { network: "testnet" },
      {
        get(target, key) {
          if (key === "network") return target.network;
          const method = methods[String(key)];
          if (!method) return undefined;
          return (params: unknown) => {
            calls.push({ method: String(key), params });
            return method(params);
          };
        },
      },
    );
    return { client, calls };
  }

  /** An SDK-like ApiRequestError that keeps the raw body. */
  function apiError(body: unknown, message = "api error") {
    return Object.assign(new Error(message), { name: "ApiRequestError", response: body });
  }

  it("sends the trigger orders with the grouping and reads every status", async () => {
    const exchange = await loadExchange({ NEXT_PUBLIC_TRADING_MODE: "testnet" });
    const { client, calls } = fakeClient({
      order: async () => ({
        status: "ok",
        response: { type: "order", data: { statuses: [{ resting: { oid: 424242 } }] } },
      }),
    });
    const results = await exchange.placeTriggerOrders(
      client as unknown as Parameters<typeof exchange.placeTriggerOrders>[0],
      [SL],
      "positionTpsl",
      AGENT,
    );
    expect(results).toEqual([{ kind: "resting", oid: 424242 }]);
    expect(calls).toEqual([
      { method: "order", params: { orders: [SL], grouping: "positionTpsl" } },
    ]);
  });

  it("returns per-order errors from the body of a thrown error", async () => {
    const exchange = await loadExchange({ NEXT_PUBLIC_TRADING_MODE: "testnet" });
    const { client } = fakeClient({
      order: async () => {
        throw apiError({
          status: "ok",
          response: {
            type: "order",
            data: { statuses: [{ resting: { oid: 1 } }, { error: "Invalid TP/SL price." }] },
          },
        });
      },
    });
    const results = await exchange.placeTriggerOrders(
      client as unknown as Parameters<typeof exchange.placeTriggerOrders>[0],
      [SL, { ...SL, t: { trigger: { ...SL.t.trigger, tpsl: "tp" } } }],
      "positionTpsl",
      AGENT,
    );
    expect(results).toEqual([
      { kind: "resting", oid: 1 },
      { kind: "error", message: "Invalid TP/SL price." },
    ]);
  });

  it("refuses a trigger order that is not reduce-only, before any request", async () => {
    const exchange = await loadExchange({ NEXT_PUBLIC_TRADING_MODE: "testnet" });
    const { client, calls } = fakeClient({ order: async () => ({}) });
    const notReduceOnly = { ...SL, r: false } as unknown as typeof SL;
    await expect(
      exchange.placeTriggerOrders(
        client as unknown as Parameters<typeof exchange.placeTriggerOrders>[0],
        [notReduceOnly],
        "positionTpsl",
        AGENT,
      ),
    ).rejects.toThrow(/reduce-only/);
    await expect(
      exchange.modifyOrder(
        client as unknown as Parameters<typeof exchange.modifyOrder>[0],
        1,
        notReduceOnly,
        AGENT,
      ),
    ).rejects.toThrow(/reduce-only/);
    expect(calls).toEqual([]);
  });

  it("cancels and reads the statuses, also from a thrown error", async () => {
    const exchange = await loadExchange({ NEXT_PUBLIC_TRADING_MODE: "testnet" });
    const body = {
      status: "ok",
      response: {
        type: "cancel",
        data: {
          statuses: ["success", { error: "Order was never placed, already canceled, or filled." }],
        },
      },
    };
    const ok = fakeClient({ cancel: async () => body });
    const cancels = [
      { a: 3, o: 1 },
      { a: 3, o: 2 },
    ];
    const statuses = await exchange.cancelOrders(
      ok.client as unknown as Parameters<typeof exchange.cancelOrders>[0],
      cancels,
      AGENT,
    );
    expect(statuses).toEqual([
      { kind: "success" },
      { kind: "error", message: "Order was never placed, already canceled, or filled." },
    ]);
    expect(ok.calls).toEqual([{ method: "cancel", params: { cancels } }]);

    const thrown = fakeClient({
      cancel: async () => {
        throw apiError(body);
      },
    });
    await expect(
      exchange.cancelOrders(
        thrown.client as unknown as Parameters<typeof exchange.cancelOrders>[0],
        cancels,
        AGENT,
      ),
    ).resolves.toHaveLength(2);
  });

  it("maps an unknown agent on cancel and an err body on modify to a TradingError", async () => {
    const exchange = await loadExchange({ NEXT_PUBLIC_TRADING_MODE: "testnet" });
    const text = `User or API Wallet ${AGENT} does not exist.`;
    const { client } = fakeClient({
      cancel: async () => {
        throw apiError({ status: "err", response: text }, text);
      },
      modify: async () => {
        throw apiError(
          { status: "err", response: "Cannot modify canceled or filled order" },
          "Cannot modify canceled or filled order",
        );
      },
    });
    await expect(
      exchange.cancelOrders(
        client as unknown as Parameters<typeof exchange.cancelOrders>[0],
        [{ a: 3, o: 1 }],
        AGENT,
      ),
    ).rejects.toMatchObject({ name: "TradingError", kind: "agent", exchangeMessage: text });
    await expect(
      exchange.modifyOrder(
        client as unknown as Parameters<typeof exchange.modifyOrder>[0],
        1,
        SL,
        AGENT,
      ),
    ).rejects.toMatchObject({
      kind: "api",
      exchangeMessage: "Cannot modify canceled or filled order",
    });
  });

  it("sends a modify of a trigger order with a: true, and accepts an ok body", async () => {
    const exchange = await loadExchange({ NEXT_PUBLIC_TRADING_MODE: "testnet" });
    const { client, calls } = fakeClient({
      modify: async () => ({ status: "ok", response: { type: "default" } }),
    });
    await expect(
      exchange.modifyOrder(
        client as unknown as Parameters<typeof exchange.modifyOrder>[0],
        424242,
        SL,
        AGENT,
      ),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([{ method: "modify", params: { oid: 424242, order: SL, a: true } }]);
  });

  it("throws on a modify body that is not ok", async () => {
    const exchange = await loadExchange({ NEXT_PUBLIC_TRADING_MODE: "testnet" });
    const run = (body: unknown) =>
      exchange.modifyOrder(
        fakeClient({ modify: async () => body }).client as unknown as Parameters<
          typeof exchange.modifyOrder
        >[0],
        1,
        SL,
        AGENT,
      );
    await expect(
      run({ status: "err", response: "Order has invalid price." }),
    ).rejects.toMatchObject({
      name: "TradingError",
      kind: "api",
      exchangeMessage: "Order has invalid price.",
    });
    // An err body about the agent maps to "agent", as a thrown SDK error does.
    await expect(
      run({ status: "err", response: `User or API Wallet ${AGENT} does not exist.` }),
    ).rejects.toMatchObject({ name: "TradingError", kind: "agent" });
    await expect(run({ status: "ok", response: { type: "order" } })).rejects.toMatchObject({
      name: "TradingError",
      message: "Unknown modify response.",
    });
    await expect(run(undefined)).rejects.toMatchObject({ message: "Unknown modify response." });
  });

  it("refuses every new function in a build without the flag", async () => {
    const exchange = await loadExchange({});
    const { client } = fakeClient({});
    const typed = client as unknown as Parameters<typeof exchange.cancelOrders>[0];
    await expect(exchange.cancelOrders(typed, [{ a: 1, o: 1 }], AGENT)).rejects.toMatchObject({
      name: "TradingDisabledError",
    });
    await expect(
      exchange.placeTriggerOrders(typed, [SL], "positionTpsl", AGENT),
    ).rejects.toMatchObject({
      name: "TradingDisabledError",
    });
    await expect(exchange.modifyOrder(typed, 1, SL, AGENT)).rejects.toMatchObject({
      name: "TradingDisabledError",
    });
  });
});
