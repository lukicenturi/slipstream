import { describe, expect, it } from "vitest";

import { makeFill } from "./testFills";
import { holdTimes, median, orderPnls, perpFills, tradeStats } from "./traderStats";

const DAY = 86_400_000;

describe("perpFills", () => {
  it("drops system fills, spot trades and unknown values", () => {
    const fills = [
      makeFill({ tid: 1, dir: "Spot Dust Conversion" }),
      makeFill({ tid: 2, dir: "Buy" }),
      makeFill({ tid: 3, dir: "Sell" }),
      makeFill({ tid: 4, dir: "Something New" }),
      makeFill({ tid: 5, dir: "Open Long" }),
      makeFill({ tid: 6, dir: "Close Short" }),
      makeFill({ tid: 7, dir: "Liquidated Long" }),
    ];
    expect(perpFills(fills).map((fill) => fill.tid)).toEqual([5, 6, 7]);
  });
});

describe("orderPnls", () => {
  it("sums the closed PnL of the parts of one order", () => {
    expect(
      orderPnls([
        makeFill({ oid: 1, tid: 1, closedPnl: 5 }),
        makeFill({ oid: 2, tid: 2, closedPnl: -3 }),
        makeFill({ oid: 1, tid: 3, closedPnl: 7 }),
      ]),
    ).toEqual([
      { oid: 1, pnl: 12 },
      { oid: 2, pnl: -3 },
    ]);
  });
});

describe("tradeStats", () => {
  it("returns zero counts and null figures for no fills", () => {
    expect(tradeStats([])).toEqual({
      fills: 0,
      orders: 0,
      wins: 0,
      losses: 0,
      winRate: null,
      grossProfit: 0,
      grossLoss: 0,
      profitFactor: null,
      avgWin: null,
      avgLoss: null,
      largestWin: null,
      largestLoss: null,
      fees: 0,
      spanDays: null,
      ordersPerDay: null,
      roundTrips: 0,
      medianHoldMs: null,
    });
  });

  it("counts 2 wins and 1 loss across partial fills of one order", () => {
    const fills = [
      // Order 1 opens (no PnL).
      makeFill({ oid: 1, tid: 1, time: 0, closedPnl: 0, fee: 1 }),
      // Order 2 wins 300 in two parts.
      makeFill({ oid: 2, tid: 2, time: DAY, dir: "Close Long", closedPnl: 100, fee: 0.5 }),
      makeFill({ oid: 2, tid: 3, time: DAY, dir: "Close Long", closedPnl: 200, fee: 0.5 }),
      // Order 3 wins 100.
      makeFill({ oid: 3, tid: 4, time: 2 * DAY, dir: "Close Short", closedPnl: 100, fee: 1 }),
      // Order 4 loses 200 in two parts.
      makeFill({ oid: 4, tid: 5, time: 4 * DAY, dir: "Close Long", closedPnl: -150, fee: 1 }),
      makeFill({ oid: 4, tid: 6, time: 4 * DAY, dir: "Close Long", closedPnl: -50, fee: 1 }),
      // A spot fill does not count.
      makeFill({ oid: 5, tid: 7, time: 10 * DAY, dir: "Sell", closedPnl: 999, fee: 9 }),
    ];
    const stats = tradeStats(fills);
    expect(stats.fills).toBe(6);
    expect(stats.orders).toBe(4);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBeCloseTo(2 / 3);
    expect(stats.grossProfit).toBe(400);
    expect(stats.grossLoss).toBe(200);
    expect(stats.profitFactor).toBe(2);
    expect(stats.avgWin).toBe(200);
    expect(stats.avgLoss).toBe(200);
    expect(stats.largestWin).toBe(300);
    expect(stats.largestLoss).toBe(-200);
    expect(stats.fees).toBe(5);
    // 4 orders over a span of 4 days.
    expect(stats.spanDays).toBe(4);
    expect(stats.ordersPerDay).toBe(1);
  });

  it("returns a null profit factor and null loss figures with no losses", () => {
    const stats = tradeStats([
      makeFill({ oid: 1, tid: 1, dir: "Close Long", closedPnl: 10 }),
      makeFill({ oid: 2, tid: 2, dir: "Close Long", closedPnl: 30 }),
    ]);
    expect(stats.profitFactor).toBeNull();
    expect(stats.avgLoss).toBeNull();
    expect(stats.largestLoss).toBeNull();
    expect(stats.avgWin).toBe(20);
    expect(stats.largestWin).toBe(30);
  });

  it("uses a span of at least 1 day for orders per day", () => {
    const stats = tradeStats([
      makeFill({ oid: 1, tid: 1, time: 0 }),
      makeFill({ oid: 2, tid: 2, time: 60_000 }),
      makeFill({ oid: 3, tid: 3, time: 120_000 }),
    ]);
    expect(stats.ordersPerDay).toBe(3);
  });

  it("gives the median hold time of complete round trips", () => {
    const stats = tradeStats([
      makeFill({ tid: 1, oid: 1, time: 0, startPosition: 0, side: "buy", sz: 1 }),
      makeFill({
        tid: 2,
        oid: 2,
        time: 5_000,
        startPosition: 1,
        side: "sell",
        sz: 1,
        dir: "Close Long",
      }),
    ]);
    expect(stats.roundTrips).toBe(1);
    expect(stats.medianHoldMs).toBe(5_000);
  });
});

describe("holdTimes", () => {
  it("gives one duration for an open, an add and a close to 0", () => {
    expect(
      holdTimes([
        makeFill({ tid: 1, time: 1_000, startPosition: 0, side: "buy", sz: 2 }),
        makeFill({ tid: 2, time: 2_000, startPosition: 2, side: "buy", sz: 1 }),
        makeFill({
          tid: 3,
          time: 9_000,
          startPosition: 3,
          side: "sell",
          sz: 3,
          dir: "Close Long",
        }),
      ]),
    ).toEqual([8_000]);
  });

  it("handles a short trip and float sizes within the tolerance", () => {
    expect(
      holdTimes([
        makeFill({ tid: 1, time: 0, startPosition: 0, side: "sell", sz: 0.3, dir: "Open Short" }),
        makeFill({
          tid: 2,
          time: 4_000,
          startPosition: -(0.1 + 0.2),
          side: "buy",
          sz: 0.3,
          dir: "Close Short",
        }),
      ]),
    ).toEqual([4_000]);
  });

  it("ignores an open with no close", () => {
    expect(
      holdTimes([
        makeFill({ tid: 1, time: 0, startPosition: 0, side: "buy", sz: 1 }),
        makeFill({ tid: 2, time: 1_000, startPosition: 1, side: "buy", sz: 1 }),
      ]),
    ).toEqual([]);
  });

  it("ignores a close whose open is older than the fills", () => {
    expect(
      holdTimes([
        makeFill({ tid: 1, time: 0, startPosition: 4, side: "sell", sz: 4, dir: "Close Long" }),
      ]),
    ).toEqual([]);
  });

  it("does not mix the fills of two coins", () => {
    const durations = holdTimes([
      makeFill({ tid: 1, coin: "BTC", time: 0, startPosition: 0, side: "buy", sz: 1 }),
      makeFill({ tid: 2, coin: "ETH", time: 1_000, startPosition: 0, side: "buy", sz: 5 }),
      // This ETH sell does not close the BTC position.
      makeFill({
        tid: 3,
        coin: "ETH",
        time: 2_000,
        startPosition: 5,
        side: "sell",
        sz: 1,
        dir: "Close Long",
      }),
      makeFill({
        tid: 4,
        coin: "BTC",
        time: 3_000,
        startPosition: 1,
        side: "sell",
        sz: 1,
        dir: "Close Long",
      }),
      makeFill({
        tid: 5,
        coin: "ETH",
        time: 7_000,
        startPosition: 4,
        side: "sell",
        sz: 4,
        dir: "Close Long",
      }),
    ]);
    expect(durations.sort((a, b) => a - b)).toEqual([3_000, 6_000]);
  });

  it("sorts the fills by time first", () => {
    expect(
      holdTimes([
        makeFill({ tid: 2, time: 5_000, startPosition: 1, side: "sell", sz: 1, dir: "Close Long" }),
        makeFill({ tid: 1, time: 1_000, startPosition: 0, side: "buy", sz: 1 }),
      ]),
    ).toEqual([4_000]);
  });

  it("gives the middle trip as the median of 3 trips", () => {
    const trip = (tid: number, start: number, length: number) => [
      makeFill({ tid, time: start, startPosition: 0, side: "buy", sz: 1 }),
      makeFill({
        tid: tid + 1,
        time: start + length,
        startPosition: 1,
        side: "sell",
        sz: 1,
        dir: "Close Long",
      }),
    ];
    const durations = holdTimes([
      ...trip(1, 0, 10_000),
      ...trip(3, 20_000, 1_000),
      ...trip(5, 30_000, 60_000),
    ]);
    expect(durations).toEqual([10_000, 1_000, 60_000]);
    expect(median(durations)).toBe(10_000);
  });
});

describe("median", () => {
  it("returns null for an empty list and the mean of the middle pair for an even list", () => {
    expect(median([])).toBeNull();
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
