import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { portfolioSchema } from "@/lib/hyperliquid/schemas";

import { toChartSeries } from "./pnlSeries";

describe("toChartSeries", () => {
  it("returns an empty list for no points", () => {
    expect(toChartSeries([])).toEqual([]);
  });

  it("converts ms to seconds and sorts by time", () => {
    expect(
      toChartSeries([
        { time: 3_000, value: 3 },
        { time: 1_000, value: 1 },
        { time: 2_500, value: 2 },
      ]),
    ).toEqual([
      { time: 1, value: 1 },
      { time: 2, value: 2 },
      { time: 3, value: 3 },
    ]);
  });

  it("keeps the last value when two points fall in the same second", () => {
    expect(
      toChartSeries([
        { time: 1_000, value: 1 },
        { time: 1_400, value: 4 },
        { time: 1_900, value: 9 },
        { time: 2_000, value: 2 },
      ]),
    ).toEqual([
      { time: 1, value: 9 },
      { time: 2, value: 2 },
    ]);
  });

  it("drops points that are not finite", () => {
    expect(
      toChartSeries([
        { time: 1_000, value: Number.NaN },
        { time: Number.POSITIVE_INFINITY, value: 1 },
        { time: 2_000, value: 2 },
      ]),
    ).toEqual([{ time: 2, value: 2 }]);
  });

  it("turns the real portfolio fixture into strictly increasing times", () => {
    const raw: unknown = JSON.parse(
      readFileSync(join(process.cwd(), "fixtures", "portfolio.json"), "utf8"),
    );
    const portfolio = portfolioSchema.parse(raw);
    for (const window of ["day", "week", "month", "allTime"] as const) {
      const series = toChartSeries(portfolio[window].pnlHistory);
      for (let index = 1; index < series.length; index += 1) {
        expect(series[index].time).toBeGreaterThan(series[index - 1].time);
      }
    }
  });
});
