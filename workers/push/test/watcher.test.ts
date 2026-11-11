import { describe, expect, it } from "vitest";

import {
  activeNetworks,
  advanceCursor,
  BURST_MAX,
  buildItems,
  classifyPushStatus,
  createBudget,
  cursorOrStart,
  deliveryKey,
  itemId,
  itemPayload,
  mapLimit,
  MAX_FAILURES,
  NEW_CURSOR_LOOKBACK_MS,
  newFills,
  nextFailures,
  planDeliveries,
  pollLimit,
  selectTargets,
  type Item,
} from "../src/watcher";

import { A, B, fill, row } from "./helpers";

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: itemId("mainnet", A, 1),
    network: "mainnet",
    user: A,
    oid: 1,
    coin: "BTC",
    dir: "Open Long",
    side: "buy",
    sizeCoin: 0.17,
    avgPx: 74_650,
    notionalUsd: 12_690.5,
    closedPnl: 0,
    time: 1_000_000,
    ...overrides,
  };
}

describe("cursor", () => {
  it("starts two minutes back when there is no cursor, so history never notifies", () => {
    expect(cursorOrStart(null, 1_000_000)).toEqual({
      lastTime: 1_000_000 - NEW_CURSOR_LOOKBACK_MS,
      seenTids: [],
    });
    const kept = { lastTime: 5, seenTids: [1] };
    expect(cursorOrStart(kept, 1_000_000)).toBe(kept);
  });

  it("keeps fills after the cursor and unseen tids at the cursor time", () => {
    const cursor = { lastTime: 2_000, seenTids: [10, 11] };
    const fills = [
      fill({ time: 1_999, tid: 9 }),
      fill({ time: 2_000, tid: 10 }),
      fill({ time: 2_000, tid: 11 }),
      fill({ time: 2_000, tid: 12 }),
      fill({ time: 2_001, tid: 13 }),
    ];
    expect(newFills(fills, cursor).map((entry) => entry.tid)).toEqual([12, 13]);
  });

  it("keeps fills at the start time of a new cursor", () => {
    const cursor = cursorOrStart(null, 200_000);
    const fills = [fill({ time: 80_000, tid: 1 }), fill({ time: 79_999, tid: 2 })];
    expect(newFills(fills, cursor).map((entry) => entry.tid)).toEqual([1]);
  });

  it("moves to the newest fill and keeps the tids at that time", () => {
    const cursor = { lastTime: 2_000, seenTids: [10] };
    const next = advanceCursor(cursor, [
      fill({ time: 2_000, tid: 10 }),
      fill({ time: 3_000, tid: 21 }),
      fill({ time: 3_000, tid: 20 }),
    ]);
    expect(next).toEqual({ lastTime: 3_000, seenTids: [20, 21] });
  });

  it("adds new tids at the same time to the old seen list", () => {
    const cursor = { lastTime: 2_000, seenTids: [10] };
    expect(advanceCursor(cursor, [fill({ time: 2_000, tid: 11 })])).toEqual({
      lastTime: 2_000,
      seenTids: [10, 11],
    });
    expect(advanceCursor(cursor, [])).toEqual(cursor);
  });

  it("does not repeat a fill across two polls at the boundary", () => {
    const first = [fill({ time: 5_000, tid: 1 }), fill({ time: 5_000, tid: 2 })];
    const start = { lastTime: 4_000, seenTids: [] };
    expect(newFills(first, start)).toHaveLength(2);
    const cursor = advanceCursor(start, first);
    const second = [...first, fill({ time: 5_000, tid: 3 })];
    expect(newFills(second, cursor).map((entry) => entry.tid)).toEqual([3]);
  });
});

describe("buildItems", () => {
  it("groups by oid with summed size, weighted price, summed PnL and the latest time", () => {
    const items = buildItems("mainnet", A.toUpperCase().replace("0X", "0x"), [
      fill({ oid: 7, tid: 1, px: 100, sz: 1, time: 1_000, closedPnl: 1 }),
      fill({ oid: 7, tid: 2, px: 200, sz: 3, time: 2_000, closedPnl: 2 }),
      fill({ oid: 8, tid: 3, px: 50, sz: 2, time: 1_500, coin: "ETH", dir: "Close Short" }),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: `mainnet:${A}:8`, coin: "ETH", dir: "Close Short" });
    expect(items[1]).toEqual({
      id: `mainnet:${A}:7`,
      network: "mainnet",
      user: A,
      oid: 7,
      coin: "BTC",
      dir: "Open Long",
      side: "buy",
      sizeCoin: 4,
      avgPx: 175,
      notionalUsd: 700,
      closedPnl: 3,
      time: 2_000,
    });
  });

  it("drops system fills", () => {
    expect(buildItems("mainnet", A, [fill({ dir: "Spot Dust Conversion" })])).toEqual([]);
  });

  it("shows a flip when the parts of one order differ", () => {
    const [flip] = buildItems("testnet", A, [
      fill({ oid: 1, tid: 1, dir: "Close Long", time: 1 }),
      fill({ oid: 1, tid: 2, dir: "Open Short", time: 2 }),
    ]);
    expect(flip?.dir).toBe("Long > Short");
    expect(flip?.id).toBe(`testnet:${A}:1`);
  });
});

describe("selectTargets", () => {
  it("lists each network and address once, least recently polled first, capped", () => {
    const rows = [
      row({ id: "s1", address: A, polled_at: 500, last_time: 10, seen_tids: "[1,2]" }),
      row({ id: "s2", address: A, polled_at: 500, last_time: 10, seen_tids: "[1,2]" }),
      row({ id: "s1", address: B, polled_at: null }),
      row({ id: "s3", address: A, network: "testnet", polled_at: 100, last_time: 3 }),
    ];
    const targets = selectTargets(rows, 10);
    expect(targets.map((target) => `${target.network}:${target.address}`)).toEqual([
      `mainnet:${B}`,
      `testnet:${A}`,
      `mainnet:${A}`,
    ]);
    expect(targets[0]?.cursor).toBeNull();
    expect(targets[2]?.cursor).toEqual({ lastTime: 10, seenTids: [1, 2] });
    expect(selectTargets(rows, 1)).toHaveLength(1);
    expect(activeNetworks(rows)).toEqual(["mainnet", "testnet"]);
  });
});

describe("planDeliveries", () => {
  it("applies the minimum notional per subscription and uses the label", () => {
    const rows = [
      row({ id: "low", min_notional: 0, label: "testooor.hl" }),
      row({ id: "high", endpoint: "https://push.example/2", min_notional: 100_000 }),
    ];
    const pushes = planDeliveries({ items: [item()], rows, delivered: new Set(), now: 1_000_000 });
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.subscription.id).toBe("low");
    expect(pushes[0]?.payload).toEqual({
      title: "testooor.hl opened long BTC",
      body: "$12.7K · 0.17 BTC @ 74,650.00 · 0s ago",
      url: `/trader/${A}`,
      tag: `mainnet:${A}:1`,
      time: 1_000_000,
    });
  });

  it("uses the short address without a label, and skips other networks and delivered items", () => {
    const rows = [row({ id: "a" }), row({ id: "t", network: "testnet" })];
    const delivered = new Set([deliveryKey("a", itemId("mainnet", A, 2))]);
    const pushes = planDeliveries({
      items: [item(), item({ id: itemId("mainnet", A, 2), oid: 2 })],
      rows,
      delivered,
      now: 1_060_000,
    });
    expect(pushes.map((push) => push.itemIds)).toEqual([[itemId("mainnet", A, 1)]]);
    expect(pushes[0]?.payload.title).toBe("0x5b5d…c060 opened long BTC");
    expect(pushes[0]?.payload.body.endsWith("1m ago")).toBe(true);
  });

  it("turns more than BURST_MAX items for one subscription into one summary", () => {
    const items = Array.from({ length: BURST_MAX + 2 }, (_, index) =>
      item({ id: itemId("mainnet", A, index), oid: index }),
    );
    const pushes = planDeliveries({
      items,
      rows: [row({ label: "whale" })],
      delivered: new Set(),
      now: 5,
    });
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.payload).toEqual({
      title: "5 new trades from traders you follow",
      body: "whale",
      url: "/watchlist",
      tag: "mainnet:burst",
      time: 5,
    });
    expect(pushes[0]?.itemIds).toHaveLength(5);
    expect(pushes[0]?.targetKeys).toEqual([`mainnet:${A}`]);
  });

  it("builds an order payload with the trader URL and the item tag", () => {
    expect(itemPayload(item({ dir: "Liquidated Isolated Long" }), "x", 1_000_000).title).toBe(
      "x was liquidated BTC",
    );
  });
});

describe("push results", () => {
  it("classifies the push service status", () => {
    expect(classifyPushStatus(201)).toBe("sent");
    expect(classifyPushStatus(200)).toBe("sent");
    expect(classifyPushStatus(404)).toBe("gone");
    expect(classifyPushStatus(410)).toBe("gone");
    expect(classifyPushStatus(405)).toBe("failed");
    expect(classifyPushStatus(0)).toBe("failed");
  });

  it("removes a subscription at the tenth failure", () => {
    expect(nextFailures(0)).toEqual({ failures: 1, remove: false });
    expect(nextFailures(MAX_FAILURES - 1)).toEqual({ failures: MAX_FAILURES, remove: true });
  });
});

describe("limits", () => {
  it("counts down a request budget", () => {
    const budget = createBudget(2);
    expect([budget.take(), budget.take(), budget.take()]).toEqual([true, true, false]);
    expect(budget.remaining()).toBe(0);
  });

  it("polls at most 60 % of the request budget and the address cap", () => {
    expect(pollLimit(300, 45)).toBe(27);
    expect(pollLimit(10, 45)).toBe(10);
    expect(pollLimit(300, 1)).toBe(1);
  });

  it("runs tasks with a concurrency limit and keeps the order", async () => {
    let running = 0;
    let peak = 0;
    const result = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (value) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return value * 2;
    });
    expect(result).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peak).toBe(2);
  });
});
