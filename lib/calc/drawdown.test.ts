import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { portfolioSchema } from "@/lib/hyperliquid/schemas";

import { drawdownSeries, maxDrawdown } from "./drawdown";

/** Points at 1 s, 2 s, 3 s ... with the given values. */
function points(values: readonly number[]) {
  return values.map((value, index) => ({ time: (index + 1) * 1000, value }));
}

describe("drawdownSeries", () => {
  it("returns an empty list for no points", () => {
    expect(drawdownSeries([])).toEqual([]);
  });

  it("gives the fall from the running peak", () => {
    expect(drawdownSeries(points([0, 10, 4, 12, 9]))).toEqual([
      { time: 1, value: 0 },
      { time: 2, value: 0 },
      { time: 3, value: -6 },
      { time: 4, value: 0 },
      { time: 5, value: -3 },
    ]);
  });

  it("gives 0 at every point of a series that only rises", () => {
    const series = drawdownSeries(points([-5, -2, 3, 8]));
    expect(series.map((point) => point.value)).toEqual([0, 0, 0, 0]);
    expect(series.every((point) => !Object.is(point.value, -0))).toBe(true);
  });

  it("sorts unsorted input first", () => {
    expect(
      drawdownSeries([
        { time: 3000, value: 5 },
        { time: 1000, value: 10 },
        { time: 2000, value: 2 },
      ]),
    ).toEqual([
      { time: 1, value: 0 },
      { time: 2, value: -8 },
      { time: 3, value: -5 },
    ]);
  });
});

describe("maxDrawdown", () => {
  it("returns null with fewer than 2 points", () => {
    expect(maxDrawdown([], [])).toBeNull();
    expect(maxDrawdown(points([5]), points([100]))).toBeNull();
  });

  it("gives the largest fall after a rise", () => {
    const pnl = points([0, 100, 40, 80, 20, 90]);
    const accountValue = points([1000, 2000, 1940, 1980, 1920, 1990]);
    // The peak of 100 is at 2 s, where the account value is 2000.
    expect(maxDrawdown(pnl, accountValue)).toEqual({ usd: -80, ratio: -80 / 2000, time: 5 });
  });

  it("gives 0 at the first point for a series that only rises", () => {
    expect(maxDrawdown(points([1, 2, 3]), points([10, 20, 30]))).toEqual({
      usd: 0,
      ratio: 0,
      time: 1,
    });
  });

  it("gives a null ratio when no account value matches the peak time", () => {
    const result = maxDrawdown(points([10, 4]), [{ time: 99_000, value: 500 }]);
    expect(result).toEqual({ usd: -6, ratio: null, time: 2 });
  });

  it("gives a null ratio when the account value at the peak is not above 0", () => {
    expect(maxDrawdown(points([10, 4]), points([0, 0]))?.ratio).toBeNull();
  });

  it("sorts unsorted input first", () => {
    const pnl = [
      { time: 3000, value: 2 },
      { time: 1000, value: 0 },
      { time: 2000, value: 10 },
    ];
    const accountValue = [
      { time: 2000, value: 200 },
      { time: 1000, value: 100 },
      { time: 3000, value: 192 },
    ];
    expect(maxDrawdown(pnl, accountValue)).toEqual({ usd: -8, ratio: -8 / 200, time: 3 });
  });

  it("works on the real portfolio fixture", () => {
    const raw: unknown = JSON.parse(
      readFileSync(join(process.cwd(), "fixtures", "portfolio.json"), "utf8"),
    );
    const portfolio = portfolioSchema.parse(raw);
    const { pnlHistory, accountValueHistory } = portfolio.month;
    const result = maxDrawdown(pnlHistory, accountValueHistory);
    expect(result).not.toBeNull();
    expect(result?.usd).toBeLessThanOrEqual(0);
    const lowest = Math.min(...drawdownSeries(pnlHistory).map((point) => point.value));
    expect(result?.usd).toBe(lowest);
  });
});
