import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * The order of the exchange calls of the TP / SL and trailing actions,
 * with a fake client: place first, cancel second; remove a trailing
 * config only after its cancel settles.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Load the actions module again in a testnet trading build. */
async function loadActions() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_NETWORK", "");
  vi.stubEnv("NEXT_PUBLIC_TRADING_MODE", "testnet");
  return import("./actions");
}

const AGENT = "0x9148b559d614115a28b805dda4dc5bc6cd9be819";
const TP = {
  a: 3,
  b: false,
  p: "69300",
  s: "0.01",
  r: true,
  t: { trigger: { isMarket: true, triggerPx: "77000", tpsl: "tp" } },
} as const;
const SL = {
  a: 3,
  b: false,
  p: "59850",
  s: "0.01",
  r: true,
  t: { trigger: { isMarket: true, triggerPx: "66500", tpsl: "sl" } },
} as const;
const GONE = "Order was never placed, already canceled, or filled.";

const orderBody = (...statuses: unknown[]) => ({
  status: "ok",
  response: { type: "order", data: { statuses } },
});
const cancelBody = (...statuses: unknown[]) => ({
  status: "ok",
  response: { type: "cancel", data: { statuses } },
});

/** A client that records every call (and `extra` steps) in one list, in order. */
function fakeClient(methods: Record<string, (params: unknown) => Promise<unknown>>) {
  const calls: { method: string; params?: unknown }[] = [];
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

type Client = Parameters<Awaited<ReturnType<typeof loadActions>>["placeThenCancel"]>[0];

describe("placeThenCancel", () => {
  it("places the new TP and SL first, then cancels the old ones in one request", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({
      order: async () => orderBody({ resting: { oid: 11 } }, { resting: { oid: 12 } }),
      cancel: async () => cancelBody("success", "success"),
    });
    const placedSeen: string[] = [];
    const out = await actions.placeThenCancel(client as unknown as Client, {
      assetIndex: 3,
      orders: [
        { kind: "tp", order: TP },
        { kind: "sl", order: SL },
      ],
      replace: { tp: 9001, sl: 9002 },
      grouping: "positionTpsl",
      agentAddress: AGENT,
      onPlaced: () => placedSeen.push(`placed after ${calls.length} call(s)`),
    });
    expect(calls.map((call) => call.method)).toEqual(["order", "cancel"]);
    expect(calls[0]?.params).toEqual({ orders: [TP, SL], grouping: "positionTpsl" });
    expect(calls[1]?.params).toEqual({
      cancels: [
        { a: 3, o: 9001 },
        { a: 3, o: 9002 },
      ],
    });
    expect(placedSeen).toEqual(["placed after 1 call(s)"]);
    expect(out).toEqual({
      results: { tp: { kind: "resting", oid: 11 }, sl: { kind: "resting", oid: 12 } },
      cancelled: [9001, 9002],
      replaceErrors: [],
    });
  });

  it("cancels the extra oids of a kind with its replace, in the same request", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({
      order: async () => orderBody({ resting: { oid: 12 } }),
      cancel: async () => cancelBody("success", { error: "Rate limited." }),
    });
    const out = await actions.placeThenCancel(client as unknown as Client, {
      assetIndex: 3,
      orders: [{ kind: "sl", order: SL }],
      replace: { sl: 424243 },
      alsoCancel: { sl: [424242, 424243], tp: [7] },
      grouping: "positionTpsl",
      agentAddress: AGENT,
    });
    expect(calls.map((call) => call.method)).toEqual(["order", "cancel"]);
    expect(calls[1]?.params).toEqual({
      cancels: [
        { a: 3, o: 424243 },
        { a: 3, o: 424242 },
      ],
    });
    expect(out.cancelled).toEqual([424243]);
    expect(out.replaceErrors).toMatchObject([{ kind: "sl", oid: 424242 }]);
  });

  it("sends no extra cancel when the new order of that kind is refused", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({
      order: async () => orderBody({ error: "Invalid TP/SL price." }),
      cancel: async () => cancelBody("success"),
    });
    await actions.placeThenCancel(client as unknown as Client, {
      assetIndex: 3,
      orders: [{ kind: "sl", order: SL }],
      replace: { sl: 424243 },
      alsoCancel: { sl: [424242] },
      grouping: "positionTpsl",
      agentAddress: AGENT,
    });
    expect(calls.map((call) => call.method)).toEqual(["order"]);
  });

  it("keeps the old order of a kind whose new order the exchange refused", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({
      order: async () => orderBody({ resting: { oid: 11 } }, { error: "Invalid TP/SL price." }),
      cancel: async () => cancelBody("success"),
    });
    const out = await actions.placeThenCancel(client as unknown as Client, {
      assetIndex: 3,
      orders: [
        { kind: "tp", order: TP },
        { kind: "sl", order: SL },
      ],
      replace: { tp: 9001, sl: 9002 },
      grouping: "positionTpsl",
      agentAddress: AGENT,
    });
    expect(calls[1]?.params).toEqual({ cancels: [{ a: 3, o: 9001 }] });
    expect(out.cancelled).toEqual([9001]);
    expect(out.results.sl).toEqual({ kind: "error", message: "Invalid TP/SL price." });
  });

  it("sends no cancel when every new order is refused, or when the place throws", async () => {
    const actions = await loadActions();
    const refused = fakeClient({
      order: async () => orderBody({ error: "Invalid TP/SL price." }),
      cancel: async () => cancelBody("success"),
    });
    await actions.placeThenCancel(refused.client as unknown as Client, {
      assetIndex: 3,
      orders: [{ kind: "sl", order: SL }],
      replace: { sl: 9002 },
      grouping: "normalTpsl",
      agentAddress: AGENT,
    });
    expect(refused.calls.map((call) => call.method)).toEqual(["order"]);

    const text = `User or API Wallet ${AGENT} does not exist.`;
    const thrown = fakeClient({
      order: async () => {
        throw Object.assign(new Error(text), {
          name: "ApiRequestError",
          response: { status: "err", response: text },
        });
      },
      cancel: async () => cancelBody("success"),
    });
    await expect(
      actions.placeThenCancel(thrown.client as unknown as Client, {
        assetIndex: 3,
        orders: [{ kind: "sl", order: SL }],
        replace: { sl: 9002 },
        grouping: "normalTpsl",
        agentAddress: AGENT,
      }),
    ).rejects.toMatchObject({ kind: "agent" });
    expect(thrown.calls.map((call) => call.method)).toEqual(["order"]);
  });

  it("sends the trailing stop with normalTpsl", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({
      order: async () => orderBody({ resting: { oid: 424242 } }),
    });
    await actions.placeThenCancel(client as unknown as Client, {
      assetIndex: 3,
      orders: [{ kind: "sl", order: SL }],
      replace: {},
      grouping: "normalTpsl",
      agentAddress: AGENT,
    });
    expect(calls).toEqual([{ method: "order", params: { orders: [SL], grouping: "normalTpsl" } }]);
  });

  it("counts an old order that is already gone as cancelled", async () => {
    const actions = await loadActions();
    const { client } = fakeClient({
      order: async () => orderBody({ resting: { oid: 12 } }),
      cancel: async () => cancelBody({ error: GONE }),
    });
    const out = await actions.placeThenCancel(client as unknown as Client, {
      assetIndex: 3,
      orders: [{ kind: "sl", order: SL }],
      replace: { sl: 9002 },
      grouping: "positionTpsl",
      agentAddress: AGENT,
    });
    expect(out.cancelled).toEqual([9002]);
    expect(out.replaceErrors).toEqual([]);
  });

  it("returns a visible error when the cancel fails, after the new order is on-chain", async () => {
    const actions = await loadActions();
    const failed = fakeClient({
      order: async () => orderBody({ resting: { oid: 12 } }),
      cancel: async () => cancelBody({ error: "Some other cancel error." }),
    });
    const out = await actions.placeThenCancel(failed.client as unknown as Client, {
      assetIndex: 3,
      orders: [{ kind: "sl", order: SL }],
      replace: { sl: 9002 },
      grouping: "positionTpsl",
      agentAddress: AGENT,
    });
    expect(out.results.sl).toEqual({ kind: "resting", oid: 12 });
    expect(out.cancelled).toEqual([]);
    expect(out.replaceErrors).toEqual([
      {
        kind: "sl",
        oid: 9002,
        message: "The old stop loss is still open; cancel it in Open orders.",
        exchangeMessage: "Some other cancel error.",
      },
    ]);

    const thrown = fakeClient({
      order: async () => orderBody({ resting: { oid: 11 } }),
      cancel: async () => {
        throw Object.assign(new Error("fetch failed"), { name: "TypeError" });
      },
    });
    const out2 = await actions.placeThenCancel(thrown.client as unknown as Client, {
      assetIndex: 3,
      orders: [{ kind: "tp", order: TP }],
      replace: { tp: 9001 },
      grouping: "positionTpsl",
      agentAddress: AGENT,
    });
    expect(out2.replaceErrors.map((error) => error.message)).toEqual([
      "The old take profit is still open; cancel it in Open orders.",
    ]);
  });
});

/** A reduce-only stop of BTC on the book. */
function stopOrder(oid: number, triggerPx: number) {
  return {
    coin: "BTC",
    side: "sell" as const,
    limitPx: Math.floor(triggerPx * 0.9),
    sz: 0.01,
    origSz: 0.01,
    oid,
    timestamp: 1_794_400_000_000,
    isTrigger: true,
    triggerPx,
    triggerCondition: `Price below ${triggerPx}`,
    isPositionTpsl: false,
    reduceOnly: true,
    orderType: "Stop Market",
    tif: null,
    cloid: null,
  };
}

describe("stopTrailingSteps", () => {
  const config = { coin: "BTC", assetIndex: 3, oid: 424242, stopPx: 72_520 };
  const book = async () => [stopOrder(424242, 72_520)];

  it("reads the book, cancels, and removes the config only after the cancel succeeds", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({ cancel: async () => cancelBody("success") });
    const out = await actions.stopTrailingSteps({
      config,
      cancel: true,
      client: client as unknown as Client,
      agentAddress: AGENT,
      fetchOrders: async () => {
        calls.push({ method: "fetch open orders" });
        return book();
      },
      remove: () => calls.push({ method: "remove config" }),
    });
    expect(calls.map((call) => call.method)).toEqual([
      "fetch open orders",
      "cancel",
      "remove config",
    ]);
    expect(calls[1]?.params).toEqual({ cancels: [{ a: 3, o: 424242 }] });
    expect(out).toEqual({ kind: "stopped", statuses: [{ kind: "success" }], leftover: [] });
  });

  it("in the settle window, cancels the moved stop (new oid) and the previous oid", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({
      cancel: async () => cancelBody("success", "success"),
    });
    // The config still holds the old oid; the book shows the moved stop under a new oid.
    const settling = { ...config, stopPx: 74_695, previousOid: 424242 };
    let removed = false;
    const out = await actions.stopTrailingSteps({
      config: settling,
      cancel: true,
      client: client as unknown as Client,
      agentAddress: AGENT,
      fetchOrders: async () => [
        stopOrder(424243, 74_695),
        stopOrder(424242, 72_520),
        stopOrder(5555, 63_000),
      ],
      remove: () => {
        removed = true;
      },
    });
    expect(calls).toEqual([
      {
        method: "cancel",
        params: {
          cancels: [
            { a: 3, o: 424243 },
            { a: 3, o: 424242 },
          ],
        },
      },
    ]);
    expect(removed).toBe(true);
    expect(out).toMatchObject({ kind: "stopped", leftover: [] });
  });

  it("cancels only the moved stop when the previous oid is no longer open", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({ cancel: async () => cancelBody("success") });
    await actions.stopTrailingSteps({
      config: { ...config, stopPx: 74_695, previousOid: 424242 },
      cancel: true,
      client: client as unknown as Client,
      agentAddress: AGENT,
      fetchOrders: async () => [stopOrder(424243, 74_695), stopOrder(5555, 63_000)],
      remove: () => undefined,
    });
    expect(calls[0]?.params).toEqual({ cancels: [{ a: 3, o: 424243 }] });
  });

  it("cancels the stop at the pending price of an unanswered move", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({ cancel: async () => cancelBody("success") });
    await actions.stopTrailingSteps({
      config: {
        ...config,
        previousOid: 424242,
        unsettled: true,
        pendingStopPx: 74_695,
      },
      cancel: true,
      client: client as unknown as Client,
      agentAddress: AGENT,
      fetchOrders: async () => [stopOrder(424243, 74_695)],
      remove: () => undefined,
    });
    expect(calls[0]?.params).toEqual({ cancels: [{ a: 3, o: 424243 }] });
  });

  it("reports a previous oid whose cancel failed, after it removes the config", async () => {
    const actions = await loadActions();
    const { client } = fakeClient({
      cancel: async () => cancelBody("success", { error: "Rate limited." }),
    });
    let removed = false;
    const out = await actions.stopTrailingSteps({
      config: { ...config, stopPx: 74_695, previousOid: 424242 },
      cancel: true,
      client: client as unknown as Client,
      agentAddress: AGENT,
      fetchOrders: async () => [stopOrder(424243, 74_695), stopOrder(424242, 72_520)],
      remove: () => {
        removed = true;
      },
    });
    expect(removed).toBe(true);
    expect(out).toMatchObject({ kind: "stopped", leftover: [424242] });
  });

  it("refuses and keeps the config when the book cannot be read", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({ cancel: async () => cancelBody("success") });
    let removed = false;
    await expect(
      actions.stopTrailingSteps({
        config: { ...config, previousOid: 424242 },
        cancel: true,
        client: client as unknown as Client,
        agentAddress: AGENT,
        fetchOrders: async () => {
          throw new Error("fetch failed");
        },
        remove: () => {
          removed = true;
        },
      }),
    ).rejects.toThrow("A move is settling, try again in a few seconds.");
    expect(calls).toEqual([]);
    expect(removed).toBe(false);
  });

  it("says the open orders could not be read when no move settles", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({ cancel: async () => cancelBody("success") });
    const failing = async () => {
      throw new Error("fetch failed");
    };
    const input = {
      cancel: true,
      client: client as unknown as Client,
      agentAddress: AGENT,
      fetchOrders: failing,
      remove: () => undefined,
    };
    await expect(actions.stopTrailingSteps({ ...input, config })).rejects.toThrow(
      "The open orders could not be read. Try again.",
    );
    await expect(
      actions.stopTrailingSteps({
        ...input,
        config: { ...config, unsettled: true, pendingStopPx: 74_695 },
      }),
    ).rejects.toThrow("A move is settling, try again in a few seconds.");
    expect(calls).toEqual([]);
  });

  it("cancels the stored oid when the book shows no stop, and removes the config when it is gone", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({ cancel: async () => cancelBody({ error: GONE }) });
    let removed = false;
    await actions.stopTrailingSteps({
      config,
      cancel: true,
      client: client as unknown as Client,
      agentAddress: AGENT,
      fetchOrders: async () => [],
      remove: () => {
        removed = true;
      },
    });
    expect(calls[0]?.params).toEqual({ cancels: [{ a: 3, o: 424242 }] });
    expect(removed).toBe(true);
  });

  it("keeps the config and throws when the cancel fails", async () => {
    const actions = await loadActions();
    let removed = false;
    const failed = fakeClient({ cancel: async () => cancelBody({ error: "Rate limited." }) });
    await expect(
      actions.stopTrailingSteps({
        config,
        cancel: true,
        client: failed.client as unknown as Client,
        agentAddress: AGENT,
        fetchOrders: book,
        remove: () => {
          removed = true;
        },
      }),
    ).rejects.toMatchObject({ name: "TradingError", exchangeMessage: "Rate limited." });
    const thrown = fakeClient({
      cancel: async () => {
        throw Object.assign(new Error("fetch failed"), { name: "TypeError" });
      },
    });
    await expect(
      actions.stopTrailingSteps({
        config,
        cancel: true,
        client: thrown.client as unknown as Client,
        agentAddress: AGENT,
        fetchOrders: book,
        remove: () => {
          removed = true;
        },
      }),
    ).rejects.toThrow();
    expect(removed).toBe(false);
  });

  it("removes the config at once and sends nothing without cancel", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({ cancel: async () => cancelBody("success") });
    const out = await actions.stopTrailingSteps({
      config,
      cancel: false,
      client: client as unknown as Client,
      agentAddress: AGENT,
      fetchOrders: async () => {
        calls.push({ method: "fetch open orders" });
        return [];
      },
      remove: () => calls.push({ method: "remove config" }),
    });
    expect(calls.map((call) => call.method)).toEqual(["remove config"]);
    expect(out).toEqual({ kind: "stopped", statuses: [], leftover: [] });
  });

  it("sends nothing and says already-gone when the config ended already", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({ cancel: async () => cancelBody("success") });
    for (const cancel of [true, false]) {
      const out = await actions.stopTrailingSteps({
        config: undefined,
        cancel,
        client: client as unknown as Client,
        agentAddress: AGENT,
        fetchOrders: book,
        remove: () => calls.push({ method: "remove config" }),
      });
      expect(out).toEqual({ kind: "already-gone" });
    }
    expect(calls).toEqual([]);
  });

  it("needs an agent to cancel", async () => {
    const actions = await loadActions();
    let removed = false;
    await expect(
      actions.stopTrailingSteps({
        config,
        cancel: true,
        client: null,
        agentAddress: undefined,
        fetchOrders: book,
        remove: () => {
          removed = true;
        },
      }),
    ).rejects.toThrow("Approve the agent first.");
    expect(removed).toBe(false);
  });
});

/** A trailing config of BTC in the settle window after a move to 74,695 (old oid 42 still stored). */
const SETTLING = {
  coin: "BTC",
  positionSide: "long" as const,
  trailPct: 0.02,
  assetIndex: 3,
  szDecimals: 5,
  size: 0.01,
  oid: 42,
  previousOid: 42,
  stopPx: 74_695,
  highWater: 76_220,
  createdAt: 1_794_300_000_000,
  updatedAt: 1_794_400_000_000,
  lastModifyAt: 1_794_400_000_000,
};

/** A fake trailing book that records the reads, the fetch and the drops in `calls`. */
function fakeBook(
  calls: { method: string; params?: unknown }[],
  configs: readonly (typeof SETTLING)[],
  orders: () => Promise<ReturnType<typeof stopOrder>[]>,
) {
  return {
    readConfigs: () => {
      calls.push({ method: "read configs" });
      return configs;
    },
    fetchOrders: async () => {
      calls.push({ method: "fetch open orders" });
      return orders();
    },
    drop: (coins: readonly string[]) => calls.push({ method: "drop", params: [...coins] }),
  };
}

describe("cancelOrdersSteps", () => {
  it("moved stop with new oid 43, user cancels 42: one cancel names 42 and 43, the config ends", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({
      cancel: async () => cancelBody("success", "success"),
    });
    const book = fakeBook(calls, [SETTLING], async () => [
      stopOrder(43, 74_695),
      stopOrder(42, 72_520),
      stopOrder(5555, 63_000),
    ]);
    const out = await actions.cancelOrdersSteps({
      client: client as unknown as Client,
      agentAddress: AGENT,
      assetIndex: 3,
      oids: [42],
      book,
    });
    expect(calls).toEqual([
      { method: "read configs" },
      { method: "fetch open orders" },
      {
        method: "cancel",
        params: {
          cancels: [
            { a: 3, o: 42 },
            { a: 3, o: 43 },
          ],
        },
      },
      { method: "drop", params: ["BTC"] },
    ]);
    expect(out).toEqual({ statuses: [{ kind: "success" }], leftover: [] });
  });

  it("cancels the live stop and the open previous oid when the user cancels the live stop", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({
      cancel: async () => cancelBody("success", { error: "Rate limited." }),
    });
    const book = fakeBook(calls, [SETTLING], async () => [
      stopOrder(43, 74_695),
      stopOrder(42, 72_520),
    ]);
    const out = await actions.cancelOrdersSteps({
      client: client as unknown as Client,
      agentAddress: AGENT,
      assetIndex: 3,
      oids: [43],
      book,
    });
    expect(calls.find((call) => call.method === "cancel")?.params).toEqual({
      cancels: [
        { a: 3, o: 43 },
        { a: 3, o: 42 },
      ],
    });
    expect(calls.at(-1)).toEqual({ method: "drop", params: ["BTC"] });
    // The extra status is not dropped: the old order is still open.
    expect(out).toEqual({
      statuses: [{ kind: "success" }],
      leftover: [{ oid: 42, role: "previous", exchangeMessage: "Rate limited." }],
    });
    expect(actions.cancelLeftoverText(out.leftover[0] ?? { oid: 0, role: "previous" }, "BTC")).toBe(
      "The old trailing stop order 42 is still open; cancel it in Open orders.",
    );
  });

  it("keeps the config when the cancel of the live stop fails", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({
      cancel: async () => cancelBody({ error: GONE }, { error: "Rate limited." }),
    });
    const book = fakeBook(calls, [SETTLING], async () => [stopOrder(43, 74_695)]);
    const out = await actions.cancelOrdersSteps({
      client: client as unknown as Client,
      agentAddress: AGENT,
      assetIndex: 3,
      oids: [42],
      book,
    });
    expect(calls.map((call) => call.method)).not.toContain("drop");
    expect(out.leftover).toEqual([{ oid: 43, role: "stop", exchangeMessage: "Rate limited." }]);
    expect(actions.cancelLeftoverText({ oid: 43, role: "stop" }, "BTC")).toBe(
      "The trailing stop order 43 for BTC is still open; the trailing goes on.",
    );
  });

  it("refuses and sends nothing when the book cannot be read", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({ cancel: async () => cancelBody("success") });
    const book = fakeBook(calls, [SETTLING], async () => {
      throw new Error("fetch failed");
    });
    await expect(
      actions.cancelOrdersSteps({
        client: client as unknown as Client,
        agentAddress: AGENT,
        assetIndex: 3,
        oids: [42],
        book,
      }),
    ).rejects.toThrow("The open orders could not be read. Try again.");
    expect(calls.map((call) => call.method)).toEqual(["read configs", "fetch open orders"]);
  });

  it("without a trailing config, reads no book and cancels only the asked oids", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({
      cancel: async () => cancelBody("success", "success"),
    });
    const book = fakeBook(calls, [], async () => []);
    const out = await actions.cancelOrdersSteps({
      client: client as unknown as Client,
      agentAddress: AGENT,
      assetIndex: 3,
      oids: [9001, 9002],
      book,
    });
    expect(calls.map((call) => call.method)).toEqual(["read configs", "cancel"]);
    expect(out.statuses).toHaveLength(2);
  });
});

describe("replaceTpslSteps", () => {
  it("replacing the stored oid of a settling trailing stop cancels 42 and 43 after the place, and ends it", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({
      order: async () => orderBody({ resting: { oid: 12 } }),
      cancel: async () => cancelBody("success", "success"),
    });
    const book = fakeBook(calls, [SETTLING], async () => [
      stopOrder(43, 74_695),
      stopOrder(42, 72_520),
    ]);
    const out = await actions.replaceTpslSteps(client as unknown as Client, {
      assetIndex: 3,
      orders: [{ kind: "sl", order: SL }],
      replace: { sl: 42 },
      grouping: "positionTpsl",
      agentAddress: AGENT,
      book,
    });
    expect(calls.map((call) => call.method)).toEqual([
      "read configs",
      "fetch open orders",
      "order",
      "cancel",
      "drop",
    ]);
    expect(calls[3]?.params).toEqual({
      cancels: [
        { a: 3, o: 42 },
        { a: 3, o: 43 },
      ],
    });
    expect(out.cancelled).toEqual([42, 43]);
    expect(out.endedTrailing).toEqual(["BTC"]);
  });

  it("keeps the config when the new stop is refused (nothing is cancelled)", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({
      order: async () => orderBody({ error: "Invalid TP/SL price." }),
      cancel: async () => cancelBody("success"),
    });
    const book = fakeBook(calls, [SETTLING], async () => [stopOrder(43, 74_695)]);
    const out = await actions.replaceTpslSteps(client as unknown as Client, {
      assetIndex: 3,
      orders: [{ kind: "sl", order: SL }],
      replace: { sl: 43 },
      grouping: "positionTpsl",
      agentAddress: AGENT,
      book,
    });
    expect(calls.map((call) => call.method)).toEqual([
      "read configs",
      "fetch open orders",
      "order",
    ]);
    expect(out.endedTrailing).toEqual([]);
  });

  it("refuses before any order when the book cannot be read", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({
      order: async () => orderBody({ resting: { oid: 12 } }),
    });
    const book = fakeBook(calls, [SETTLING], async () => {
      throw new Error("fetch failed");
    });
    await expect(
      actions.replaceTpslSteps(client as unknown as Client, {
        assetIndex: 3,
        orders: [{ kind: "sl", order: SL }],
        replace: { sl: 42 },
        grouping: "positionTpsl",
        agentAddress: AGENT,
        book,
      }),
    ).rejects.toThrow("The open orders could not be read. Try again.");
    expect(calls.map((call) => call.method)).not.toContain("order");
  });

  it("reads no book without a replace", async () => {
    const actions = await loadActions();
    const { client, calls } = fakeClient({
      order: async () => orderBody({ resting: { oid: 12 } }),
    });
    const book = fakeBook(calls, [SETTLING], async () => []);
    await actions.replaceTpslSteps(client as unknown as Client, {
      assetIndex: 3,
      orders: [{ kind: "tp", order: TP }],
      replace: {},
      grouping: "positionTpsl",
      agentAddress: AGENT,
      book,
    });
    expect(calls.map((call) => call.method)).toEqual(["order"]);
  });
});

describe("refuseExistingTrailing", () => {
  it("refuses a second trailing stop on a coin", async () => {
    const actions = await loadActions();
    expect(() => actions.refuseExistingTrailing([SETTLING], "BTC")).toThrow(
      "A trailing stop for BTC already exists.",
    );
    expect(() => actions.refuseExistingTrailing([SETTLING], "ETH")).not.toThrow();
    expect(() => actions.refuseExistingTrailing([], "BTC")).not.toThrow();
  });
});
