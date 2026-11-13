import { describe, expect, it } from "vitest";

import { sideSplit } from "./sideSplit";
import { makeFill } from "./testFills";

describe("sideSplit", () => {
  it("returns null shares and win rates for no fills", () => {
    const empty = { orders: 0, wins: 0, losses: 0, winRate: null, volume: 0, share: null };
    expect(sideSplit([])).toEqual({ long: empty, short: empty, orders: 0 });
  });

  it("counts orders, wins, losses and volume per side", () => {
    const split = sideSplit([
      makeFill({ oid: 1, tid: 1, dir: "Open Long", px: 10, sz: 1 }),
      makeFill({ oid: 2, tid: 2, dir: "Close Long", px: 10, sz: 1, closedPnl: 5 }),
      makeFill({ oid: 2, tid: 3, dir: "Close Long", px: 10, sz: 2, closedPnl: 1 }),
      makeFill({ oid: 3, tid: 4, dir: "Close Long", px: 10, sz: 1, closedPnl: -2 }),
      makeFill({ oid: 4, tid: 5, dir: "Close Short", px: 20, sz: 1, closedPnl: 3 }),
      // A spot fill does not count.
      makeFill({ oid: 5, tid: 6, dir: "Buy", px: 1, sz: 1 }),
    ]);
    expect(split.orders).toBe(4);
    expect(split.long).toEqual({
      orders: 3,
      wins: 1,
      losses: 1,
      winRate: 0.5,
      volume: 50,
      share: 0.75,
    });
    expect(split.short).toEqual({
      orders: 1,
      wins: 1,
      losses: 0,
      winRate: 1,
      volume: 20,
      share: 0.25,
    });
  });

  it("counts a flip order as short", () => {
    const split = sideSplit([
      makeFill({ oid: 7, tid: 1, dir: "Long > Short", side: "sell", closedPnl: 4 }),
    ]);
    expect(split.short.orders).toBe(1);
    expect(split.short.wins).toBe(1);
    expect(split.long.orders).toBe(0);
  });

  it("takes the side of the first fill of the order", () => {
    const split = sideSplit([
      makeFill({ oid: 8, tid: 2, time: 2_000, dir: "Open Short", side: "sell" }),
      makeFill({ oid: 8, tid: 1, time: 1_000, dir: "Close Long", side: "sell", closedPnl: 2 }),
    ]);
    expect(split.long.orders).toBe(1);
    expect(split.short.orders).toBe(0);
  });

  it("gives a null win rate for a side with no closes", () => {
    const split = sideSplit([
      makeFill({ oid: 1, tid: 1, dir: "Open Short", side: "sell" }),
      makeFill({ oid: 2, tid: 2, dir: "Close Long", closedPnl: 1 }),
    ]);
    expect(split.short.winRate).toBeNull();
    expect(split.short.share).toBe(0.5);
    expect(split.long.winRate).toBe(1);
  });
});
