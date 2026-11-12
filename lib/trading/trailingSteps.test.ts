import { describe, expect, it } from "vitest";

import type { OpenOrder } from "@/lib/hyperliquid/schemas";

import { TradingError } from "./errors";
import type { CancelStatus } from "./openOrders";
import type { TriggerOrder } from "./tpsl";
import { TRAIL_MIN_INTERVAL_MS, type TrailingConfig } from "./trailing";
import {
  CLEANUP_PENDING_WARN_MS,
  moveStep,
  reconcileStep,
  watchCleanupPending,
  type MoveInput,
  type TrailingEvent,
  type TrailingStepDeps,
} from "./trailingSteps";

/*
 * The tracker steps with fakes for storage, the exchange, the info
 * endpoint and the clock. Every call goes into one list, in order.
 */

const T0 = 1_794_400_000_000;
const LATER = T0 + TRAIL_MIN_INTERVAL_MS + 1_000;
const GONE = "Order was never placed, already canceled, or filled.";

const LONG: TrailingConfig = {
  coin: "BTC",
  positionSide: "long",
  trailPct: 0.02,
  assetIndex: 3,
  szDecimals: 5,
  size: 0.01,
  oid: 424242,
  stopPx: 68_600,
  highWater: 70_000,
  createdAt: T0,
  updatedAt: T0,
  lastModifyAt: T0,
};

function order(partial: Partial<OpenOrder>): OpenOrder {
  return {
    coin: "BTC",
    side: "sell",
    limitPx: 61_740,
    sz: 0.01,
    origSz: 0.01,
    oid: 1,
    timestamp: T0,
    isTrigger: true,
    triggerPx: 68_600,
    triggerCondition: "Price below 68600",
    isPositionTpsl: false,
    reduceOnly: true,
    orderType: "Stop Market",
    tif: null,
    cloid: null,
    ...partial,
  };
}

type Call =
  | { fn: "read" }
  | { fn: "save"; config: TrailingConfig }
  | { fn: "remove" }
  | { fn: "modify"; oid: number; order: TriggerOrder }
  | { fn: "cancel"; a: number; o: number }
  | { fn: "fetchOrders" };

interface FakeOptions {
  config?: TrailingConfig;
  orders?: OpenOrder[] | Error;
  modify?: (oid: number) => Promise<void>;
  cancel?: () => Promise<CancelStatus | undefined>;
  now?: number;
  /** A clock that can move between calls (wins over `now`). */
  clock?: () => number;
}

/** Fake deps over an in-memory config; `stored()` gives the config after the step. */
function fakeDeps(options: FakeOptions) {
  const calls: Call[] = [];
  let stored = options.config;
  const deps: TrailingStepDeps = {
    read: () => {
      calls.push({ fn: "read" });
      return stored;
    },
    save: (config) => {
      calls.push({ fn: "save", config });
      stored = config;
    },
    remove: () => {
      calls.push({ fn: "remove" });
      stored = undefined;
    },
    modify: async (oid, sent) => {
      calls.push({ fn: "modify", oid, order: sent });
      await (options.modify?.(oid) ?? Promise.resolve());
    },
    cancel: async ({ a, o }) => {
      calls.push({ fn: "cancel", a, o });
      return options.cancel ? options.cancel() : { kind: "success" };
    },
    fetchOrders: async () => {
      calls.push({ fn: "fetchOrders" });
      if (options.orders instanceof Error) throw options.orders;
      return options.orders ?? [];
    },
    now: () => options.clock?.() ?? options.now ?? LATER,
  };
  return { deps, calls, stored: () => stored };
}

function input(mid: number, extra: Partial<MoveInput> = {}): MoveInput {
  return { mid, bestSeen: () => undefined, liveSize: () => undefined, ...extra };
}

const fns = (calls: readonly Call[]) => calls.map((call) => call.fn);

describe("moveStep", () => {
  it("reads, fetches the open orders once, modifies, then stores the new stop with previousOid", async () => {
    const fake = fakeDeps({ config: LONG, orders: [order({ oid: 424242 })] });
    const events = await moveStep(fake.deps, input(72_100));
    expect(fns(fake.calls)).toEqual(["read", "fetchOrders", "modify", "save"]);
    const modify = fake.calls[2];
    expect(modify).toMatchObject({
      fn: "modify",
      oid: 424242,
      order: {
        a: 3,
        b: false,
        s: "0.01",
        r: true,
        t: { trigger: { isMarket: true, triggerPx: "70658", tpsl: "sl" } },
      },
    });
    expect(fake.stored()).toEqual({
      ...LONG,
      stopPx: 70_658,
      highWater: 72_100,
      updatedAt: LATER,
      lastModifyAt: LATER,
      previousOid: 424242,
    });
    expect(events).toEqual([{ kind: "moved", oid: 424242, from: 68_600, to: 70_658 }]);
  });

  it("sends nothing and fetches nothing without a config or without a better stop", async () => {
    const none = fakeDeps({});
    expect(await moveStep(none.deps, input(72_100))).toEqual([
      { kind: "skipped", reason: "no-config" },
    ]);
    const lower = fakeDeps({ config: LONG });
    expect(await moveStep(lower.deps, input(66_000))).toEqual([
      { kind: "skipped", reason: "no-move" },
    ]);
    expect(fns(lower.calls)).toEqual(["read"]);
  });

  it("uses the config read from storage: a move by another tab a moment ago holds this one", async () => {
    const fake = fakeDeps({
      config: { ...LONG, stopPx: 70_658, highWater: 72_100, lastModifyAt: LATER - 1_000 },
    });
    expect(await moveStep(fake.deps, input(72_500))).toEqual([
      { kind: "skipped", reason: "no-move" },
    ]);
    expect(fns(fake.calls)).toEqual(["read"]);
  });

  it("skips the move when the open orders cannot be read", async () => {
    const fake = fakeDeps({ config: LONG, orders: new Error("fetch failed") });
    expect(await moveStep(fake.deps, input(72_100))).toEqual([
      { kind: "skipped", reason: "fetch-failed" },
    ]);
    expect(fns(fake.calls)).toEqual(["read", "fetchOrders"]);
  });

  it("refuses a candidate that is not better than the fresh on-chain stop", async () => {
    // The config changed 1 s ago, so the snapshot cannot adopt the price; the on-chain check refuses.
    const fake = fakeDeps({
      config: { ...LONG, updatedAt: LATER - 1_000 },
      orders: [order({ oid: 424242, triggerPx: 71_000 })],
    });
    expect(await moveStep(fake.deps, input(72_100))).toEqual([
      { kind: "skipped", reason: "on-chain" },
    ]);
    expect(fns(fake.calls)).not.toContain("modify");
  });

  it("adopts a better on-chain stop from the fresh snapshot, and then sends nothing", async () => {
    const fake = fakeDeps({ config: LONG, orders: [order({ oid: 424242, triggerPx: 71_000 })] });
    expect(await moveStep(fake.deps, input(72_100))).toEqual([
      { kind: "skipped", reason: "no-move" },
    ]);
    expect(fns(fake.calls)).toEqual(["read", "fetchOrders", "save"]);
    expect(fake.stored()?.stopPx).toBe(71_000);
  });

  it("sends nothing after a spike and a fall (the candidate is above the mid)", async () => {
    const fake = fakeDeps({ config: LONG, orders: [order({ oid: 424242 })] });
    const events = await moveStep(fake.deps, input(72_000, { bestSeen: () => 75_000 }));
    expect(events).toEqual([{ kind: "skipped", reason: "no-move" }]);
    expect(fns(fake.calls)).toEqual(["read"]);
  });

  it("uses the live position size", async () => {
    const fake = fakeDeps({ config: LONG, orders: [order({ oid: 424242 })] });
    await moveStep(fake.deps, input(72_100, { liveSize: () => 0.02 }));
    expect(fake.calls[2]).toMatchObject({ fn: "modify", order: { s: "0.02" } });
    expect(fake.stored()?.size).toBe(0.02);
  });

  it("waits while the book does not show the last move", async () => {
    const pending = { ...LONG, stopPx: 70_658, highWater: 72_100, previousOid: 424242 };
    const fake = fakeDeps({ config: pending, orders: [order({ oid: 424242, triggerPx: 68_600 })] });
    const events = await moveStep(fake.deps, input(74_000));
    expect(events).toEqual([{ kind: "skipped", reason: "cleanup-pending" }]);
    expect(fns(fake.calls)).toEqual(["read", "fetchOrders"]);
  });

  it("cleans up the previous oid first, then moves the adopted stop; a hand-placed stop stays", async () => {
    const pending = { ...LONG, stopPx: 70_658, highWater: 72_100, previousOid: 424242 };
    const fake = fakeDeps({
      config: pending,
      orders: [
        order({ oid: 424242, triggerPx: 68_600 }),
        order({ oid: 99, triggerPx: 70_658 }),
        order({ oid: 5, triggerPx: 63_000 }),
      ],
    });
    const events = await moveStep(fake.deps, input(74_000));
    expect(fns(fake.calls)).toEqual([
      "read",
      "fetchOrders",
      "save",
      "cancel",
      "save",
      "modify",
      "save",
    ]);
    // The adopted oid is stored before the cancel; previousOid is cleared only after it.
    expect(fake.calls[2]).toMatchObject({ fn: "save", config: { oid: 99, previousOid: 424242 } });
    expect(fake.calls[3]).toEqual({ fn: "cancel", a: 3, o: 424242 });
    expect(fake.calls[5]).toMatchObject({ fn: "modify", oid: 99 });
    expect(fake.stored()).toMatchObject({ oid: 99, stopPx: 72_520, previousOid: 99 });
    expect(events).toEqual([
      { kind: "cleaned", oid: 424242 },
      { kind: "moved", oid: 99, from: 70_658, to: 72_520 },
    ]);
  });

  it("asks to forget the agent on an agent error and keeps the config", async () => {
    const fake = fakeDeps({
      config: LONG,
      orders: [order({ oid: 424242 })],
      modify: async () => {
        throw new TradingError("agent", "The agent is not approved.");
      },
    });
    expect(await moveStep(fake.deps, input(72_100))).toEqual([{ kind: "agent-gone" }]);
    expect(fns(fake.calls)).toEqual(["read", "fetchOrders", "modify"]);
    expect(fake.stored()).toEqual(LONG);
  });

  it("ends the config when the exchange says the order is gone", async () => {
    const fake = fakeDeps({
      config: LONG,
      orders: [order({ oid: 424242 })],
      modify: async () => {
        throw new TradingError("api", GONE, { exchangeMessage: GONE });
      },
    });
    expect(await moveStep(fake.deps, input(72_100))).toEqual([{ kind: "ended" }]);
    expect(fake.stored()).toBeUndefined();
  });

  it("keeps the stop and waits a full interval on any other error", async () => {
    const fake = fakeDeps({
      config: LONG,
      orders: [order({ oid: 424242 })],
      modify: async () => {
        throw new TradingError("api", "Rate limited.");
      },
    });
    expect(await moveStep(fake.deps, input(72_100))).toEqual([
      { kind: "move-error", from: 68_600, message: "Rate limited." },
    ]);
    expect(fake.stored()).toEqual({ ...LONG, lastModifyAt: LATER });
  });
});

describe("reconcileStep", () => {
  const moved: TrailingConfig = { ...LONG, stopPx: 70_658, highWater: 72_100, previousOid: 424242 };

  async function run(config: TrailingConfig, orders: OpenOrder[], options: FakeOptions = {}) {
    const fake = fakeDeps({ config, ...options });
    const out = await reconcileStep(config, orders, LATER, fake.deps);
    return { ...out, calls: fake.calls, stored: fake.stored() };
  }

  it("keeps a hand-placed stop at -10 % next to the trailing stop, and clears previousOid", async () => {
    const out = await run(moved, [
      order({ oid: 424242, triggerPx: 70_658 }),
      order({ oid: 5, triggerPx: 63_000 }),
    ]);
    expect(fns(out.calls)).toEqual(["save"]);
    expect(out.stored).toEqual({ ...LONG, stopPx: 70_658, highWater: 72_100 });
    expect(out.stored).not.toHaveProperty("previousOid");
    expect(out.events).toEqual([]);
  });

  it("cancels exactly the previous oid when it is still open, and says so", async () => {
    const out = await run(moved, [
      order({ oid: 424242, triggerPx: 68_600 }),
      order({ oid: 99, triggerPx: 70_658 }),
      order({ oid: 5, triggerPx: 63_000 }),
    ]);
    expect(out.calls.filter((call) => call.fn === "cancel")).toEqual([
      { fn: "cancel", a: 3, o: 424242 },
    ]);
    expect(out.stored).toMatchObject({ oid: 99 });
    expect(out.stored).not.toHaveProperty("previousOid");
    expect(out.events).toEqual([{ kind: "cleaned", oid: 424242 }]);
  });

  it("shows no success when the previous oid was already gone, and an error when the cancel fails", async () => {
    const orders = [
      order({ oid: 424242, triggerPx: 68_600 }),
      order({ oid: 99, triggerPx: 70_658 }),
    ];
    const gone = await run(moved, orders, {
      cancel: async () => ({ kind: "error", message: GONE }),
    });
    expect(gone.events).toEqual([]);
    expect(gone.stored).not.toHaveProperty("previousOid");
    const failed = await run(moved, orders, {
      cancel: async () => ({ kind: "error", message: "Rate limited." }),
    });
    expect(failed.events).toEqual([
      { kind: "cleanup-error", oid: 424242, message: "Rate limited." },
    ]);
    // The previous oid stays, so the next poll tries again; the adopted oid is stored.
    expect(failed.stored).toMatchObject({ oid: 99, previousOid: 424242 });
    const agent = await run(moved, orders, {
      cancel: async () => {
        throw new TradingError("agent", "The agent is not approved.");
      },
    });
    expect(agent.events).toEqual([
      { kind: "agent-gone" },
      { kind: "cleanup-error", oid: 424242, message: "The agent is not approved." },
    ]);
    expect(agent.stored).toMatchObject({ previousOid: 424242 });
  });

  it("keeps the previous oid after a thrown cleanup error and tries again on the next poll", async () => {
    const orders = [
      order({ oid: 424242, triggerPx: 68_600 }),
      order({ oid: 99, triggerPx: 70_658 }),
    ];
    const first = await run(moved, orders, {
      cancel: async () => {
        throw new TradingError("network", "Could not reach the Hyperliquid testnet.");
      },
    });
    expect(first.stored).toMatchObject({ oid: 99, previousOid: 424242 });
    expect(first.events).toEqual([
      { kind: "cleanup-error", oid: 424242, message: "Could not reach the Hyperliquid testnet." },
    ]);
    // The next poll: the same snapshot, the cancel goes through now.
    const retry = first.stored;
    if (!retry) throw new Error("The config should stay.");
    const second = await run(retry, orders);
    expect(second.calls.filter((call) => call.fn === "cancel")).toEqual([
      { fn: "cancel", a: 3, o: 424242 },
    ]);
    expect(second.stored).toMatchObject({ oid: 99 });
    expect(second.stored).not.toHaveProperty("previousOid");
    expect(second.events).toEqual([{ kind: "cleaned", oid: 424242 }]);
  });

  it("does nothing inside the grace time after the move", async () => {
    const fake = fakeDeps({ config: moved });
    const out = await reconcileStep(moved, [], T0 + 1_000, fake.deps);
    expect(out).toEqual({ config: moved, events: [] });
    expect(fake.calls).toEqual([]);
  });

  it("ends a config whose stop is gone", async () => {
    const out = await run(LONG, [order({ oid: 5, triggerPx: 63_000 })]);
    expect(out.config).toBeNull();
    expect(fns(out.calls)).toEqual(["remove"]);
    expect(out.events).toEqual([{ kind: "ended" }]);
  });

  it("adopts a new oid at the stored price, and a better on-chain trigger price", async () => {
    const adopt = await run(LONG, [order({ oid: 99, triggerPx: 68_600 })]);
    expect(adopt.stored).toMatchObject({ oid: 99, updatedAt: LATER });
    const better = await run(LONG, [order({ oid: 424242, triggerPx: 69_000 })]);
    expect(better.stored).toMatchObject({ oid: 424242, stopPx: 69_000 });
  });
});

describe("moveStep: the snapshot time", () => {
  it("takes the time before the fetch, so a slow fetch cannot end a config inside the grace time", async () => {
    // The stored oid is not on the book (the move is 1 s old). The fetch takes 5 s.
    const config = { ...LONG, updatedAt: LATER - 1_000, lastModifyAt: T0 };
    let time = LATER;
    const fake = fakeDeps({ config, orders: [], clock: () => time });
    const fetchOrders = fake.deps.fetchOrders;
    fake.deps.fetchOrders = async () => {
      const orders = await fetchOrders();
      time += 5_000;
      return orders;
    };
    const events = await moveStep(fake.deps, input(72_100));
    expect(fns(fake.calls)).not.toContain("remove");
    expect(events).not.toContainEqual({ kind: "ended" });
  });
});

describe("moveStep: a network error", () => {
  it("marks the config unsettled with the sent price", async () => {
    const fake = fakeDeps({
      config: LONG,
      orders: [order({ oid: 424242 })],
      modify: async () => {
        throw new TradingError("network", "Could not reach the Hyperliquid testnet.");
      },
    });
    const events = await moveStep(fake.deps, input(72_100));
    expect(events).toEqual([
      { kind: "move-error", from: 68_600, message: "Could not reach the Hyperliquid testnet." },
    ]);
    expect(fake.stored()).toEqual({
      ...LONG,
      highWater: 72_100,
      updatedAt: LATER,
      lastModifyAt: LATER,
      previousOid: 424242,
      unsettled: true,
      pendingStopPx: 70_658,
    });
  });

  it("sends no new move while the config is unsettled", async () => {
    const unsettled = {
      ...LONG,
      highWater: 72_100,
      previousOid: 424242,
      unsettled: true,
      pendingStopPx: 70_658,
      updatedAt: LATER - 1_000,
    };
    const fake = fakeDeps({ config: unsettled, orders: [order({ oid: 424242 })] });
    const events = await moveStep(fake.deps, input(76_000));
    expect(events).toEqual([{ kind: "skipped", reason: "cleanup-pending" }]);
    expect(fns(fake.calls)).not.toContain("modify");
  });
});

describe("reconcileStep: an unsettled move", () => {
  const unsettled: TrailingConfig = {
    ...LONG,
    highWater: 72_100,
    previousOid: 424242,
    unsettled: true,
    pendingStopPx: 70_658,
  };

  async function run(orders: OpenOrder[]) {
    const fake = fakeDeps({ config: unsettled });
    const out = await reconcileStep(unsettled, orders, LATER, fake.deps);
    return { ...out, calls: fake.calls, stored: fake.stored() };
  }

  it("accepts a stop at the pending price: it landed (same oid)", async () => {
    const out = await run([order({ oid: 424242, triggerPx: 70_658 })]);
    expect(out.stored).toEqual({ ...LONG, highWater: 72_100, stopPx: 70_658 });
    expect(out.events).toEqual([]);
  });

  it("accepts a stop at the pending price under a new oid, and cancels the old order", async () => {
    const out = await run([
      order({ oid: 424243, triggerPx: 70_658 }),
      order({ oid: 424242, triggerPx: 68_600 }),
    ]);
    expect(out.calls.filter((call) => call.fn === "cancel")).toEqual([
      { fn: "cancel", a: 3, o: 424242 },
    ]);
    expect(out.stored).toEqual({ ...LONG, highWater: 72_100, stopPx: 70_658, oid: 424243 });
    expect(out.events).toEqual([{ kind: "cleaned", oid: 424242 }]);
  });

  it("accepts the stop at the stored price: it did not land", async () => {
    const out = await run([order({ oid: 424242, triggerPx: 68_600 })]);
    expect(out.stored).toEqual({ ...LONG, highWater: 72_100 });
    expect(out.calls.filter((call) => call.fn === "cancel")).toEqual([]);
    expect(out.events).toEqual([]);
  });

  it("ends the config when neither price is on the book", async () => {
    const out = await run([order({ oid: 5, triggerPx: 63_000 })]);
    expect(out.config).toBeNull();
    expect(out.events).toEqual([{ kind: "ended" }]);
  });

  it("waits inside the grace time", async () => {
    const fake = fakeDeps({ config: unsettled });
    const out = await reconcileStep(unsettled, [], T0 + 1_000, fake.deps);
    expect(out).toEqual({ config: unsettled, events: [] });
    expect(fake.calls).toEqual([]);
  });
});

describe("reconcileStep: the position is closed", () => {
  it("says the stop is gone when the position and the stop are both gone (it most likely filled)", async () => {
    const fake = fakeDeps({ config: LONG });
    const out = await reconcileStep(
      LONG,
      [order({ oid: 5, triggerPx: 63_000 })],
      LATER,
      fake.deps,
      { hasPosition: false },
    );
    expect(out.config).toBeNull();
    expect(fns(fake.calls)).toEqual(["remove"]);
    expect(out.events).toEqual([{ kind: "ended" }]);
  });

  it("removes the config of a settling move too, before any cleanup", async () => {
    const moved = { ...LONG, stopPx: 70_658, previousOid: 424242 };
    const fake = fakeDeps({ config: moved });
    const out = await reconcileStep(moved, [], LATER, fake.deps, { hasPosition: false });
    expect(out.events).toEqual([{ kind: "ended" }]);
    expect(fns(fake.calls)).toEqual(["remove"]);
  });

  it("says the position is closed when its stop is still on the book, and cancels nothing", async () => {
    const onBook = fakeDeps({ config: LONG });
    const out = await reconcileStep(LONG, [order({ oid: 424242 })], LATER, onBook.deps, {
      hasPosition: false,
    });
    expect(out.config).toBeNull();
    expect(out.events).toEqual([{ kind: "position-closed" }]);
    expect(fns(onBook.calls)).toEqual(["remove"]);
  });

  it("keeps the config inside the grace time", async () => {
    const early = fakeDeps({ config: LONG });
    const waited = await reconcileStep(LONG, [], T0 + 1_000, early.deps, { hasPosition: false });
    expect(waited.config).toEqual(LONG);
    expect(early.calls).toEqual([]);
  });

  it("is checked in a move too", async () => {
    const fake = fakeDeps({ config: LONG, orders: [] });
    const events = await moveStep(fake.deps, input(72_100, { hasPosition: () => false }));
    expect(events).toEqual([{ kind: "ended" }]);
    expect(fns(fake.calls)).not.toContain("modify");
  });
});

describe("watchCleanupPending", () => {
  const pending: TrailingEvent[] = [{ kind: "skipped", reason: "cleanup-pending" }];

  it("starts on the first cleanup-pending and resets on any other outcome", () => {
    expect(watchCleanupPending(undefined, pending, T0)).toEqual({
      next: { since: T0, warned: false },
      warn: false,
      slow: false,
    });
    expect(
      watchCleanupPending(
        { since: T0, warned: false },
        [{ kind: "skipped", reason: "no-move" }],
        T0,
      ),
    ).toEqual({ next: undefined, warn: false, slow: false });
  });

  it("warns once after 60 s and stays slow", () => {
    const after = T0 + CLEANUP_PENDING_WARN_MS + 1;
    const first = watchCleanupPending({ since: T0, warned: false }, pending, after);
    expect(first).toEqual({ next: { since: T0, warned: true }, warn: true, slow: true });
    const again = watchCleanupPending(first.next, pending, after + 10_000);
    expect(again).toEqual({ next: { since: T0, warned: true }, warn: false, slow: true });
  });

  it("does not warn before 60 s", () => {
    const out = watchCleanupPending({ since: T0, warned: false }, pending, T0 + 30_000);
    expect(out).toEqual({ next: { since: T0, warned: false }, warn: false, slow: false });
  });
});
