import { describe, expect, it } from "vitest";

import { assetBreakdown, type AssetRow, topAssets } from "./assetBreakdown";
import { makeFill } from "./testFills";

describe("assetBreakdown", () => {
  it("returns no rows for no fills", () => {
    expect(assetBreakdown([])).toEqual([]);
  });

  it("sums per coin and sorts by volume", () => {
    const rows = assetBreakdown([
      makeFill({ tid: 1, oid: 1, coin: "ETH", px: 10, sz: 2, closedPnl: 0 }),
      makeFill({ tid: 2, oid: 2, coin: "BTC", px: 100, sz: 1, closedPnl: 5 }),
      makeFill({ tid: 3, oid: 2, coin: "BTC", px: 100, sz: 2, closedPnl: -1 }),
      makeFill({ tid: 4, oid: 3, coin: "ETH", px: 10, sz: 3, closedPnl: 7 }),
      makeFill({ tid: 5, oid: 4, coin: "SOL", px: 1, sz: 400, closedPnl: -2 }),
      // Spot trades do not count.
      makeFill({ tid: 6, oid: 5, coin: "@107", px: 1, sz: 9_999, dir: "Buy" }),
    ]);
    expect(rows.map((row) => row.coin)).toEqual(["SOL", "BTC", "ETH"]);
    expect(rows[1]).toEqual({
      coin: "BTC",
      other: false,
      realizedPnl: 4,
      volume: 300,
      orders: 1,
      share: 300 / 750,
    });
    expect(rows[2].orders).toBe(2);
    expect(rows[2].realizedPnl).toBe(7);
    const shares = rows.reduce((sum, row) => sum + row.share, 0);
    expect(Math.abs(shares - 1)).toBeLessThan(1e-9);
  });

  it("gives a share of 0 when the total volume is 0", () => {
    const rows = assetBreakdown([makeFill({ px: 0, sz: 1 })]);
    expect(rows[0].share).toBe(0);
  });
});

function row(coin: string, volume: number, realizedPnl: number, orders = 1): AssetRow {
  return { coin, other: false, realizedPnl, volume, orders, share: volume / 360 };
}

describe("topAssets", () => {
  // Volumes 80 + 70 + ... + 10 = 360.
  const rows = [80, 70, 60, 50, 40, 30, 20, 10].map((volume, index) =>
    row(`C${index}`, volume, index - 3, index + 1),
  );

  it("keeps 6 rows and groups the rest in Other", () => {
    const top = topAssets(rows, 6);
    expect(top).toHaveLength(7);
    expect(top.slice(0, 6).map((entry) => entry.coin)).toEqual([
      "C0",
      "C1",
      "C2",
      "C3",
      "C4",
      "C5",
    ]);
    expect(top[6]).toEqual({
      coin: "Other",
      other: true,
      realizedPnl: 3 + 4,
      volume: 30,
      orders: 7 + 8,
      share: 30 / 360,
    });
  });

  it("adds no Other row with 6 coins or fewer", () => {
    expect(topAssets(rows.slice(0, 6), 6)).toEqual(rows.slice(0, 6));
    expect(topAssets(rows.slice(0, 2), 6)).toEqual(rows.slice(0, 2));
    expect(topAssets([], 6)).toEqual([]);
  });
});
