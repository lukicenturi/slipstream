import { describe, expect, it } from "vitest";

import { makeFill } from "./testFills";
import { winRate } from "./winRate";

describe("winRate", () => {
  it("returns a null rate for an empty list", () => {
    expect(winRate([])).toEqual({ wins: 0, losses: 0, closes: 0, rate: null });
  });

  it("returns a null rate when no order closed any PnL", () => {
    const result = winRate([makeFill({ oid: 1 }), makeFill({ oid: 2, tid: 2 })]);
    expect(result.closes).toBe(0);
    expect(result.rate).toBeNull();
  });

  it("counts wins and losses and ignores orders with zero closed PnL", () => {
    const result = winRate([
      makeFill({ oid: 1, tid: 1, closedPnl: 50 }),
      makeFill({ oid: 2, tid: 2, closedPnl: -20 }),
      makeFill({ oid: 3, tid: 3, closedPnl: 10 }),
      makeFill({ oid: 4, tid: 4, closedPnl: 0 }),
    ]);
    expect(result).toEqual({ wins: 2, losses: 1, closes: 3, rate: 2 / 3 });
  });

  it("returns a rate of 0 when every close lost", () => {
    const result = winRate([
      makeFill({ oid: 1, tid: 1, closedPnl: -4 }),
      makeFill({ oid: 2, tid: 2, closedPnl: -1 }),
    ]);
    expect(result).toEqual({ wins: 0, losses: 2, closes: 2, rate: 0 });
  });

  it("counts the partial fills of one order once", () => {
    const result = winRate([
      makeFill({ oid: 9, tid: 1, closedPnl: 5 }),
      makeFill({ oid: 9, tid: 2, closedPnl: 7 }),
      makeFill({ oid: 9, tid: 3, closedPnl: 1 }),
      makeFill({ oid: 10, tid: 4, closedPnl: -3 }),
    ]);
    expect(result).toEqual({ wins: 1, losses: 1, closes: 2, rate: 0.5 });
  });

  it("uses the sum of the parts to decide the sign of an order", () => {
    const result = winRate([
      makeFill({ oid: 5, tid: 1, closedPnl: 10 }),
      makeFill({ oid: 5, tid: 2, closedPnl: -15 }),
    ]);
    expect(result).toEqual({ wins: 0, losses: 1, closes: 1, rate: 0 });
  });
});
